from __future__ import annotations

import os
import re
import tempfile
import hmac
from pathlib import Path
from typing import Optional

from pydantic import BaseModel
from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse


router = APIRouter(prefix="/updates", tags=["updates"])


# Only allow POSIX-style relative paths (CI uploads), e.g.:
#   pos/0.0.1/MelqardPOS_0.0.1_x64_en-US.msi
#   pos/latest.json
#
# We deliberately do NOT allow backslashes (Windows path separators) to avoid
# ambiguity and path traversal surprises.
_SAFE_PATH_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._/-]*$")


def _updates_dir() -> Path:
    base = (os.getenv("UPDATES_DIR") or "/updates").strip() or "/updates"
    p = Path(base)
    return p


def sync_downloads_site_to_updates() -> None:
    """
    Ensure the downloads landing page (download.melqard.com `/` + `/style.css`)
    is available from the shared `/updates` volume.

    Why: some Dokploy deployments may skip rebuilding the `downloads` container
    if only static files changed. By keeping the landing page inside the shared
    volume, the API deployment can update it reliably.
    """
    try:
        base = _updates_dir()
        if not base.exists() or not base.is_dir():
            return

        src_dir = (Path(__file__).resolve().parents[1] / "static" / "downloads_site").resolve()
        if not src_dir.exists() or not src_dir.is_dir():
            return

        dest_dir = (base / "site").resolve()
        try:
            dest_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            return

        for src in sorted(src_dir.glob("*")):
            if not src.is_file():
                continue
            dest = dest_dir / src.name
            try:
                new_bytes = src.read_bytes()
                old_bytes = dest.read_bytes() if dest.exists() and dest.is_file() else None
                if old_bytes != new_bytes:
                    dest.write_bytes(new_bytes)
                _make_world_readable(dest, base)
            except Exception:
                # Never crash API startup because a staff-facing downloads page
                # couldn't be written.
                continue
    except Exception:
        return


def _require_publish_key(x_updates_key: Optional[str]) -> None:
    expected = (os.getenv("UPDATES_PUBLISH_KEY") or "").strip()
    if not expected:
        # Not configured in this environment.
        raise HTTPException(status_code=404, detail="updates publishing is disabled")
    if not x_updates_key or not hmac.compare_digest(x_updates_key.strip(), expected):
        raise HTTPException(status_code=403, detail="forbidden")


def _resolve_rel_path(rel_path: str) -> Path:
    rel = (rel_path or "").strip().lstrip("/")
    if not rel or len(rel) > 300:
        raise HTTPException(status_code=400, detail="invalid rel_path")
    if "\\" in rel:
        raise HTTPException(status_code=400, detail="invalid rel_path")
    if ".." in rel.split("/"):
        raise HTTPException(status_code=400, detail="invalid rel_path")
    if not _SAFE_PATH_RE.match(rel):
        raise HTTPException(status_code=400, detail="invalid rel_path")

    base = _updates_dir().resolve()
    target = (base / rel).resolve()
    if base not in target.parents and target != base:
        raise HTTPException(status_code=400, detail="invalid rel_path")
    return target


def _make_world_readable(target: Path, base: Path) -> None:
    """
    download.melqard.com serves files directly from the shared /updates volume via nginx.
    Ensure uploaded files and their directories are traversable/readable by the nginx user.
    """
    try:
        base = base.resolve()
        target = target.resolve()
        # Directories from base -> target.parent
        p = target.parent
        while True:
            if p == base:
                break
            if base not in p.parents:
                break
            try:
                os.chmod(p, 0o755)
            except Exception:
                pass
            p = p.parent
        try:
            os.chmod(target, 0o644)
        except Exception:
            pass
    except Exception:
        # Never fail the upload due to chmod issues; worst-case nginx returns 403 and
        # we can diagnose from the outside.
        return


def _cache_control_for_rel(rel: str) -> str:
    lower = rel.lower()
    # Manifests + stable "latest" installers should never be cached.
    if lower.endswith(".json") or "-latest." in lower:
        return "no-store"
    # Versioned artifacts can be cached for a bit.
    return "public, max-age=86400"


