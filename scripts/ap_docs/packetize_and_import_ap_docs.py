#!/usr/bin/env python3
"""
AI packetizer + importer for AP docs (multi-image invoice support).

What it does:
1) Discovers docs (images/PDFs) in a folder.
2) Builds AI fingerprints per file (supplier/invoice no/date/total/page hints).
3) Groups files into invoice packets.
4) Optionally uploads each packet to:
   POST /purchases/invoices/drafts/import-files
   so one invoice draft can own many attachments.

Design goals:
- Resumable and cache-heavy for large sets (thousands of files).
- Review-first migration (defaults: auto_apply=false, async_import=true).
- "Visually-lossless" compression path for non-JPEG image formats.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import mimetypes
import os
import re
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SUPPORTED_EXTS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".tif",
    ".tiff",
    ".pdf",
}
CONVERT_TO_JPEG_EXTS = {".png", ".webp", ".heic", ".tif", ".tiff"}
INVOICE_DOC_TYPES = {"invoice", "purchase_invoice", "supplier_invoice"}
NON_INVOICE_DOC_TYPES = {"receipt", "credit_note", "soa", "statement", "other"}


def _die(msg: str) -> None:
    raise SystemExit(f"error: {msg}")


def _norm(v: Any) -> str:
    return str(v or "").strip()


def _norm_name(v: Any) -> str:
    s = _norm(v).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _norm_invoice(v: Any) -> str:
    s = _norm(v).upper()
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[^A-Z0-9./_-]+", "", s)
    return s


def _norm_money(v: Any) -> str:
    s = _norm(v)
    if not s:
        return ""
    s = s.replace(",", "")
    try:
        x = float(s)
        return f"{x:.2f}"
    except Exception:
        return ""


def _safe_name(v: str) -> str:
    s = _norm(v)
    s = re.sub(r"[\\/]+", "-", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"[^0-9A-Za-z ._()\\-]+", "", s).strip()
    return s[:100] or "unknown"


def _doc_key(path: Path) -> str:
    st = path.stat()
    raw = f"{path.as_posix()}|{st.st_size}|{int(st.st_mtime)}".encode("utf-8", errors="ignore")
    return hashlib.sha1(raw).hexdigest()


def _run(cmd: list[str], timeout: int = 180) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def _ensure_preview(src: Path, out_dir: Path, max_dim: int) -> Path:
    """
    Build a JPEG preview used only for AI fingerprinting.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{_doc_key(src)}.jpg"
    if out.exists() and out.stat().st_size > 0:
        return out

    ext = src.suffix.lower()
    if ext != ".pdf":
        proc = _run(
            [
                "sips",
                "-s",
                "format",
                "jpeg",
                "-s",
                "formatOptions",
                "85",
                "-Z",
                str(max(1200, int(max_dim))),
                str(src),
                "--out",
                str(out),
            ],
            timeout=220,
        )
        if proc.returncode == 0 and out.exists() and out.stat().st_size > 0:
            return out
        out.unlink(missing_ok=True)  # type: ignore[arg-type]
        _die(f"sips preview failed for {src.name}: {(proc.stderr or proc.stdout or '').strip()}")

    # PDF preview via QuickLook first page.
    proc = _run(["qlmanage", "-t", "-s", str(max(1200, int(max_dim))), "-o", str(out_dir), str(src)], timeout=240)
    candidate = out_dir / (src.name + ".jpg")
    if proc.returncode == 0 and candidate.exists() and candidate.stat().st_size > 0:
        candidate.replace(out)
        return out
    out.unlink(missing_ok=True)  # type: ignore[arg-type]
    _die(f"qlmanage preview failed for {src.name}: {(proc.stderr or proc.stdout or '').strip()}")


def _b64_data_url(content_type: str, raw: bytes) -> str:
    import base64

    return f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"


