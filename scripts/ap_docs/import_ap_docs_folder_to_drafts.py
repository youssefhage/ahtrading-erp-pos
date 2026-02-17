#!/usr/bin/env python3
"""
Bulk-import AP document files into Supplier Invoice drafts (attachment-first, review-first).

Why this exists:
- Ingest thousands of invoice/receipt scans without paying for external AI extraction.
- Keep every source file attached on a draft invoice for audit + side-by-side review in Admin.
- Resume safely after interruptions using an output CSV ledger.

Default behavior:
- Calls /purchases/invoices/drafts/import-file with async_import=false and mock_extract=false
  so no background AI queue is used and no external AI spend is required.
- Optionally patches header hints (supplier_ref, invoice_date, supplier match) from ap_docs_index.csv.
"""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ALLOWED_DOC_TYPES = {"invoice", "receipt", "credit_note", "unknown"}
DEFAULT_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".pdf", ".tif", ".tiff"}


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _norm(s: Any) -> str:
    return str(s or "").strip()


def _norm_name(s: str) -> str:
    t = _norm(s).lower()
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _parse_date(v: str) -> Optional[str]:
    s = _norm(v)
    if not s:
        return None
    # Expected YYYY-MM-DD from ap_docs index.
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    return None


def _safe_supplier_ref_from_filename(path: Path) -> str:
    stem = path.stem.strip() or path.name.strip()
    stem = re.sub(r"\s+", " ", stem)
    return stem[:140]


def _build_multipart(fields: dict[str, str], file_field: str, file_name: str, file_bytes: bytes, content_type: str) -> tuple[str, bytes]:
    boundary = f"----codex-ap-{int(time.time() * 1000)}"
    chunks: list[bytes] = []

    for k, v in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode("utf-8"))
        chunks.append((v or "").encode("utf-8"))
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}\r\n".encode("utf-8"))
    chunks.append(f'Content-Disposition: form-data; name="{file_field}"; filename="{file_name}"\r\n'.encode("utf-8"))
    chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
    chunks.append(file_bytes)
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))

    return boundary, b"".join(chunks)


@dataclass(frozen=True)
class ApiClient:
    api_base: str
    token: str
    company_id: str
    timeout_s: int = 60

    def _headers(self, *, json_body: bool = True) -> dict[str, str]:
        h = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.token}",
            "X-Company-Id": self.company_id,
            "User-Agent": "codex-ap-doc-import/1.0",
        }
        if json_body:
            h["Content-Type"] = "application/json"
        return h

    def req_json(self, method: str, path: str, payload: Any | None = None) -> dict[str, Any]:
        url = self.api_base.rstrip("/") + path
        data = None
        headers = self._headers(json_body=True)
        if payload is not None:
            data = json.dumps(payload, default=str).encode("utf-8")
        req = Request(url, data=data, headers=headers, method=method.upper())
        try:
            with urlopen(req, timeout=self.timeout_s) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {e.code} {path}: {body[:800]}") from None
        except URLError as e:
            raise RuntimeError(f"network error {path}: {e}") from None

    def req_form_with_file(self, path: str, *, fields: dict[str, str], file_name: str, file_bytes: bytes, content_type: str) -> dict[str, Any]:
        url = self.api_base.rstrip("/") + path
        boundary, body = _build_multipart(fields, "file", file_name, file_bytes, content_type)
        headers = self._headers(json_body=False)
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        req = Request(url, data=body, headers=headers, method="POST")
        try:
            with urlopen(req, timeout=self.timeout_s) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {e.code} {path}: {body[:800]}") from None
        except URLError as e:
            raise RuntimeError(f"network error {path}: {e}") from None