def _find_latest_installer_rel(app: str, platform: str) -> str:
    app_key = (app or "").strip().lower()
    plat = (platform or "").strip().lower()
    # Backwards compatibility: we historically called the back-office app "portal".
    # Externally, we want to present it as "admin" (more obvious for new installs),
    # but keep the same storage layout under /updates/portal.
    if app_key == "admin":
        app_key = "portal"

    if app_key not in {"pos", "portal", "setup"}:
        raise HTTPException(status_code=400, detail="invalid app")
    if plat not in {"windows", "macos"}:
        raise HTTPException(status_code=400, detail="invalid platform")

    stable_names = {
        ("pos", "windows"): ["MelqardPOS-Setup-latest.msi", "MelqardPOS-Setup-latest.exe"],
        ("pos", "macos"): "MelqardPOS-Setup-latest.dmg",
        ("portal", "windows"): ["MelqardPortal-Setup-latest.msi", "MelqardPortal-Setup-latest.exe"],
        ("portal", "macos"): "MelqardPortal-Setup-latest.dmg",
        ("setup", "windows"): ["MelqardInstaller-Setup-latest.msi", "MelqardInstaller-Setup-latest.exe"],
        ("setup", "macos"): "MelqardInstaller-Setup-latest.dmg",
    }[(app_key, plat)]

    ext_allow = (".msi", ".exe") if plat == "windows" else (".dmg",)
    base = _updates_dir().resolve()
    app_root = (base / app_key).resolve()
    if base not in app_root.parents and app_root != base:
        raise HTTPException(status_code=500, detail="invalid updates path")
    if not app_root.exists() or not app_root.is_dir():
        raise HTTPException(status_code=404, detail="installer not found")

    if isinstance(stable_names, str):
        stable_names = [stable_names]
    for nm in stable_names:
        stable = (app_root / nm).resolve()
        if stable.exists() and stable.is_file():
            return str(stable.relative_to(base))

    # Setup Desktop isn't always available on Windows (CI/build machine missing).
    # Provide a stable fallback to the Setup Runner zip when present.
    if app_key == "setup" and plat == "windows":
        runner = (app_root / "MelqardSetupRunner-latest.zip").resolve()
        if runner.exists() and runner.is_file():
            return str(runner.relative_to(base))

    candidates = []
    for p in app_root.rglob("*"):
        if not p.is_file():
            continue
        n = p.name.lower()
        if n.endswith(".sig") or n.endswith(".zip") or n.endswith(".tar.gz") or n.endswith(".json"):
            continue
        if not n.endswith(ext_allow):
            continue
        try:
            st = p.stat()
            candidates.append((st.st_mtime, p.name.lower(), p))
        except Exception:
            continue

    if not candidates:
        raise HTTPException(status_code=404, detail="installer not found")

    # Prefer the newest by mtime; tie-break by name for deterministic behavior.
    candidates.sort(key=lambda t: (t[0], t[1]), reverse=True)
    chosen = candidates[0][2].resolve()
    return str(chosen.relative_to(base))


def _html_index(dir_path: Path, rel_dir: str) -> str:
    # Very small nginx-like directory listing, so staff can click "All files".
    rel_dir = rel_dir.strip().lstrip("/")
    title = f"Index of /updates/{rel_dir}".rstrip("/")
    rows = ['<a href="../">../</a>']
    for p in sorted(dir_path.iterdir(), key=lambda x: x.name.lower()):
        name = p.name + ("/" if p.is_dir() else "")
        try:
            st = p.stat()
            size = "" if p.is_dir() else str(st.st_size)
            mtime = ""
            try:
                import datetime as _dt

                mtime = _dt.datetime.utcfromtimestamp(st.st_mtime).strftime("%d-%b-%Y %H:%M")
            except Exception:
                mtime = ""
        except Exception:
            size = ""
            mtime = ""
        rows.append(f'<a href="{p.name}">{name}</a>{" " * max(1, 60 - len(name))}{mtime}{" " * 2}{size}')
    body = "\n".join(rows)
    return (
        "<html><head>"
        f"<title>{title}</title>"
        "</head><body>"
        f"<h1>{title}</h1><hr><pre>{body}</pre><hr>"
        "</body></html>"
    )


class PurgeUpdatesIn(BaseModel):
    apps: list[str] | None = None  # default: all
    keep_versions: int = 1  # keep only the latest by default
    dry_run: bool = False


