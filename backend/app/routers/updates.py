from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile


router = APIRouter(prefix="/updates", tags=["updates"])


_SAFE_PATH_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._\\-/]*$")


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
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass

    return {"ok": True, "path": str(target.relative_to(base))}