def login(api_base: str, email: str, password: str) -> dict[str, Any]:
    url = api_base.rstrip("/") + "/auth/login"
    req = Request(
        url,
        data=json.dumps({"email": email, "password": password}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"login failed HTTP {e.code}: {body[:800]}") from None


def select_company(api_base: str, token: str, wanted_company_name: str | None, active_company_id: str | None) -> str:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    # Resolve by explicit name if provided.
    if wanted_company_name:
        req = Request(api_base.rstrip("/") + "/companies", headers=headers, method="GET")
        with urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
            j = json.loads(body) if body else {}
        companies = list(j.get("companies") or [])
        target = next((c for c in companies if _norm(c.get("name")).lower() == wanted_company_name.strip().lower()), None)
        if not target:
            names = ", ".join(sorted({_norm(c.get("name")) for c in companies if _norm(c.get("name"))}))
            raise RuntimeError(f"company not found: {wanted_company_name}. Available: {names}")
        cid = _norm(target.get("id"))
        req2 = Request(
            api_base.rstrip("/") + "/auth/select-company",
            data=json.dumps({"company_id": cid}).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urlopen(req2, timeout=20):
            pass
        return cid

    if active_company_id:
        return active_company_id

    raise RuntimeError("no active company in login response; pass --company")


@dataclass
class IndexRow:
    original_path: str
    doc_type: str
    supplier_guess: str
    invoice_date: str
    invoice_no_guess: str


def read_index_rows(index_csv: Path, doc_types: set[str]) -> list[IndexRow]:
    out: list[IndexRow] = []
    with index_csv.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            p = _norm(row.get("original_path"))
            if not p:
                continue
            dt = _norm(row.get("doc_type")).lower() or "unknown"
            if dt not in doc_types:
                continue
            out.append(
                IndexRow(
                    original_path=p,
                    doc_type=dt,
                    supplier_guess=_norm(row.get("supplier_guess")),
                    invoice_date=_norm(row.get("invoice_date")),
                    invoice_no_guess=_norm(row.get("invoice_no_guess")),
                )
            )
    return out


def discover_files(root: Path, doc_type: str = "unknown") -> list[IndexRow]:
    rows: list[IndexRow] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in DEFAULT_EXTS:
            continue
        rows.append(IndexRow(original_path=str(p), doc_type=doc_type, supplier_guess="", invoice_date="", invoice_no_guess=""))
    return rows


def load_processed_paths(results_csv: Path) -> set[str]:
    if not results_csv.exists():
        return set()
    done: set[str] = set()
    with results_csv.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            p = _norm(row.get("original_path"))
            if p:
                done.add(p)
    return done


def ensure_results_header(path: Path) -> None:
    if path.exists() and path.stat().st_size > 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "timestamp",
                "original_path",
                "doc_type",
                "invoice_id",
                "invoice_no",
                "supplier_guess",
                "matched_supplier_id",
                "matched_supplier_name",
                "supplier_ref_set",
                "invoice_date_set",
                "result",
                "error",
            ]
        )