def _safe_rm_tree(p: Path) -> None:
    try:
        if p.is_symlink():
            p.unlink()
            return
        if p.is_file():
            p.unlink()
            return
        if p.is_dir():
            # Manual walk to avoid shutil import and to keep strict control.
            for child in p.rglob("*"):
                try:
                    if child.is_file() or child.is_symlink():
                        child.unlink()
                except Exception:
                    pass
            # Remove dirs bottom-up.
            for child in sorted([x for x in p.rglob("*") if x.is_dir()], key=lambda x: len(str(x)), reverse=True):
                try:
                    child.rmdir()
                except Exception:
                    pass
            try:
                p.rmdir()
            except Exception:
                pass
    except Exception:
        return


def _read_latest_version(app_root: Path) -> Optional[str]:
    try:
        latest_path = app_root / "latest.json"
        if not latest_path.exists() or not latest_path.is_file():
            return None
        import json

        data = json.loads(latest_path.read_text(encoding="utf-8"))
        v = str(data.get("version") or "").strip()
        return v or None
    except Exception:
        return None


@router.post("/purge")
def purge_updates(
    data: PurgeUpdatesIn,
    x_updates_key: Optional[str] = Header(default=None, alias="X-Updates-Key"),
):
    """
    Delete outdated desktop update artifacts under /updates/*.

    Intended for CI to keep https://download.melqard.com clean and ensure users
    always download the current installers.
    Protected by the same UPDATES_PUBLISH_KEY as /updates/upload.
    """
    _require_publish_key(x_updates_key)

    keep_n = int(data.keep_versions or 1)
    if keep_n < 1 or keep_n > 10:
        raise HTTPException(status_code=400, detail="keep_versions must be between 1 and 10")

    base = _updates_dir().resolve()
    if not base.exists() or not base.is_dir():
        raise HTTPException(status_code=500, detail="updates dir is not mounted")

    apps_in = [(a or "").strip().lower() for a in (data.apps or [])]
    apps = apps_in if apps_in else ["pos", "portal", "setup"]
    allowed = {"pos", "portal", "setup"}
    apps = [a for a in apps if a in allowed]
    if not apps:
        raise HTTPException(status_code=400, detail="no valid apps")

    # Stable installer names we always keep in the app root.
    stable_by_app = {
        "pos": {"MelqardPOS-Setup-latest.msi", "MelqardPOS-Setup-latest.exe", "MelqardPOS-Setup-latest.dmg"},
        "portal": {"MelqardPortal-Setup-latest.msi", "MelqardPortal-Setup-latest.exe", "MelqardPortal-Setup-latest.dmg"},
        "setup": {
            "MelqardInstaller-Setup-latest.msi",
            "MelqardInstaller-Setup-latest.exe",
            "MelqardInstaller-Setup-latest.dmg",
            # Fallback for Windows when Setup Desktop isn't published yet.
            "MelqardSetupRunner-latest.zip",
        },
    }

    removed: list[dict] = []
    kept: list[dict] = []

    for app in apps:
        app_root = (base / app).resolve()
        if base not in app_root.parents and app_root != base:
            continue
        if not app_root.exists() or not app_root.is_dir():
            continue

        latest_v = _read_latest_version(app_root)
        # Keep directories by mtime if latest.json is missing/broken.
        version_dirs = []
        for p in app_root.iterdir():
            if not p.is_dir():
                continue
            # Only treat folders like versions (avoid deleting random folders).
            if not re.match(r"^[0-9]+\\.[0-9]+\\.[0-9]+", p.name):
                continue
            try:
                version_dirs.append((p.stat().st_mtime, p.name, p))
            except Exception:
                continue
        version_dirs.sort(key=lambda t: (t[0], t[1]), reverse=True)

        keep_set = set()
        if latest_v:
            keep_set.add(latest_v)
        for _mt, name, _p in version_dirs[:keep_n]:
            keep_set.add(name)

        # Remove old version directories.
        for _mt, name, p in version_dirs:
            if name in keep_set:
                kept.append({"app": app, "keep": str(p.relative_to(base))})
                continue
            removed.append({"app": app, "remove": str(p.relative_to(base))})
            if not data.dry_run:
                _safe_rm_tree(p)

        # Remove stray root-level files (except latest.json + stable installers).
        keep_files = set(stable_by_app.get(app, set())) | {"latest.json"}
        for p in app_root.iterdir():
            if p.is_dir():
                continue
            if p.name in keep_files:
                continue
            # Keep signatures/bundles only if they live under a version dir; root junk is outdated.
            removed.append({"app": app, "remove": str(p.relative_to(base))})
            if not data.dry_run:
                try:
                    p.unlink()
                except Exception:
                    pass

    return {"ok": True, "dry_run": bool(data.dry_run), "removed": removed, "kept": kept}


