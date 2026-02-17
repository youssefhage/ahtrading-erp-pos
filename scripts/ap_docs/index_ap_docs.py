#!/usr/bin/env python3
"""
Index messy invoice/receipt photos:
- Converts HEIC -> JPEG preview (downscaled) for OCR stability.
- Runs macOS Vision OCR via `scripts/ap_docs/vision_ocr.swift`.
- Extracts best-effort supplier/date/doc-type hints.
- Outputs CSV + an organized symlink tree by year/supplier.

Designed to be incremental: stores OCR text in a cache keyed by (path, size, mtime).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Optional


INVOICE_WORDS = [
    "invoice",
    "tax invoice",
    "فاتورة",
    "facture",
]
RECEIPT_WORDS = [
    "receipt",
    "cash receipt",
    "recu",
    "reçu",
    "وصل",
]
CREDIT_WORDS = [
    "credit note",
    "avoir",
    "مذكرة دائن",
]

DATE_KWS = ["invoice date", "date", "facture", "فاتورة", "التاريخ"]

BUYER_KWS = ["cust", "customer", "client", "bill to", "sold to", "ship to"]

BAD_SUPPLIER_PREFIX = [
    "c.r",
    "vat",
    "cust",
    "customer",
    "client",
    "contact",
    "address",
    "tel",
    "phone",
    "fax",
    "date",
    "invoice",
    "facture",
    "bill to",
    "sold to",
    "ship to",
    "item",
    "qty",
    "barcode",
    "unit",
    "price",
    "page",
]

# Best-effort mapping: we can refine/extend these once we see more buyer name variants.
COMPANY_HINTS = {
    "AH Trading": ["ah trading", "antoine al hajj", "antoine al haji", "al hajj tr", "al haji tr"],
    "Unofficial": ["unofficial", "un-official"],
}


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _run(cmd: list[str], *, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def _safe_name(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"[\\/]+", "-", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"[^0-9A-Za-z ._()\\-]+", "", s).strip()
    return s[:80] or "unknown"


def _doc_key(path: Path) -> str:
    st = path.stat()
    base = f"{path.as_posix()}|{st.st_size}|{int(st.st_mtime)}".encode("utf-8", errors="ignore")
    return hashlib.sha1(base).hexdigest()


def _ensure_jpeg_preview(src: Path, *, out_dir: Path, max_dim: int = 2200) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = src.suffix.lower().lstrip(".")
    key = _doc_key(src)
    out = out_dir / f"{key}.jpg"
    if out.exists() and out.stat().st_size > 0:
        return out

    # `sips` handles HEIC/JPG/PNG and can resize+convert quickly on macOS.
    cmd = [
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
    ]
    proc = _run(cmd, timeout=180)
    if proc.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        # Cleanup partial output.
        try:
            out.unlink(missing_ok=True)  # type: ignore[arg-type]
        except Exception:
            pass
        _die(f"sips failed for {src.name} ({ext}): {proc.stderr.strip() or proc.stdout.strip() or 'unknown error'}")
    return out


def _load_cached_text(cache_dir: Path, key: str) -> Optional[str]:
    p = cache_dir / f"{key}.txt"
    if not p.exists():
        return None
    try:
        return p.read_text("utf-8", errors="replace")
    except Exception:
        return None


def _store_cached_text(cache_dir: Path, key: str, text: str) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / f"{key}.txt").write_text(text or "", "utf-8")


def _vision_ocr(swift_path: Path, img_paths: list[Path]) -> dict[str, str]:
    # Run in chunks to keep invocation overhead reasonable.
    out: dict[str, str] = {}
    if not img_paths:
        return out
    cmd = ["swift", str(swift_path), *[str(p) for p in img_paths]]
    proc = _run(cmd, timeout=900)
    if proc.returncode != 0 and not proc.stdout.strip():
        _die(f"vision ocr failed: {proc.stderr.strip() or 'unknown error'}")
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        p = rec.get("path")
        if not isinstance(p, str) or not p:
            continue
        if rec.get("ok") is True:
            out[p] = str(rec.get("text") or "")
        else:
            # Keep empty text on failures; caller can still group by file metadata.
            out[p] = ""
    return out


# Accept common separators: '-', '/', '.'
_re_date_ymd = re.compile(r"\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b")
_re_date_dmy = re.compile(r"\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](\d{2}|20\d{2})\b")
_re_date_mdy = re.compile(r"\b(0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])[-/.](\d{2}|20\d{2})\b")


def _parse_date_from_text(text: str) -> Optional[date]:
    if not text:
        return None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # 1) Prefer lines that look like header "Date: .."
    for ln in lines[:80]:
        low = ln.lower()
        if any(k in low for k in DATE_KWS):
            for rx, mode in ((_re_date_ymd, "ymd"), (_re_date_dmy, "dmy"), (_re_date_mdy, "mdy")):
                m = rx.search(ln)
                if m:
                    d = _to_date(m, mode)
                    if d:
                        return d

    # 2) Fallback: first plausible date anywhere.
    for rx, mode in ((_re_date_ymd, "ymd"), (_re_date_dmy, "dmy"), (_re_date_mdy, "mdy")):
        m = rx.search(text)
        if m:
            d = _to_date(m, mode)
            if d:
                return d
    return None


def _to_date(m: re.Match, mode: str) -> Optional[date]:
    try:
        parts = [int(x) for x in m.groups()]
    except Exception:
        return None
    if len(parts) != 3:
        return None
    a, b, c = parts
    if mode == "ymd":
        y, mm, dd = a, b, c
    elif mode == "dmy":
        dd, mm, y = a, b, c
    else:  # mdy
        mm, dd, y = a, b, c
    if y < 100:
        y = 2000 + y
    try:
        d = date(y, mm, dd)
    except Exception:
        return None
    if d.year < 2000 or d.year > (date.today().year + 1):
        return None
    return d


def _guess_doc_type(text: str) -> str:
    low = (text or "").lower()
    # Strong invoice-like indicators.
    if "tax invoice" in low or "vat" in low or "tva" in low or "fiscal stamp" in low:
        return "invoice"
    if any(w in low for w in CREDIT_WORDS):
        return "credit_note"
    if any(w in low for w in RECEIPT_WORDS):
        # Some invoices include the word "receipt" in a footer; keep invoice if VAT-like signals exist.
        if "vat" in low or "tva" in low:
            return "invoice"
        return "receipt"
    if any(w in low for w in INVOICE_WORDS):
        return "invoice"
    return "unknown"


def _guess_buyer(text: str) -> str:
    if not text:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for ln in lines[:140]:
        low = ln.lower().strip()
        if any(low.startswith(k) for k in BUYER_KWS) or any(f"{k} " in low for k in BUYER_KWS):
            cleaned = re.sub(r"(?i)^(cust(omer)?|client)\b\s*[:\-]*\s*", "", ln).strip()
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            return cleaned[:160]
    return ""


def _guess_company(buyer: str, text: str) -> str:
    hay = f"{buyer}\\n{text}".lower()
    for company, pats in COMPANY_HINTS.items():
        for p in pats:
            if p and p in hay:
                return company
    return ""


def _guess_supplier(text: str) -> str:
    if not text:
        return "unknown"
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Score candidate lines from top and bottom regions.
    region = lines[:25] + lines[-25:]
    best_line = ""
    best_score = -10_000
    for i, ln in enumerate(region):
        l = re.sub(r"\s+", " ", ln).strip()
        low = l.lower()
        if len(l) < 3:
            continue
        if any(low.startswith(p) for p in BAD_SUPPLIER_PREFIX):
            continue
        if any(k in low for k in BUYER_KWS):
            continue
        if any(tok in low for tok in ["invoice", "facture", "receipt"]):
            continue
        if "@" in l:
            continue

        # Avoid item/price/table-like lines.
        if any(tok in low for tok in ["qty", "barcode", "unit price", "unite price", "subtotal", "net total"]):
            continue

        letters = sum(1 for c in l if c.isalpha())
        digits = sum(1 for c in l if c.isdigit())
        if letters < 4:
            continue
        if digits > letters:
            continue

        score = 0
        if i < 8:
            score += 25
        if l.upper() == l and letters >= 6:
            score += 20
        if any(x in low for x in [" s.a.l", "sal", " sarl", "ltd", "co", "company", "trading", "group", "est"]):
            score += 15

        window = " ".join(region[max(0, i - 1) : min(len(region), i + 2)]).lower()
        if "www." in window or ".com" in window or ".net" in window:
            score += 18
        if "vat" in window or "c.r." in window or "reg" in window:
            score += 10
        if any(x in low for x in ["street", "st.", "road", "beirut", "lebanon", "metn", "po box", "p.o", "box"]):
            score -= 8

        if score > best_score:
            best_score = score
            best_line = l

    return _safe_name(best_line) if best_line else "unknown"


_re_money = re.compile(r"(?<!\\w)(\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?|\\d+(?:\\.\\d{2})?)(?!\\w)")


def _to_decimal_str(s: str) -> str:
    t = (s or "").strip().replace(",", "")
    t = re.sub(r"[^0-9.\\-]", "", t)
    return t


def _extract_totals(text: str) -> tuple[str, str]:
    """
    Returns (total_usd, total_lbp) best-effort as strings ('' if not found).
    """
    if not text:
        return "", ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    focus: list[str] = []
    for ln in (lines[-80:] + lines[:40]):
        low = ln.lower()
        if any(k in low for k in ["total", "net total", "amount due", "to pay", "balance", "grand total"]):
            focus.append(ln)
    blob = "\n".join(focus) if focus else text

    usd = ""
    lbp = ""
    for ln in blob.splitlines():
        low = ln.lower()
        amounts = _re_money.findall(ln)
        if not amounts:
            continue
        if "usd" in low or "$" in ln:
            usd = _to_decimal_str(amounts[-1])
        if "lbp" in low or " ll" in low or "l.l" in low:
            lbp = _to_decimal_str(amounts[-1])

    if not lbp:
        m = re.search(r"(?i)(\d{1,3}(?:,\d{3})+)(?:\s*(?:ll|lbp|l\.l))", blob)
        if m:
            lbp = _to_decimal_str(m.group(1))
    if not usd:
        m = re.search(r"(?i)(\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*(?:usd|\$)", blob)
        if m:
            usd = _to_decimal_str(m.group(1))
    return usd, lbp


def _extract_invoice_no(text: str) -> str:
    if not text:
        return ""
    pats = [
        r"(?i)\b(?:invoice|inv|facture)\s*(?:no|n°|#|:)\s*([A-Z0-9][-/A-Z0-9]{3,})",
        r"(?i)\bSIH\s*(\d{5,})\b",
    ]
    for p in pats:
        m = re.search(p, text)
        if m:
            g = (m.group(1) or "").strip()
            if g:
                return g[:64]
    return ""


def _settlement_hint(text: str, doc_type: str) -> str:
    low = (text or "").lower()
    if doc_type == "receipt":
        return "likely_paid"
    if any(k in low for k in ["paid", "payment received", "cash", "visa", "mastercard", "approved", "auth code"]):
        return "maybe_paid"
    if any(k in low for k in ["amount due", "balance due", "unpaid", "due date"]):
        return "likely_unpaid"
    return ""


def _capture_date_guess(src: Path) -> str:
    try:
        proc = _run(["sips", "-g", "creation", str(src)], timeout=8)
        if proc.returncode == 0:
            for ln in (proc.stdout or "").splitlines():
                if "creation:" in ln:
                    val = ln.split("creation:", 1)[1].strip()
                    if re.match(r"^20\\d{2}:\\d{2}:\\d{2}", val):
                        return val[:10].replace(":", "-")
    except Exception:
        pass
    try:
        st = src.stat()
        return date.fromtimestamp(st.st_mtime).isoformat()
    except Exception:
        return ""


@dataclass
class DocRow:
    original_path: str
    preview_jpg: str
    doc_type: str
    supplier_guess: str
    buyer_guess: str
    company_guess: str
    invoice_date: str
    year: str
    capture_date: str
    invoice_no_guess: str
    total_usd_guess: str
    total_lbp_guess: str
    settlement_hint: str


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Input folder containing photos (HEIC/JPG/PNG)")
    ap.add_argument("--out", default=".cache/ap_docs", help="Output folder for cache + reports")
    ap.add_argument("--limit", type=int, default=0, help="Process at most N files (0=all)")
    ap.add_argument("--organize", action="store_true", help="Create organized symlink tree by year/supplier")
    ap.add_argument("--default-company", default="", help="Fallback company label when company cannot be inferred")
    ap.add_argument("--max-dim", type=int, default=2200, help="Max pixel dimension for preview JPGs")
    ap.add_argument("--chunk", type=int, default=12, help="OCR chunk size (swift invocation batch)")
    args = ap.parse_args()

    in_dir = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out).expanduser().resolve()
    if not in_dir.exists():
        _die(f"input not found: {in_dir}")

    swift_path = (Path(__file__).parent / "vision_ocr.swift").resolve()
    if not swift_path.exists():
        _die(f"missing swift ocr helper: {swift_path}")

    preview_dir = out_dir / "previews_jpg"
    ocr_cache_dir = out_dir / "ocr_text"
    report_dir = out_dir / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)

    exts = {".heic", ".jpg", ".jpeg", ".png"}
    files = [p for p in in_dir.rglob("*") if p.is_file() and p.suffix.lower() in exts]
    files.sort()
    if args.limit and args.limit > 0:
        files = files[: args.limit]
    if not files:
        _die("no images found")

    rows: list[DocRow] = []
    pending_for_ocr: list[tuple[Path, str, Path]] = []
    cached_text_by_key: dict[str, str] = {}

    for src in files:
        key = _doc_key(src)
        txt = _load_cached_text(ocr_cache_dir, key)
        if txt is not None:
            cached_text_by_key[key] = txt
            continue
        preview = _ensure_jpeg_preview(src, out_dir=preview_dir, max_dim=int(args.max_dim))
        pending_for_ocr.append((src, key, preview))

    # OCR new documents.
    if pending_for_ocr:
        for i in range(0, len(pending_for_ocr), int(args.chunk)):
            chunk = pending_for_ocr[i : i + int(args.chunk)]
            previews = [p for (_, _, p) in chunk]
            txt_by_preview = _vision_ocr(swift_path, previews)
            for (src, key, preview) in chunk:
                txt = txt_by_preview.get(str(preview), "")
                _store_cached_text(ocr_cache_dir, key, txt)
                cached_text_by_key[key] = txt

    # Build report rows (for all files).
    for src in files:
        key = _doc_key(src)
        txt = cached_text_by_key.get(key) or ""
        preview = (preview_dir / f"{key}.jpg").resolve()
        if not preview.exists():
            # For already-cached OCR entries created before previews existed.
            try:
                preview = _ensure_jpeg_preview(src, out_dir=preview_dir, max_dim=int(args.max_dim)).resolve()
            except Exception:
                preview = Path("")

        doc_type = _guess_doc_type(txt)
        buyer = _guess_buyer(txt)
        supplier = _guess_supplier(txt)
        inv_date = _parse_date_from_text(txt)
        inv_date_s = inv_date.isoformat() if inv_date else ""
        cap_date = _capture_date_guess(src)
        year = str(inv_date.year) if inv_date else (cap_date[:4] if cap_date else "")
        inv_no = _extract_invoice_no(txt)
        total_usd, total_lbp = _extract_totals(txt)
        company = _guess_company(buyer, txt)
        if not company and (args.default_company or "").strip():
            company = (args.default_company or "").strip()
        settle = _settlement_hint(txt, doc_type)

        rows.append(
            DocRow(
                original_path=str(src),
                preview_jpg=str(preview) if preview else "",
                doc_type=doc_type,
                supplier_guess=supplier,
                buyer_guess=buyer,
                company_guess=company,
                invoice_date=inv_date_s,
                year=year,
                capture_date=cap_date,
                invoice_no_guess=inv_no,
                total_usd_guess=total_usd,
                total_lbp_guess=total_lbp,
                settlement_hint=settle,
            )
        )

    # Write CSV.
    csv_path = report_dir / "ap_docs_index.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "original_path",
                "preview_jpg",
                "doc_type",
                "supplier_guess",
                "buyer_guess",
                "company_guess",
                "invoice_date",
                "capture_date",
                "year",
                "invoice_no_guess",
                "total_usd_guess",
                "total_lbp_guess",
                "settlement_hint",
            ]
        )
        for r in rows:
            w.writerow(
                [
                    r.original_path,
                    r.preview_jpg,
                    r.doc_type,
                    r.supplier_guess,
                    r.buyer_guess,
                    r.company_guess,
                    r.invoice_date,
                    r.capture_date,
                    r.year,
                    r.invoice_no_guess,
                    r.total_usd_guess,
                    r.total_lbp_guess,
                    r.settlement_hint,
                ]
            )

    # Write summary (group by year/company/supplier).
    def _to_num(s: str) -> float:
        try:
            return float(str(s or "").strip() or 0)
        except Exception:
            return 0.0

    summary: dict[tuple[str, str, str], dict[str, float]] = {}
    for r in rows:
        key = (r.year or "unknown-year", r.company_guess or "unknown-company", r.supplier_guess or "unknown-supplier")
        rec = summary.get(key)
        if not rec:
            rec = {
                "docs": 0.0,
                "invoice": 0.0,
                "receipt": 0.0,
                "credit_note": 0.0,
                "unknown": 0.0,
                "usd": 0.0,
                "lbp": 0.0,
            }
            summary[key] = rec
        rec["docs"] += 1.0
        rec[r.doc_type if r.doc_type in {"invoice", "receipt", "credit_note"} else "unknown"] += 1.0
        rec["usd"] += _to_num(r.total_usd_guess)
        rec["lbp"] += _to_num(r.total_lbp_guess)

    summary_path = report_dir / "summary_by_year_company_supplier.csv"
    with summary_path.open("w", newline="", encoding="utf-8") as f2:
        w2 = csv.writer(f2)
        w2.writerow(
            [
                "year",
                "company",
                "supplier",
                "docs",
                "invoices",
                "receipts",
                "credits",
                "unknown",
                "total_usd_guess",
                "total_lbp_guess",
            ]
        )
        for (y, c, s), rec in sorted(summary.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2])):
            w2.writerow(
                [
                    y,
                    c,
                    s,
                    int(rec["docs"]),
                    int(rec["invoice"]),
                    int(rec["receipt"]),
                    int(rec["credit_note"]),
                    int(rec["unknown"]),
                    f"{rec['usd']:.2f}" if rec["usd"] else "",
                    f"{rec['lbp']:.0f}" if rec["lbp"] else "",
                ]
            )

    # Optional: symlink organization.
    if args.organize:
        org_root = out_dir / "organized"
        org_root.mkdir(parents=True, exist_ok=True)
        for r in rows:
            y = r.year or "unknown-year"
            c = r.company_guess or "unknown-company"
            s = r.supplier_guess or "unknown-supplier"
            t = r.doc_type or "unknown"
            dest_dir = org_root / y / _safe_name(c) / _safe_name(s) / t
            dest_dir.mkdir(parents=True, exist_ok=True)
            src = Path(r.original_path)
            dest = dest_dir / src.name
            if dest.exists():
                continue
            try:
                dest.symlink_to(src)
            except Exception:
                # Fallback: copy if symlink fails (e.g. cross-device restrictions).
                try:
                    import shutil

                    shutil.copy2(src, dest)
                except Exception:
                    pass

    print(str(csv_path))


if __name__ == "__main__":
    main()
