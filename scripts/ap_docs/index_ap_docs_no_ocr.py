#!/usr/bin/env python3
"""
NO-OCR AP doc organizer.

What it does (without reading any text):
- Walks a folder of images/PDFs.
- Extracts capture/creation date (best-effort via `sips`) and falls back to mtime.
- Creates a downscaled JPEG preview (via `sips` for images; QuickLook thumbnail for PDFs when possible).
- Computes:
  - sha256 (exact duplicate detection)
  - aHash64 from the preview (rough visual similarity clustering; not OCR)
- Writes CSV index + summary.
- Optionally creates an "organized" symlink tree by year/company/hash-prefix.

Limitations:
- Without OCR, we cannot reliably extract supplier name, invoice number, totals, or settlement status.
  This script focuses on making the dataset browsable and deduplicated so you can label clusters quickly.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from PIL import Image


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _run(cmd: list[str], *, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def _doc_key(path: Path) -> str:
    st = path.stat()
    base = f"{path.as_posix()}|{st.st_size}|{int(st.st_mtime)}".encode("utf-8", errors="ignore")
    return hashlib.sha1(base).hexdigest()


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _safe_name(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"[\\/]+", "-", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"[^0-9A-Za-z ._()\\-]+", "", s).strip()
    return s[:80] or "unknown"


def _capture_date_guess(src: Path) -> str:
    # Try sips "creation" (works for HEIC/JPG/PNG); else fallback to mtime.
    try:
        proc = _run(["sips", "-g", "creation", str(src)], timeout=8)
        if proc.returncode == 0:
            for ln in (proc.stdout or "").splitlines():
                if "creation:" in ln:
                    val = ln.split("creation:", 1)[1].strip()
                    # Format: YYYY:MM:DD HH:MM:SS
                    if re.match(r"^20\d{2}:\d{2}:\d{2}", val):
                        return val[:10].replace(":", "-")
    except Exception:
        pass
    try:
        st = src.stat()
        return date.fromtimestamp(st.st_mtime).isoformat()
    except Exception:
        return ""


def _ensure_preview(src: Path, *, out_dir: Path, max_dim: int) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    key = _doc_key(src)
    out = out_dir / f"{key}.jpg"
    if out.exists() and out.stat().st_size > 0:
        return out

    ext = src.suffix.lower()
    if ext in {".heic", ".jpg", ".jpeg", ".png"}:
        proc = _run(
            [
                "sips",
                "-s",
                "format",
                "jpeg",
                "-s",
                "formatOptions",
                "80",
                "-Z",
                str(max_dim),
                str(src),
                "--out",
                str(out),
            ],
            timeout=180,
        )
        if proc.returncode == 0 and out.exists() and out.stat().st_size > 0:
            return out
        out.unlink(missing_ok=True)  # type: ignore[arg-type]
        _die(f"sips preview failed for {src.name}: {(proc.stderr or proc.stdout or '').strip()}")

    if ext == ".pdf":
        # QuickLook thumbnail to JPEG (no OCR, just rendering).
        # qlmanage writes <name>.jpg in the output dir.
        proc = _run(["qlmanage", "-t", "-s", str(max_dim), "-o", str(out_dir), str(src)], timeout=180)
        if proc.returncode == 0:
            # qlmanage outputs something like <filename>.pdf.jpg
            candidate = out_dir / (src.name + ".jpg")
            if candidate.exists() and candidate.stat().st_size > 0:
                candidate.replace(out)
                return out
        out.unlink(missing_ok=True)  # type: ignore[arg-type]
        _die(f"qlmanage preview failed for {src.name}: {(proc.stderr or proc.stdout or '').strip()}")

    _die(f"unsupported file type: {src}")


def _ahash64_hex(preview_jpg: Path) -> str:
    # Average hash (aHash) on an 8x8 grayscale image.
    # Returns 16-hex (64-bit).
    img = Image.open(preview_jpg)
    img = img.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    px = list(img.getdata())
    avg = sum(px) / 64.0
    bits = 0
    for i, v in enumerate(px):
        if v >= avg:
            bits |= 1 << (63 - i)
    return f"{bits:016x}"


@dataclass
class Row:
    original_path: str
    company: str
    capture_date: str
    year: str
    size_bytes: int
    sha256: str
    preview_jpg: str
    ahash64: str
    ahash_prefix: str


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default=".cache/ap_docs_no_ocr")
    ap.add_argument("--company", default="AH Trading")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-dim", type=int, default=1800)
    ap.add_argument("--organize", action="store_true")
    args = ap.parse_args()

    in_dir = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out).expanduser().resolve()
    if not in_dir.exists():
        _die(f"input not found: {in_dir}")

    preview_dir = out_dir / "previews_jpg"
    report_dir = out_dir / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)

    exts = {".heic", ".jpg", ".jpeg", ".png", ".pdf"}
    files = [p for p in in_dir.rglob("*") if p.is_file() and p.suffix.lower() in exts]
    files.sort()
    if args.limit and args.limit > 0:
        files = files[: args.limit]
    if not files:
        _die("no supported files found")

    rows: list[Row] = []
    for src in files:
        cap = _capture_date_guess(src)
        year = cap[:4] if cap and len(cap) >= 4 else "unknown"
        prev = _ensure_preview(src, out_dir=preview_dir, max_dim=int(args.max_dim))
        ah = _ahash64_hex(prev)
        sha = _sha256(src)
        prefix = ah[:4]  # coarse bucketing
        rows.append(
            Row(
                original_path=str(src),
                company=(args.company or "").strip() or "unknown-company",
                capture_date=cap,
                year=year,
                size_bytes=int(src.stat().st_size),
                sha256=sha,
                preview_jpg=str(prev),
                ahash64=ah,
                ahash_prefix=prefix,
            )
        )

    # CSV index
    idx_path = report_dir / "ap_docs_no_ocr_index.csv"
    with idx_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "original_path",
                "company",
                "capture_date",
                "year",
                "size_bytes",
                "sha256",
                "preview_jpg",
                "ahash64",
                "ahash_prefix",
            ]
        )
        for r in rows:
            w.writerow(
                [
                    r.original_path,
                    r.company,
                    r.capture_date,
                    r.year,
                    r.size_bytes,
                    r.sha256,
                    r.preview_jpg,
                    r.ahash64,
                    r.ahash_prefix,
                ]
            )

    # Summary: year/company/hash-prefix counts + exact dup counts.
    by_bucket: dict[tuple[str, str, str], int] = {}
    by_sha: dict[str, int] = {}
    for r in rows:
        by_bucket[(r.year, r.company, r.ahash_prefix)] = by_bucket.get((r.year, r.company, r.ahash_prefix), 0) + 1
        by_sha[r.sha256] = by_sha.get(r.sha256, 0) + 1
    dup_count = sum(1 for c in by_sha.values() if c > 1)

    summary_path = report_dir / "summary_by_year_company_bucket.csv"
    with summary_path.open("w", newline="", encoding="utf-8") as f2:
        w2 = csv.writer(f2)
        w2.writerow(["year", "company", "bucket", "docs"])
        for (y, c, b), n in sorted(by_bucket.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2])):
            w2.writerow([y, c, b, n])

    meta_path = report_dir / "meta.csv"
    with meta_path.open("w", newline="", encoding="utf-8") as f3:
        w3 = csv.writer(f3)
        w3.writerow(["files", "exact_duplicate_groups"])
        w3.writerow([len(rows), dup_count])

    if args.organize:
        org_root = out_dir / "organized"
        org_root.mkdir(parents=True, exist_ok=True)
        for r in rows:
            dest_dir = org_root / (r.year or "unknown") / _safe_name(r.company) / r.ahash_prefix
            dest_dir.mkdir(parents=True, exist_ok=True)
            src = Path(r.original_path)
            dest = dest_dir / src.name
            if dest.exists():
                continue
            try:
                dest.symlink_to(src)
            except Exception:
                # Fallback: ignore if symlink not possible.
                pass

    print(str(idx_path))


if __name__ == "__main__":
    main()

