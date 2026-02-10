from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse


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


def _require_publish_key(x_updates_key: Optional[str]) -> None:
    expected = (os.getenv("UPDATES_PUBLISH_KEY") or "").strip()
    if not expected:
        # Not configured in this environment.
        raise HTTPException(status_code=404, detail="updates publishing is disabled")
    if not x_updates_key or x_updates_key.strip() != expected:
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


@router.get("/{rel_path:path}")
def get_update_file(rel_path: str):
    """
    Public read-only access to update artifacts.
    """
    base = _updates_dir()
    target = _resolve_rel_path(rel_path)

    if target.exists() and target.is_dir():
        html = _html_index(target, rel_path)
        return HTMLResponse(content=html, headers={"Cache-Control": "no-store"})

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="not found")

    rel = str(target.relative_to(base))
    return FileResponse(
        path=str(target),
        filename=target.name,
        headers={"Cache-Control": _cache_control_for_rel(rel)},
    )


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