def _openai_responses_call(payload: dict[str, Any], api_key: str, base_url: str, timeout_s: int = 90) -> dict[str, Any]:
    req = Request(
        f"{base_url.rstrip('/')}/v1/responses",
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=max(20, int(timeout_s))) as resp:
            return json.loads((resp.read() or b"{}").decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI HTTP {e.code}: {body[:1200]}") from None
    except URLError as e:
        raise RuntimeError(f"OpenAI network error: {e}") from None


def _openai_output_text(res: dict[str, Any]) -> str:
    for out in (res.get("output") or []):
        if out.get("type") == "message":
            for c in (out.get("content") or []):
                if c.get("type") in {"output_text", "text"} and isinstance(c.get("text"), str):
                    return c["text"]
    if isinstance(res.get("output_text"), str):
        return res["output_text"]
    raise RuntimeError("OpenAI response missing output_text")


def _fingerprint_schema() -> dict[str, Any]:
    props = {
        "doc_type": {"type": ["string", "null"], "description": "invoice|receipt|credit_note|soa|unknown"},
        "supplier_guess": {"type": ["string", "null"]},
        "invoice_no_guess": {"type": ["string", "null"]},
        "invoice_date_guess": {"type": ["string", "null"], "description": "YYYY-MM-DD if visible"},
        "total_guess": {"type": ["string", "null"], "description": "Document total if visible"},
        "currency_guess": {"type": ["string", "null"], "description": "USD|LBP|EUR... if visible"},
        "page_no_guess": {"type": ["integer", "null"]},
        "page_count_guess": {"type": ["integer", "null"]},
        "confidence": {"type": ["number", "null"], "description": "0..1 quality of extracted hints"},
        "reason": {"type": ["string", "null"]},
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": props,
        "required": list(props.keys()),
    }


def _fingerprint_one(
    preview_jpg: Path,
    *,
    model: str,
    api_key: str,
    base_url: str,
    filename_hint: str,
) -> dict[str, Any]:
    raw = preview_jpg.read_bytes()
    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "You are grouping AP document pages into invoices.\n"
                            "Extract only visible hints from this page image.\n"
                            "If a value is not visible, return null.\n"
                            "Date format must be YYYY-MM-DD.\n"
                            "Filename context: " + filename_hint
                        ),
                    },
                    {"type": "input_image", "image_url": _b64_data_url("image/jpeg", raw)},
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "ap_doc_fingerprint",
                "strict": True,
                "schema": _fingerprint_schema(),
            }
        },
    }
    res = _openai_responses_call(payload, api_key=api_key, base_url=base_url, timeout_s=90)
    txt = _openai_output_text(res)
    return json.loads(txt)


@dataclass
class Fingerprint:
    original_path: str
    preview_jpg: str
    doc_type: str
    supplier_guess: str
    invoice_no_guess: str
    invoice_date_guess: str
    total_guess: str
    currency_guess: str
    page_no_guess: str
    page_count_guess: str
    confidence: str
    reason: str
    fingerprint_source: str


