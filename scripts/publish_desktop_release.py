#!/usr/bin/env python3
"""
Publish Tauri desktop build artifacts (Windows + macOS) to the running cloud stack.

Why:
- Repo is private, so we can't rely on GitHub Releases for auto-updater downloads.
- We host update bundles + manifests on https://download.melqard.com/updates/*
- CI uploads files to the API (which writes into the shared /updates volume).

Expected input (from GitHub Actions artifacts):
  dist/<runner-os>/<app>/*  (files copied from src-tauri/target/release/bundle/**)

This script:
1) Detects update bundles + signatures per platform
2) Uploads versioned artifacts to /updates/<app>/<version>/
3) Uploads "latest installers" with stable filenames
4) Writes /updates/<app>/latest.json for the Tauri auto-updater
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple
from urllib.parse import urljoin
import subprocess


APP_CONFIG = {
    "pos": {
        "tauri_conf": Path("apps/pos-desktop/src-tauri/tauri.conf.json"),
        "stable_installer_win_msi": "MelqardPOS-Setup-latest.msi",
        "stable_installer_win_exe": "MelqardPOS-Setup-latest.exe",
        "stable_installer_mac": "MelqardPOS-Setup-latest.dmg",
        "title": "Melqard POS Desktop",
    },
    "portal": {
        "tauri_conf": Path("apps/admin-desktop/src-tauri/tauri.conf.json"),
        "stable_installer_win_msi": "MelqardPortal-Setup-latest.msi",
        "stable_installer_win_exe": "MelqardPortal-Setup-latest.exe",
        "stable_installer_mac": "MelqardPortal-Setup-latest.dmg",
        "title": "Melqard Admin Desktop",
    },
    "setup": {
        "tauri_conf": Path("apps/setup-desktop/src-tauri/tauri.conf.json"),
        "stable_installer_win_msi": "MelqardInstaller-Setup-latest.msi",
        "stable_installer_win_exe": "MelqardInstaller-Setup-latest.exe",
        "stable_installer_mac": "MelqardInstaller-Setup-latest.dmg",
        "title": "Melqard Setup Desktop",
    },
}

def _safe_filename(name: str) -> str:
    """
    Convert build artifact names into API-acceptable rel_path components.

    The updates upload API intentionally disallows spaces and most punctuation.
    Some bundlers (Tauri) emit filenames containing spaces (derived from productName).
    """
    out = []
    prev_us = False
    for ch in name:
        ok = ch.isalnum() or ch in "._-"
        if ok:
            out.append(ch)
            prev_us = False
        else:
            if not prev_us:
                out.append("_")
                prev_us = True
    s = "".join(out).strip("_")
    return s or "artifact"


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _read_version(tauri_conf: Path) -> str:
    try:
        data = json.loads(tauri_conf.read_text(encoding="utf-8"))
    except Exception as e:
        _die(f"failed to read {tauri_conf}: {e}")
    v = str(data.get("version") or "").strip()
    if not v:
        _die(f"missing version in {tauri_conf}")
    return v


def _http_upload(api_base: str, publish_key: str, rel_path: str, file_path: Path) -> None:
    url = urljoin(api_base.rstrip("/") + "/", "updates/upload")
    # Use curl so we can stream large files without loading them into memory.
    # (GitHub Actions + installers can be 50-200MB.)
    cmd = [
        "curl",
        "-fsS",
        "-X",
        "POST",
        "-H",
        f"X-Updates-Key: {publish_key}",
        "-F",
        f"rel_path={rel_path}",
        "-F",
        f"file=@{str(file_path)}",
        url,
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    except FileNotFoundError:
        _die("curl not found (required to publish update artifacts)")
    except subprocess.CalledProcessError as e:
        _die(f"upload failed: {rel_path} (curl exit {e.returncode})")


def _http_post_json(api_base: str, publish_key: str, endpoint: str, payload: dict) -> None:
    url = urljoin(api_base.rstrip("/") + "/", endpoint.lstrip("/"))
    cmd = [
        "curl",
        "-fsS",
        "-X",
        "POST",
        "-H",
        f"X-Updates-Key: {publish_key}",
        "-H",
        "Content-Type: application/json",
        "-d",
        json.dumps(payload),
        url,
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    except FileNotFoundError:
        _die("curl not found (required to publish update artifacts)")
    except subprocess.CalledProcessError as e:
        # Best-effort: don't block publishing if purge isn't deployed yet.
        print(f"warning: post failed: {endpoint} (curl exit {e.returncode})", file=sys.stderr)


@dataclass(frozen=True)
class PlatformBundle:
    platform: str  # windows-x86_64, darwin-x86_64, darwin-aarch64
    update_bundle: Path
    signature: Path
    installer: Optional[Path]


def _find_one(root: Path, suffixes: Tuple[str, ...]) -> Optional[Path]:
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        n = p.name.lower()
        if any(n.endswith(s) for s in suffixes):
            return p
    return None


def _bundle_for_platform(root: Path, platform: str) -> PlatformBundle:
    if platform.startswith("windows"):
        # Tauri bundler output differs by major version/config:
        # - Historically (Tauri v1) updater bundles on Windows were `*.msi.zip`/`*.exe.zip`
        # - Newer builds (Tauri v2) may produce plain `*.msi`/`*.exe` with a sibling `*.sig`
        #
        # Support both, preferring the "zip bundle" when present.
        update = _find_one(root, (".msi.zip",))
        if not update:
            update = _find_one(root, (".exe.zip",))
        if not update:
            update = _find_one(root, (".msi",))
        if not update:
            update = _find_one(root, (".exe",))
        if not update:
            update = _find_one(root, (".zip",))
        if not update:
            _die(f"missing windows update bundle under {root}")
        sig = Path(str(update) + ".sig")
        if not sig.exists():
            _die(f"missing signature: {sig}")
        installer = _find_one(root, (".msi",))
        if not installer:
            installer = _find_one(root, (".exe",))
        return PlatformBundle(platform=platform, update_bundle=update, signature=sig, installer=installer)

    if platform.startswith("darwin"):
        update = _find_one(root, (".app.tar.gz",))
        if not update:
            update = _find_one(root, (".tar.gz",))
        if not update:
            _die(f"missing macOS update bundle under {root}")
        sig = Path(str(update) + ".sig")
        if not sig.exists():
            _die(f"missing signature: {sig}")
        installer = _find_one(root, (".dmg",))
        return PlatformBundle(platform=platform, update_bundle=update, signature=sig, installer=installer)

    _die(f"unsupported platform: {platform}")


def _sig_text(sig_path: Path) -> str:
    s = sig_path.read_text(encoding="utf-8", errors="ignore").strip()
    if not s:
        _die(f"empty signature: {sig_path}")
    return s


def _publish_app(
    *,
    api_base: str,
    download_base: str,
    publish_key: str,
    app: str,
    version: str,
    bundles: Dict[str, PlatformBundle],
    ) -> None:
    # Upload artifacts.
    for b in bundles.values():
        for fp in [b.update_bundle, b.signature, b.installer]:
            if not fp:
                continue
            rel = f"{app}/{version}/{_safe_filename(fp.name)}"
            _http_upload(api_base, publish_key, rel, fp)

    # Upload stable "latest installer" names for staff onboarding.
    stable_win_msi = APP_CONFIG[app]["stable_installer_win_msi"]
    stable_win_exe = APP_CONFIG[app]["stable_installer_win_exe"]
    stable_mac = APP_CONFIG[app]["stable_installer_mac"]
    if "windows-x86_64" in bundles and bundles["windows-x86_64"].installer:
        inst = bundles["windows-x86_64"].installer  # type: ignore[assignment]
        ext = inst.suffix.lower()
        if ext == ".exe":
            _http_upload(api_base, publish_key, f"{app}/{stable_win_exe}", inst)
        else:
            # Default to MSI stable name (covers .msi and any future wix variants).
            _http_upload(api_base, publish_key, f"{app}/{stable_win_msi}", inst)
    if "darwin-aarch64" in bundles and bundles["darwin-aarch64"].installer:
        _http_upload(api_base, publish_key, f"{app}/{stable_mac}", bundles["darwin-aarch64"].installer)  # type: ignore[arg-type]
    elif "darwin-x86_64" in bundles and bundles["darwin-x86_64"].installer:
        _http_upload(api_base, publish_key, f"{app}/{stable_mac}", bundles["darwin-x86_64"].installer)  # type: ignore[arg-type]

    # Build latest.json for updater.
    platforms = {}
    for plat, b in bundles.items():
        url = f"{download_base.rstrip('/')}/updates/{app}/{version}/{_safe_filename(b.update_bundle.name)}"
        platforms[plat] = {"url": url, "signature": _sig_text(b.signature)}

    latest = {
        "version": version,
        "notes": f"{APP_CONFIG[app]['title']} {version}",
        "pub_date": datetime.now(timezone.utc).isoformat(),
        "platforms": platforms,
    }

    tmp = Path(".tmp-latest.json")
    tmp.write_text(json.dumps(latest, indent=2), encoding="utf-8")
    try:
        _http_upload(api_base, publish_key, f"{app}/latest.json", tmp)
    finally:
        try:
            tmp.unlink()
        except Exception:
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", required=True, help="Example: https://app.melqard.com/api/")
    ap.add_argument("--download-base", default="https://download.melqard.com", help="Example: https://download.melqard.com")
    ap.add_argument("--publish-key", default=os.getenv("UPDATES_PUBLISH_KEY") or "")
    ap.add_argument("--dist-dir", default="dist", help="Directory containing downloaded CI artifacts")
    args = ap.parse_args()

    if not args.publish_key:
        _die("missing publish key (pass --publish-key or set UPDATES_PUBLISH_KEY)")

    dist = Path(args.dist_dir)
    if not dist.exists():
        _die(f"missing dist dir: {dist}")

    def _subdir(name: str) -> Path:
        direct = dist / name
        if direct.exists():
            return direct
        # When using actions/download-artifact without merge, artifacts land under their artifact name.
        alt = dist / f"desktop-{name}"
        if alt.exists():
            return alt
        # Fallback: find a directory that ends with "-<name>".
        for p in dist.iterdir():
            if p.is_dir() and p.name.endswith(f"-{name}"):
                return p
        return direct

    for app in ("pos", "portal", "setup"):
        cfg = APP_CONFIG[app]
        version = _read_version(cfg["tauri_conf"])

        # Each OS artifact is stored under dist/<runner-os>/<app>/...
        bundles: Dict[str, PlatformBundle] = {}

        win_root = _subdir("windows-latest") / app
        if win_root.exists():
            bundles["windows-x86_64"] = _bundle_for_platform(win_root, "windows-x86_64")

        mac_intel_root = _subdir("macos-13") / app
        if mac_intel_root.exists():
            bundles["darwin-x86_64"] = _bundle_for_platform(mac_intel_root, "darwin-x86_64")

        mac_arm_root = _subdir("macos-14") / app
        if mac_arm_root.exists():
            bundles["darwin-aarch64"] = _bundle_for_platform(mac_arm_root, "darwin-aarch64")

        if not bundles:
            _die(f"no bundles found for app={app} under {dist}")

        _publish_app(
            api_base=args.api_base,
            download_base=args.download_base,
            publish_key=args.publish_key,
            app=app,
            version=version,
            bundles=bundles,
        )

        print(f"published {app} {version} ({', '.join(sorted(bundles.keys()))})")

    # Keep the download host clean: remove outdated versions after publishing.
    _http_post_json(
        api_base=args.api_base,
        publish_key=args.publish_key,
        endpoint="updates/purge",
        payload={"apps": ["pos", "portal", "setup"], "keep_versions": 1},
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