@router.get("/_debug/ls")
def debug_list_updates(
    prefix: str = "",
    x_updates_key: Optional[str] = Header(default=None, alias="X-Updates-Key"),
):
    """
    Debug helper for production deployments: verifies that `/updates` is mounted and
    shared across services. Protected by the same publish key as uploads.
    """
    _require_publish_key(x_updates_key)
    base = _updates_dir()
    try:
        is_mount = os.path.ismount(str(base))
    except Exception:
        is_mount = False

    rel = (prefix or "").strip().lstrip("/")
    if rel and not _SAFE_PATH_RE.match(rel):
        raise HTTPException(status_code=400, detail="invalid prefix")
    target = (base / rel).resolve()
    base_resolved = base.resolve()
    if base_resolved not in target.parents and target != base_resolved:
        raise HTTPException(status_code=400, detail="invalid prefix")

    entries = []
    try:
        if target.exists() and target.is_dir():
            for p in sorted(target.iterdir()):
                try:
                    st = p.stat()
                    entries.append(
                        {
                            "name": p.name,
                            "is_dir": p.is_dir(),
                            "size": st.st_size,
                        }
                    )
                except Exception:
                    entries.append({"name": p.name, "is_dir": p.is_dir()})
    except Exception:
        entries = []

    return {
        "base": str(base),
        "is_mount": is_mount,
        "prefix": rel,
        "entries": entries[:200],
    }


@router.post("/upload")
async def upload_update_file(
    rel_path: str = Form(...),
    file: UploadFile = File(...),
    x_updates_key: Optional[str] = Header(default=None, alias="X-Updates-Key"),
):
    """
    Upload update artifacts (installers, bundles, signatures, manifests) to the shared
    `/updates` volume served by download.melqard.com.

    This endpoint is intended for CI. It is protected by an environment key
    (`UPDATES_PUBLISH_KEY`) and is disabled if the key is not set.
    """
    _require_publish_key(x_updates_key)

    base = _updates_dir()
    if not base.exists() or not base.is_dir():
        raise HTTPException(status_code=500, detail="updates dir is not mounted")

    target = _resolve_rel_path(rel_path)
    target.parent.mkdir(parents=True, exist_ok=True)

    # Atomic write: stream to a temp file then replace.
    fd, tmp_path = tempfile.mkstemp(prefix=".upload-", dir=str(target.parent))
    os.close(fd)
    tmp = Path(tmp_path)
    try:
        with tmp.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        tmp.replace(target)
        _make_world_readable(target, base)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass

    return {"ok": True, "path": str(target.relative_to(base))}


@router.get("/latest-installer/{app}/{platform}")
def latest_installer_redirect(app: str, platform: str):
    """
    Stable URL for staff-facing download buttons.
    Falls back to the newest versioned installer when *-latest files are missing.
    """
    rel = _find_latest_installer_rel(app, platform)
    return RedirectResponse(url=f"/updates/{rel}", status_code=307)


@router.get("/{rel_path:path}")
def get_update_file(rel_path: str):
    """
    Public read-only access to update artifacts.
    """
    # Alias /updates/admin/* -> /updates/portal/* (see note in _find_latest_installer_rel).
    rel_path_norm = (rel_path or "").strip().lstrip("/")
    if rel_path_norm == "admin" or rel_path_norm.startswith("admin/"):
        rel_path = "portal" + rel_path_norm[len("admin") :]

    base = _updates_dir()
    target = _resolve_rel_path(rel_path)

    if target.exists() and target.is_dir():
        html = _html_index(target, rel_path)
        return HTMLResponse(content=html, headers={"Cache-Control": "no-store"})

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="not found")

    rel = str(target.relative_to(base))
    # For the downloads landing page under /updates/site/*, we want browsers to
    # render files inline (HTML/CSS/images), not force a download.
    if rel.startswith("site/"):
        return FileResponse(
            path=str(target),
            headers={"Cache-Control": _cache_control_for_rel(rel)},
        )

    return FileResponse(
        path=str(target),
        filename=target.name,
        headers={"Cache-Control": _cache_control_for_rel(rel)},
    )