def _load_fingerprint_cache(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return {}


def _save_fingerprint_cache(path: Path, cache: dict[str, dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")


def _group_key(fp: Fingerprint) -> tuple[str, ...]:
    sup = _norm_name(fp.supplier_guess)
    inv = _norm_invoice(fp.invoice_no_guess)
    dt = _norm(fp.invoice_date_guess)
    amt = _norm_money(fp.total_guess)
    cur = _norm(fp.currency_guess).upper()

    if sup and inv:
        return ("supplier_invoice_no", sup, inv)
    if sup and dt and amt and cur:
        return ("supplier_date_total_cur", sup, dt, amt, cur)
    if sup and dt and amt:
        return ("supplier_date_total", sup, dt, amt)
    if sup and amt and cur:
        return ("supplier_total_cur", sup, amt, cur)
    if sup and amt:
        return ("supplier_total", sup, amt)
    return ("single", hashlib.sha1(fp.original_path.encode("utf-8")).hexdigest()[:12])


def _group_confidence(key: tuple[str, ...], row_count: int) -> str:
    base = {
        "supplier_invoice_no": 0.99,
        "supplier_date_total_cur": 0.95,
        "supplier_date_total": 0.92,
        "supplier_total_cur": 0.88,
        "supplier_total": 0.82,
        "single": 0.55,
    }.get(key[0], 0.5)
    if row_count == 1:
        base = min(base, 0.86)
    return f"{base:.2f}"


def _packet_doc_types(rows: list[dict[str, str]]) -> set[str]:
    out: set[str] = set()
    for r in rows:
        d = _norm(r.get("doc_type")).lower()
        if d:
            out.add(d)
    return out


def _packet_primary_doc_type(rows: list[dict[str, str]]) -> str:
    ds = _packet_doc_types(rows)
    if not ds:
        return "unknown"
    if any(d in INVOICE_DOC_TYPES for d in ds):
        return "invoice"
    if ds == {"unknown"}:
        return "unknown"
    if len(ds) == 1:
        return next(iter(ds))
    return "mixed_non_invoice"


def _packet_allowed_by_policy(rows: list[dict[str, str]], policy: str, min_conf: float) -> tuple[bool, str]:
    ds = _packet_doc_types(rows)
    conf_raw = _norm(rows[0].get("packet_confidence")) if rows else ""
    try:
        conf = float(conf_raw or "0")
    except Exception:
        conf = 0.0
    if conf < float(min_conf):
        return False, f"below_confidence:{conf:.2f}<{float(min_conf):.2f}"

    pol = (policy or "all").strip().lower()
    if pol == "all":
        return True, ""
    if pol == "invoice_only":
        ok = any(d in INVOICE_DOC_TYPES for d in ds)
        return (ok, "" if ok else f"doc_type_filtered:{','.join(sorted(ds)) or 'unknown'}")
    if pol == "invoice_or_unknown":
        has_invoice = any(d in INVOICE_DOC_TYPES for d in ds)
        only_unknown = (ds == {"unknown"}) or (not ds)
        ok = has_invoice or only_unknown
        return (ok, "" if ok else f"doc_type_filtered:{','.join(sorted(ds))}")
    return True, ""


def _packet_sort_key_quality(item: tuple[str, list[dict[str, str]]]) -> tuple:
    pid, rows = item
    first = rows[0] if rows else {}
    key_type = _norm(first.get("packet_key_type"))
    key_rank = {
        "supplier_invoice_no": 0,
        "supplier_date_total_cur": 1,
        "supplier_date_total": 2,
        "supplier_total_cur": 3,
        "supplier_total": 4,
        "single": 5,
    }.get(key_type, 9)
    ds = _packet_doc_types(rows)
    if any(d in INVOICE_DOC_TYPES for d in ds):
        doc_rank = 0
    elif ds == {"unknown"} or not ds:
        doc_rank = 1
    else:
        doc_rank = 2
    try:
        conf = float(_norm(first.get("packet_confidence")) or "0")
    except Exception:
        conf = 0.0
    # sort by best candidates first
    return (doc_rank, key_rank, -conf, -len(rows), pid)


def _compress_for_upload(src: Path, out_dir: Path, quality: int, max_dim: int, recompress_jpeg: bool) -> Path:
    """
    "Visually-lossless" upload compressor:
    - Keep JPEG as-is by default to avoid generation loss.
    - Convert HEIC/PNG/TIFF/WEBP to JPEG for smaller upload payloads.
    """
    ext = src.suffix.lower()
    if ext == ".pdf":
        return src
    if ext in {".jpg", ".jpeg"} and not recompress_jpeg and max_dim <= 0:
        return src
    if ext in {".jpg", ".jpeg"} and not recompress_jpeg and max_dim > 0:
        # Resize only when explicitly asked.
        pass
    if ext not in CONVERT_TO_JPEG_EXTS and ext not in {".jpg", ".jpeg"}:
        return src

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{_doc_key(src)}.jpg"
    if out.exists() and out.stat().st_size > 0:
        return out
    cmd = [
        "sips",
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        str(max(80, min(100, int(quality)))),
    ]
    if max_dim > 0:
        cmd.extend(["-Z", str(max_dim)])
    cmd.extend([str(src), "--out", str(out)])
    proc = _run(cmd, timeout=220)
    if proc.returncode != 0 or (not out.exists()) or out.stat().st_size <= 0:
        out.unlink(missing_ok=True)  # type: ignore[arg-type]
        return src
    # Keep original if compression did not help enough.
    try:
        if src.stat().st_size > 0 and out.stat().st_size >= int(src.stat().st_size * 0.98):
            return src
    except Exception:
        pass
    return out


def _build_multipart_with_files(fields: dict[str, str], files_field: str, files: list[tuple[str, bytes, str]]) -> tuple[str, bytes]:
    boundary = f"----codex-ap-packet-{int(time.time() * 1000)}"
    chunks: list[bytes] = []
    for k, v in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode("utf-8"))
        chunks.append((v or "").encode("utf-8"))
        chunks.append(b"\r\n")
    for fname, fraw, ctype in files:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{files_field}"; filename="{fname}"\r\n'.encode("utf-8"))
        chunks.append(f"Content-Type: {ctype}\r\n\r\n".encode("utf-8"))
        chunks.append(fraw)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return boundary, b"".join(chunks)


def _login(api_base: str, email: str, password: str) -> dict[str, Any]:
    req = Request(
        f"{api_base.rstrip('/')}/auth/login",
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        data=json.dumps({"email": email, "password": password}).encode("utf-8"),
    )
    with urlopen(req, timeout=45) as resp:
        return json.loads((resp.read() or b"{}").decode("utf-8"))


def _select_company(api_base: str, token: str, wanted_company_name: str | None, active_company_id: str | None) -> str:
    if active_company_id and not wanted_company_name:
        return active_company_id
    req = Request(
        f"{api_base.rstrip('/')}/companies",
        method="GET",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with urlopen(req, timeout=30) as resp:
        payload = json.loads((resp.read() or b"{}").decode("utf-8"))
    companies = list(payload.get("companies") or [])
    if not companies:
        _die("no companies returned from API")
    if wanted_company_name:
        target = next((c for c in companies if _norm(c.get("name")).lower() == wanted_company_name.lower().strip()), None)
        if not target:
            names = ", ".join(sorted({_norm(c.get("name")) for c in companies if _norm(c.get("name"))}))
            _die(f"company not found: {wanted_company_name}. Available: {names}")
        cid = _norm(target.get("id"))
        req2 = Request(
            f"{api_base.rstrip('/')}/auth/select-company",
            method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"},
            data=json.dumps({"company_id": cid}).encode("utf-8"),
        )
        with urlopen(req2, timeout=20):
            pass
        return cid
    return _norm(companies[0].get("id"))


def _import_packet(
    *,
    api_base: str,
    token: str,
    company_id: str,
    files: list[tuple[str, bytes, str]],
    exchange_rate: str,
    skip_extract: bool,
    mock_extract: bool,
    async_import: bool,
    auto_create_supplier: bool,
    auto_create_items: bool,
    auto_apply: bool,
) -> dict[str, Any]:
    fields = {
        "exchange_rate": exchange_rate,
        "auto_create_supplier": "true" if auto_create_supplier else "false",
        "auto_create_items": "true" if auto_create_items else "false",
        "auto_apply": "true" if auto_apply else "false",
        "skip_extract": "true" if skip_extract else "false",
        "mock_extract": "true" if mock_extract else "false",
        "async_import": "true" if async_import else "false",
    }
    boundary, body = _build_multipart_with_files(fields, "files", files)
    req = Request(
        f"{api_base.rstrip('/')}/purchases/invoices/drafts/import-files",
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Company-Id": company_id,
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        data=body,
    )
    try:
        with urlopen(req, timeout=180) as resp:
            return json.loads((resp.read() or b"{}").decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"import API HTTP {e.code}: {body[:1200]}") from None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Folder containing AP docs (images/PDFs)")
    ap.add_argument("--out", default=".cache/ap_docs_packets", help="Cache + reports output dir")
    ap.add_argument("--openai-model", default=os.getenv("AI_DEFAULT_MODEL") or os.getenv("OPENAI_INVOICE_VISION_MODEL") or "")
    ap.add_argument("--openai-key", default=os.getenv("OPENAI_API_KEY") or "")
    ap.add_argument("--openai-base-url", default=os.getenv("OPENAI_BASE_URL") or "https://api.openai.com")
    ap.add_argument("--preview-max-dim", type=int, default=2200)
    ap.add_argument("--compress-quality", type=int, default=92, help="JPEG quality for converted uploads")
    ap.add_argument("--compress-max-dim", type=int, default=0, help="Optional max image dim for upload compression (0 = no resize)")
    ap.add_argument("--recompress-jpeg", action="store_true", help="Allow JPEG->JPEG recompression (default: false)")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep-ms", type=int, default=0)
    ap.add_argument("--api-base", default=os.getenv("POS_API_BASE") or "")
    ap.add_argument("--email", default=os.getenv("MELQARD_ADMIN_EMAIL") or "")
    ap.add_argument("--password", default=os.getenv("MELQARD_ADMIN_PASSWORD") or "")
    ap.add_argument("--company", default=os.getenv("MELQARD_COMPANY") or "")
    ap.add_argument("--import-to-api", action="store_true")
    ap.add_argument("--import-limit", type=int, default=0, help="Max number of grouped packets to import this run (0 = no limit)")
    ap.add_argument(
        "--import-doc-policy",
        default="all",
        choices=["all", "invoice_only", "invoice_or_unknown"],
        help="Filter which packet doc types are allowed for import",
    )
    ap.add_argument(
        "--import-min-packet-confidence",
        type=float,
        default=0.0,
        help="Skip packets below this grouping confidence (0..1)",
    )
    ap.add_argument(
        "--import-priority",
        default="quality",
        choices=["quality", "natural"],
        help="Packet import order: quality-aware or packet_id-natural",
    )
    ap.add_argument("--exchange-rate", default=os.getenv("POS_IMPORT_EXCHANGE_RATE") or "89500")
    ap.add_argument("--skip-extract", action="store_true")
    ap.add_argument("--mock-extract", action="store_true", help="Use backend mock extraction (no provider cost)")
    ap.add_argument("--sync-import", action="store_true", help="Disable async queueing for debugging")
    ap.add_argument("--auto-create-supplier", action="store_true")
    ap.add_argument("--auto-create-items", action="store_true")
    ap.add_argument("--auto-apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    in_dir = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out).expanduser().resolve()
    if not in_dir.exists():
        _die(f"input not found: {in_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)

    files = [p for p in sorted(in_dir.rglob("*")) if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS]
    if args.limit and args.limit > 0:
        files = files[: int(args.limit)]
    if not files:
        _die("no supported files found")

    preview_dir = out_dir / "previews"
    upload_cache_dir = out_dir / "upload_cache"
    reports_dir = out_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    cache_file = out_dir / "fingerprint_cache.json"
    cache = _load_fingerprint_cache(cache_file)

    # 1) AI fingerprint pass.
    fps: list[Fingerprint] = []
    missing_ai = (not args.openai_key) or (not args.openai_model)
    for idx, src in enumerate(files, start=1):
        key = _doc_key(src)
        rec = cache.get(key)
        preview = _ensure_preview(src, preview_dir, int(args.preview_max_dim))
        if rec is None:
            if missing_ai:
                # Fallback when no key/model: no AI grouping hints.
                rec = {
                    "doc_type": "unknown",
                    "supplier_guess": "",
                    "invoice_no_guess": "",
                    "invoice_date_guess": "",
                    "total_guess": "",
                    "currency_guess": "",
                    "page_no_guess": None,
                    "page_count_guess": None,
                    "confidence": 0.0,
                    "reason": "ai_disabled",
                    "fingerprint_source": "fallback",
                }
            else:
                try:
                    ai = _fingerprint_one(
                        preview,
                        model=str(args.openai_model),
                        api_key=str(args.openai_key),
                        base_url=str(args.openai_base_url),
                        filename_hint=src.name,
                    )
                    rec = dict(ai or {})
                    rec["fingerprint_source"] = "ai"
                except Exception as ex:
                    rec = {
                        "doc_type": "unknown",
                        "supplier_guess": "",
                        "invoice_no_guess": "",
                        "invoice_date_guess": "",
                        "total_guess": "",
                        "currency_guess": "",
                        "page_no_guess": None,
                        "page_count_guess": None,
                        "confidence": 0.0,
                        "reason": f"ai_error:{str(ex)[:180]}",
                        "fingerprint_source": "fallback",
                    }
            cache[key] = rec
            _save_fingerprint_cache(cache_file, cache)
        fps.append(
            Fingerprint(
                original_path=str(src),
                preview_jpg=str(preview),
                doc_type=_norm(rec.get("doc_type") or "unknown"),
                supplier_guess=_norm(rec.get("supplier_guess")),
                invoice_no_guess=_norm(rec.get("invoice_no_guess")),
                invoice_date_guess=_norm(rec.get("invoice_date_guess")),
                total_guess=_norm(rec.get("total_guess")),
                currency_guess=_norm(rec.get("currency_guess")),
                page_no_guess=_norm(rec.get("page_no_guess")),
                page_count_guess=_norm(rec.get("page_count_guess")),
                confidence=_norm(rec.get("confidence")),
                reason=_norm(rec.get("reason")),
                fingerprint_source=_norm(rec.get("fingerprint_source") or "cache"),
            )
        )
        if args.sleep_ms and args.sleep_ms > 0:
            time.sleep(max(0, args.sleep_ms) / 1000.0)
        if idx % 100 == 0:
            print(f"fingerprinted {idx}/{len(files)}")

    # 2) Group into packets.
    grouped: dict[tuple[str, ...], list[Fingerprint]] = {}
    for fp in fps:
        k = _group_key(fp)
        grouped.setdefault(k, []).append(fp)

    rows_out: list[dict[str, str]] = []
    packet_id = 0
    for k, members in sorted(grouped.items(), key=lambda kv: (kv[0][0], kv[0][-1])):
        packet_id += 1
        pid = f"P{packet_id:06d}"
        ordered = sorted(
            members,
            key=lambda m: (
                int(_norm(m.page_no_guess) or "9999") if (_norm(m.page_no_guess).isdigit()) else 9999,
                m.original_path,
            ),
        )
        conf = _group_confidence(k, len(ordered))
        for pos, fp in enumerate(ordered, start=1):
            rows_out.append(
                {
                    "packet_id": pid,
                    "packet_key_type": k[0],
                    "packet_confidence": conf,
                    "order_in_packet": str(pos),
                    "original_path": fp.original_path,
                    "preview_jpg": fp.preview_jpg,
                    "doc_type": fp.doc_type or "unknown",
                    "supplier_guess": fp.supplier_guess,
                    "invoice_no_guess": fp.invoice_no_guess,
                    "invoice_date_guess": fp.invoice_date_guess,
                    "total_guess": fp.total_guess,
                    "currency_guess": fp.currency_guess,
                    "page_no_guess": fp.page_no_guess,
                    "page_count_guess": fp.page_count_guess,
                    "fingerprint_confidence": fp.confidence,
                    "fingerprint_reason": fp.reason,
                    "fingerprint_source": fp.fingerprint_source,
                }
            )

    packets_csv = reports_dir / "packets.csv"
    with packets_csv.open("w", newline="", encoding="utf-8") as f:
        cols = [
            "packet_id",
            "packet_key_type",
            "packet_confidence",
            "order_in_packet",
            "original_path",
            "preview_jpg",
            "doc_type",
            "supplier_guess",
            "invoice_no_guess",
            "invoice_date_guess",
            "total_guess",
            "currency_guess",
            "page_no_guess",
            "page_count_guess",
            "fingerprint_confidence",
            "fingerprint_reason",
            "fingerprint_source",
        ]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows_out:
            w.writerow({k: r.get(k, "") for k in cols})

    summary_csv = reports_dir / "packet_summary.csv"
    by_packet: dict[str, list[dict[str, str]]] = {}
    for r in rows_out:
        by_packet.setdefault(r["packet_id"], []).append(r)
    with summary_csv.open("w", newline="", encoding="utf-8") as f:
        cols = ["packet_id", "packet_key_type", "packet_confidence", "files_count", "supplier_guess", "invoice_no_guess", "invoice_date_guess", "total_guess", "currency_guess"]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for pid, rows in sorted(by_packet.items()):
            first = rows[0]
            w.writerow(
                {
                    "packet_id": pid,
                    "packet_key_type": first.get("packet_key_type", ""),
                    "packet_confidence": first.get("packet_confidence", ""),
                    "files_count": str(len(rows)),
                    "supplier_guess": first.get("supplier_guess", ""),
                    "invoice_no_guess": first.get("invoice_no_guess", ""),
                    "invoice_date_guess": first.get("invoice_date_guess", ""),
                    "total_guess": first.get("total_guess", ""),
                    "currency_guess": first.get("currency_guess", ""),
                }
            )

    print(f"packets: {len(by_packet)} files: {len(rows_out)}")
    print(f"packets_csv={packets_csv}")
    print(f"summary_csv={summary_csv}")

    if not args.import_to_api:
        return 0

    if not args.api_base or not args.email or not args.password:
        _die("for --import-to-api, pass --api-base --email --password (or env POS_API_BASE/MELQARD_ADMIN_*)")

    login_res = _login(args.api_base, args.email, args.password)
    if login_res.get("mfa_required"):
        _die("MFA is enabled for this account; use a non-MFA admin account for automation")
    token = _norm(login_res.get("token"))
    if not token:
        _die("login succeeded but no token returned")
    company_id = _select_company(
        args.api_base,
        token,
        (_norm(args.company) or None),
        (_norm(login_res.get("active_company_id")) or None),
    )

    import_results = reports_dir / "import_results.csv"
    import_skipped = reports_dir / "import_skipped.csv"
    done_packets: set[str] = set()
    if import_results.exists():
        with import_results.open(newline="", encoding="utf-8") as f:
            r = csv.DictReader(f)
            for row in r:
                if _norm(row.get("packet_id")):
                    done_packets.add(_norm(row.get("packet_id")))
    if not import_results.exists():
        with import_results.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(
                [
                    "ts",
                    "packet_id",
                    "files_count",
                    "invoice_id",
                    "invoice_no",
                    "queued",
                    "result",
                    "error",
                ]
            )
    if not import_skipped.exists():
        with import_skipped.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(
                [
                    "ts",
                    "packet_id",
                    "packet_key_type",
                    "packet_confidence",
                    "files_count",
                    "primary_doc_type",
                    "reason",
                ]
            )

    packet_items = sorted(by_packet.items())
    if (args.import_priority or "quality").strip().lower() == "quality":
        packet_items = sorted(by_packet.items(), key=_packet_sort_key_quality)

    processed_packets = 0
    for pid, rows in packet_items:
        if pid in done_packets:
            continue
        if args.import_limit and int(args.import_limit) > 0 and processed_packets >= int(args.import_limit):
            break
        allowed, reason = _packet_allowed_by_policy(
            rows,
            str(args.import_doc_policy),
            float(args.import_min_packet_confidence or 0.0),
        )
        if not allowed:
            ts = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
            with import_skipped.open("a", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow(
                    [
                        ts,
                        pid,
                        _norm(rows[0].get("packet_key_type")) if rows else "",
                        _norm(rows[0].get("packet_confidence")) if rows else "",
                        len(rows),
                        _packet_primary_doc_type(rows),
                        reason,
                    ]
                )
            continue
        packet_files: list[tuple[str, bytes, str]] = []
        seen_hashes: set[str] = set()
        packet_doc_types = _packet_doc_types(rows)
        packet_has_invoice_pages = any(d in INVOICE_DOC_TYPES for d in packet_doc_types)
        for r in sorted(rows, key=lambda x: int(_norm(x.get("order_in_packet") or "0") or "0")):
            row_doc_type = _norm(r.get("doc_type")).lower()
            # If this packet includes invoice pages, drop clearly non-invoice pages (receipts/SOA/credit notes)
            # to avoid contaminating purchase-invoice extraction context.
            if packet_has_invoice_pages and row_doc_type in NON_INVOICE_DOC_TYPES:
                continue
            src = Path(r["original_path"]).expanduser().resolve()
            if not src.exists():
                continue
            up_path = _compress_for_upload(
                src,
                upload_cache_dir,
                quality=int(args.compress_quality),
                max_dim=int(args.compress_max_dim),
                recompress_jpeg=bool(args.recompress_jpeg),
            )
            raw = up_path.read_bytes()
            raw_sha = hashlib.sha1(raw).hexdigest()
            if raw_sha in seen_hashes:
                continue
            seen_hashes.add(raw_sha)
            ctype = mimetypes.guess_type(up_path.name)[0] or "application/octet-stream"
            packet_files.append((up_path.name if up_path != src else src.name, raw, ctype))

        ts = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
        processed_packets += 1
        if args.dry_run:
            with import_results.open("a", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow([ts, pid, len(packet_files), "", "", "", "dry_run", ""])
            continue
        if not packet_files:
            with import_results.open("a", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow([ts, pid, 0, "", "", "", "failed", "packet has no existing files"])
            continue

        try:
            res = _import_packet(
                api_base=str(args.api_base),
                token=token,
                company_id=company_id,
                files=packet_files,
                exchange_rate=str(args.exchange_rate),
                skip_extract=bool(args.skip_extract),
                mock_extract=bool(args.mock_extract),
                async_import=(not bool(args.sync_import)),
                auto_create_supplier=bool(args.auto_create_supplier),
                auto_create_items=bool(args.auto_create_items),
                auto_apply=bool(args.auto_apply),
            )
            with import_results.open("a", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow(
                    [
                        ts,
                        pid,
                        len(packet_files),
                        _norm(res.get("id")),
                        _norm(res.get("invoice_no")),
                        _norm(res.get("queued")),
                        "ok",
                        "",
                    ]
                )
            print(f"[ok] {pid} -> invoice {_norm(res.get('invoice_no')) or _norm(res.get('id'))}")
        except Exception as ex:
            with import_results.open("a", newline="", encoding="utf-8") as f:
                csv.writer(f).writerow([ts, pid, len(packet_files), "", "", "", "failed", str(ex)[:1200]])
            print(f"[failed] {pid}: {ex}")

    print(f"processed_packets={processed_packets}")
    print(f"import_results={import_results}")
    print(f"import_skipped={import_skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