def append_result(path: Path, row: list[str]) -> None:
    with path.open("a", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(row)


def build_supplier_index(cli: ApiClient) -> tuple[dict[str, tuple[str, str]], list[tuple[str, str, str]]]:
    by_norm: dict[str, tuple[str, str]] = {}
    raw: list[tuple[str, str, str]] = []
    try:
        res = cli.req_json("GET", "/suppliers")
    except Exception:
        return by_norm, raw
    for s in list(res.get("suppliers") or []):
        sid = _norm(s.get("id"))
        name = _norm(s.get("name"))
        code = _norm(s.get("code"))
        if not sid or not name:
            continue
        n = _norm_name(name)
        if n and n not in by_norm:
            by_norm[n] = (sid, name)
        raw.append((sid, name, code))
    return by_norm, raw


def match_supplier(supplier_guess: str, by_norm: dict[str, tuple[str, str]], raw: list[tuple[str, str, str]]) -> tuple[str, str]:
    guess = _norm(supplier_guess)
    if not guess:
        return "", ""

    n = _norm_name(guess)
    if n and n in by_norm:
        return by_norm[n]

    # Conservative fallback: unique contains match on normalized name.
    if n and len(n) >= 5:
        hits = [(sid, name) for sid, name, _ in raw if n in _norm_name(name) or _norm_name(name) in n]
        uniq = {(sid, name) for sid, name in hits}
        if len(uniq) == 1:
            return next(iter(uniq))

    # Optional code exact.
    up = guess.upper()
    for sid, name, code in raw:
        if code and code.upper() == up:
            return sid, name
    return "", ""


def import_one(
    cli: ApiClient,
    src: Path,
    *,
    exchange_rate: str,
    supplier_guess: str,
    invoice_date_hint: str,
    invoice_no_hint: str,
    supplier_map: dict[str, tuple[str, str]],
    supplier_raw: list[tuple[str, str, str]],
    dry_run: bool,
) -> dict[str, str]:
    guessed_ct = mimetypes.guess_type(str(src.name))[0] or "application/octet-stream"
    if dry_run:
        return {
            "invoice_id": "",
            "invoice_no": "",
            "matched_supplier_id": "",
            "matched_supplier_name": "",
            "supplier_ref_set": invoice_no_hint or _safe_supplier_ref_from_filename(src),
            "invoice_date_set": _parse_date(invoice_date_hint) or "",
            "result": "dry_run",
            "error": "",
        }

    raw = src.read_bytes()
    res = cli.req_form_with_file(
        "/purchases/invoices/drafts/import-file",
        fields={
            "exchange_rate": str(exchange_rate),
            "auto_create_supplier": "false",
            "auto_create_items": "false",
            "auto_apply": "false",
            "skip_extract": "true",
            "mock_extract": "false",
            "async_import": "false",
        },
        file_name=src.name,
        file_bytes=raw,
        content_type=guessed_ct,
    )

    invoice_id = _norm(res.get("id"))
    invoice_no = _norm(res.get("invoice_no"))
    if not invoice_id:
        raise RuntimeError(f"import-file returned no invoice id for {src.name}")

    supplier_id, supplier_name = match_supplier(supplier_guess, supplier_map, supplier_raw)
    supplier_ref = _norm(invoice_no_hint) or _safe_supplier_ref_from_filename(src)
    invoice_date = _parse_date(invoice_date_hint)

    patch: dict[str, Any] = {"exchange_rate": float(exchange_rate)}
    if supplier_id:
        patch["supplier_id"] = supplier_id
    if supplier_ref:
        patch["supplier_ref"] = supplier_ref
    if invoice_date:
        patch["invoice_date"] = invoice_date
        patch["due_date"] = invoice_date

    if patch:
        cli.req_json("PATCH", f"/purchases/invoices/{invoice_id}/draft", patch)

    return {
        "invoice_id": invoice_id,
        "invoice_no": invoice_no,
        "matched_supplier_id": supplier_id,
        "matched_supplier_name": supplier_name,
        "supplier_ref_set": supplier_ref,
        "invoice_date_set": invoice_date or "",
        "result": "ok",
        "error": "",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default=os.getenv("POS_API_BASE") or "http://127.0.0.1:8000")
    ap.add_argument("--email", default=os.getenv("MELQARD_ADMIN_EMAIL") or "")
    ap.add_argument("--password", default=os.getenv("MELQARD_ADMIN_PASSWORD") or "")
    ap.add_argument("--company", default=os.getenv("MELQARD_COMPANY") or "", help="Company name (optional if login already has active company)")
    ap.add_argument("--source-dir", default="", help="Folder to scan when --index-csv is not provided")
    ap.add_argument("--index-csv", default="", help="Optional ap_docs_index.csv path (preferred for header hints)")
    ap.add_argument("--doc-types", default="invoice,receipt,credit_note,unknown")
    ap.add_argument("--exchange-rate", default=os.getenv("POS_IMPORT_EXCHANGE_RATE") or "90000")
    ap.add_argument("--limit", type=int, default=0, help="Optional cap on number of files")
    ap.add_argument("--sleep-ms", type=int, default=0, help="Delay between files")
    ap.add_argument("--out", default=".cache/ap_docs_import")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.email or not args.password:
        _die("missing credentials; pass --email/--password or set MELQARD_ADMIN_EMAIL/MELQARD_ADMIN_PASSWORD")

    try:
        ex = float(str(args.exchange_rate).strip())
        if ex <= 0:
            raise ValueError("exchange_rate must be > 0")
    except Exception:
        _die("invalid --exchange-rate (expected positive number)")

    doc_types = {_norm(x).lower() for x in str(args.doc_types or "").split(",") if _norm(x)}
    if not doc_types:
        _die("--doc-types resolved to empty set")
    invalid = sorted([x for x in doc_types if x not in ALLOWED_DOC_TYPES])
    if invalid:
        _die(f"unsupported --doc-types: {', '.join(invalid)}")

    out_dir = Path(args.out)
    results_csv = out_dir / "import_results.csv"
    ensure_results_header(results_csv)
    processed = load_processed_paths(results_csv)

    # Build import row list.
    rows: list[IndexRow]
    if _norm(args.index_csv):
        idx = Path(args.index_csv).expanduser().resolve()
        if not idx.exists():
            _die(f"index csv not found: {idx}")
        rows = read_index_rows(idx, doc_types)
    else:
        src_dir = Path(_norm(args.source_dir) or ".").expanduser().resolve()
        if not src_dir.exists() or not src_dir.is_dir():
            _die("pass a valid --source-dir (or provide --index-csv)")
        rows = discover_files(src_dir)

    if not rows:
        _die("no files matched")

    # Keep first occurrence per file path.
    dedup: dict[str, IndexRow] = {}
    for r in rows:
        p = str(Path(r.original_path).expanduser())
        if p not in dedup:
            dedup[p] = r
    rows = list(dedup.values())

    # Filter processed + missing.
    pending: list[IndexRow] = []
    missing = 0
    for r in rows:
        p = str(Path(r.original_path).expanduser())
        if p in processed:
            continue
        if not Path(p).exists():
            missing += 1
            continue
        pending.append(r)

    if args.limit and args.limit > 0:
        pending = pending[: args.limit]

    print(f"files total={len(rows)} pending={len(pending)} already_done={len(processed)} missing={missing}")
    if not pending:
        print("nothing to do")
        return 0

    # Auth.
    login_res = login(args.api_base, args.email, args.password)
    if login_res.get("mfa_required"):
        _die("MFA is enabled for this user; use a non-MFA admin account")
    token = _norm(login_res.get("token"))
    if not token:
        _die("login succeeded but no token returned")
    active_company_id = _norm(login_res.get("active_company_id")) or None
    company_id = select_company(args.api_base, token, _norm(args.company) or None, active_company_id)

    cli = ApiClient(api_base=args.api_base, token=token, company_id=company_id)
    supplier_map, supplier_raw = build_supplier_index(cli)

    ok = 0
    failed = 0
    for i, r in enumerate(pending, start=1):
        src = Path(r.original_path).expanduser().resolve()
        print(f"[{i}/{len(pending)}] {src.name}")
        try:
            result = import_one(
                cli,
                src,
                exchange_rate=str(ex),
                supplier_guess=r.supplier_guess,
                invoice_date_hint=r.invoice_date,
                invoice_no_hint=r.invoice_no_guess,
                supplier_map=supplier_map,
                supplier_raw=supplier_raw,
                dry_run=bool(args.dry_run),
            )
            ok += 1
            append_result(
                results_csv,
                [
                    _now_iso(),
                    str(src),
                    r.doc_type,
                    result.get("invoice_id", ""),
                    result.get("invoice_no", ""),
                    r.supplier_guess,
                    result.get("matched_supplier_id", ""),
                    result.get("matched_supplier_name", ""),
                    result.get("supplier_ref_set", ""),
                    result.get("invoice_date_set", ""),
                    result.get("result", "ok"),
                    "",
                ],
            )
        except Exception as exn:
            failed += 1
            append_result(
                results_csv,
                [
                    _now_iso(),
                    str(src),
                    r.doc_type,
                    "",
                    "",
                    r.supplier_guess,
                    "",
                    "",
                    "",
                    "",
                    "failed",
                    str(exn)[:1000],
                ],
            )
            print(f"  failed: {exn}")

        if args.sleep_ms and args.sleep_ms > 0:
            time.sleep(max(0, args.sleep_ms) / 1000.0)

    print(f"done: ok={ok} failed={failed} results={results_csv}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
