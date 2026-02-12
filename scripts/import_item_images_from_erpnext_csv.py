#!/usr/bin/env python3
"""
Import ERPNext item images into hosted POS as item attachments.

Source:
- ERPNext Item CSV export (default: Data AH Trading/Item.csv), using the "Image" column.

Target:
- Upload image bytes to POS /attachments with entity_type=item_image, then patch items.image_attachment_id.

Notes:
- This script does not require ERP API credentials for image bytes when file URLs are public.
- It uses a browser-like User-Agent for ERP file fetches (some CDNs block default script UAs).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys
import time
import uuid
import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener

import http.cookiejar


def _die(msg: str) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(2)


def _norm(v: Any) -> str:
    return str(v or "").strip()


def _strip_wrapped_quotes(v: Any) -> str:
    s = _norm(v)
    while len(s) >= 2 and s.startswith('"') and s.endswith('"'):
        s = s[1:-1].strip()
    return s


def _chunks(xs: list[Any], n: int):
    for i in range(0, len(xs), n):
        yield xs[i : i + n]


def _sanitize_filename(name: str, fallback: str) -> str:
    n = _norm(name)
    if not n:
        return fallback
    n = n.replace("/", "_").replace("\\", "_").replace("\x00", "")
    return n or fallback


def _guess_ext_from_content_type(content_type: str) -> str:
    ct = (content_type or "").lower()
    if "jpeg" in ct or "jpg" in ct:
        return ".jpg"
    if "png" in ct:
        return ".png"
    if "webp" in ct:
        return ".webp"
    if "gif" in ct:
        return ".gif"
    if "bmp" in ct:
        return ".bmp"
    if "svg" in ct:
        return ".svg"
    return ".bin"


def _in_shard(sku: str, shard_count: int, shard_index: int) -> bool:
    if shard_count <= 1:
        return True
    if shard_index < 0 or shard_index >= shard_count:
        return False
    h = hashlib.sha1(sku.encode("utf-8", errors="ignore")).hexdigest()
    bucket = int(h[:8], 16) % shard_count
    return bucket == shard_index


def _build_multipart(
    fields: dict[str, str],
    file_field: str,
    filename: str,
    content_type: str,
    payload: bytes,
) -> tuple[bytes, str]:
    boundary = f"----codex-{uuid.uuid4().hex}"
    buf = io.BytesIO()

    for k, v in fields.items():
        buf.write(f"--{boundary}\r\n".encode("utf-8"))
        buf.write(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode("utf-8"))
        buf.write(str(v).encode("utf-8"))
        buf.write(b"\r\n")

    buf.write(f"--{boundary}\r\n".encode("utf-8"))
    buf.write(
        (
            f'Content-Disposition: form-data; name="{file_field}"; '
            f'filename="{filename}"\r\n'
        ).encode("utf-8")
    )
    buf.write(f"Content-Type: {content_type or 'application/octet-stream'}\r\n\r\n".encode("utf-8"))
    buf.write(payload)
    buf.write(b"\r\n")
    buf.write(f"--{boundary}--\r\n".encode("utf-8"))

    return buf.getvalue(), f"multipart/form-data; boundary={boundary}"


@dataclass(frozen=True)
class PosClient:
    api_base: str
    timeout_s: int = 60

    def __post_init__(self):
        object.__setattr__(self, "jar", http.cookiejar.CookieJar())
        object.__setattr__(self, "opener", build_opener(HTTPCookieProcessor(self.jar)))

    def _req_json(
        self,
        method: str,
        path: str,
        body: Any | None = None,
        headers: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        url = self.api_base.rstrip("/") + path
        data = None
        hdrs = {"Accept": "application/json", "User-Agent": "codex-pos-image-import/1.0"}
        if headers:
            hdrs.update(headers)
        if body is not None:
            data = json.dumps(body, default=str).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        req = Request(url=url, method=method, data=data, headers=hdrs)
        try:
            with self.opener.open(req, timeout=self.timeout_s) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"POS {method} {path} -> HTTP {e.code}: {raw[:400]}") from None
        except URLError as e:
            raise RuntimeError(f"POS {method} {path} -> network error: {e}") from None

    def _req_multipart(
        self,
        path: str,
        body: bytes,
        content_type: str,
        headers: Optional[dict[str, str]] = None,
    ) -> dict[str, Any]:
        url = self.api_base.rstrip("/") + path
        hdrs = {
            "Accept": "application/json",
            "Content-Type": content_type,
            "User-Agent": "codex-pos-image-import/1.0",
        }
        if headers:
            hdrs.update(headers)
        req = Request(url=url, method="POST", data=body, headers=hdrs)
        try:
            with self.opener.open(req, timeout=self.timeout_s) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"POS POST {path} -> HTTP {e.code}: {raw[:400]}") from None
        except URLError as e:
            raise RuntimeError(f"POS POST {path} -> network error: {e}") from None

    def login(self, email: str, password: str) -> None:
        self._req_json("POST", "/auth/login", {"email": email, "password": password})

    def get_companies(self) -> list[dict[str, Any]]:
        return list(self._req_json("GET", "/companies").get("companies") or [])

    def list_items(self, company_id: str) -> list[dict[str, Any]]:
        return list(self._req_json("GET", "/items", headers={"X-Company-Id": company_id}).get("items") or [])

    def upload_item_image_attachment(
        self,
        company_id: str,
        item_id: str,
        filename: str,
        content_type: str,
        payload: bytes,
    ) -> str:
        body, ctype = _build_multipart(
            fields={"entity_type": "item_image", "entity_id": item_id},
            file_field="file",
            filename=filename,
            content_type=content_type,
            payload=payload,
        )
        res = self._req_multipart("/attachments", body, ctype, headers={"X-Company-Id": company_id})
        aid = _norm(res.get("id"))
        if not aid:
            raise RuntimeError("attachment upload returned empty id")
        return aid

    def patch_item_image(
        self,
        company_id: str,
        item_id: str,
        attachment_id: str,
        image_alt: str | None = None,
    ) -> None:
        body: dict[str, Any] = {"image_attachment_id": attachment_id}
        if image_alt is not None:
            body["image_alt"] = image_alt
        self._req_json("PATCH", f"/items/{quote(item_id, safe='')}", body, headers={"X-Company-Id": company_id})


@dataclass(frozen=True)
class ErpImageClient:
    erp_base: str
    timeout_s: int = 30
    retries: int = 3

    def __post_init__(self):
        object.__setattr__(self, "opener", build_opener())

    def _image_url(self, ref: str) -> str:
        r = _strip_wrapped_quotes(ref)
        if not r:
            return ""
        if r.startswith("http://") or r.startswith("https://"):
            parsed = urlparse(r)
            safe_path = quote(parsed.path or "/", safe="/%:@")
            q = f"?{parsed.query}" if parsed.query else ""
            return f"{parsed.scheme}://{parsed.netloc}{safe_path}{q}"
        if not r.startswith("/"):
            r = "/" + r
        safe_path = quote(r, safe="/%:@")
        return self.erp_base.rstrip("/") + safe_path

    def fetch(self, image_ref: str) -> tuple[bytes, str, str]:
        """
        Returns: (bytes, content_type, final_url)
        """
        url = self._image_url(image_ref)
        if not url:
            raise RuntimeError("empty image URL")
        last_err: Exception | None = None
        for attempt in range(self.retries):
            req = Request(
                url,
                method="GET",
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    "Referer": self.erp_base.rstrip("/") + "/",
                },
            )
            try:
                with self.opener.open(req, timeout=self.timeout_s) as resp:
                    payload = resp.read()
                    ctype = _norm(resp.headers.get("Content-Type")) or "application/octet-stream"
                    final_url = resp.geturl()
                    return payload, ctype, final_url
            except Exception as e:
                last_err = e
                if attempt + 1 < self.retries:
                    time.sleep(0.8 * (attempt + 1))
                    continue
                break
        raise RuntimeError(f"ERP image fetch failed for {url}: {last_err}")


def load_sku_images(item_csv: Path) -> dict[str, dict[str, str]]:
    """
    Returns:
      sku -> {image_ref, item_name}
    """
    if not item_csv.exists():
        _die(f"missing item CSV: {item_csv}")

    out: dict[str, dict[str, str]] = {}
    with item_csv.open(newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        header = next(r, None)
        if not header:
            _die(f"empty csv: {item_csv}")
        idx: dict[str, int] = {}
        for i, h in enumerate(header):
            k = str(h or "").strip()
            if k and k not in idx:
                idx[k] = i

        c_id = idx.get("ID")
        c_name = idx.get("Item Name")
        c_image = idx.get("Image")
        if c_id is None or c_image is None:
            _die("Item CSV must include ID and Image columns")

        for row in r:
            sku = _strip_wrapped_quotes(row[c_id]) if c_id < len(row) else ""
            if not sku:
                continue
            image_ref = _strip_wrapped_quotes(row[c_image]) if c_image < len(row) else ""
            if not image_ref:
                continue
            if sku in out:
                continue
            item_name = _strip_wrapped_quotes(row[c_name]) if c_name is not None and c_name < len(row) else ""
            out[sku] = {"image_ref": image_ref, "item_name": item_name}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", required=True, help="POS API base, e.g. https://api.melqard.com")
    ap.add_argument("--email", default=os.getenv("MELQARD_ADMIN_EMAIL") or "")
    ap.add_argument("--password", default=os.getenv("MELQARD_ADMIN_PASSWORD") or "")
    ap.add_argument("--item-csv", default="Data AH Trading/Item.csv")
    ap.add_argument("--erp-base", default="https://erp.ahagetrading.com")
    ap.add_argument("--companies", default="AH Trading Official,AH Trading Unofficial")
    ap.add_argument("--overwrite", action="store_true", help="Replace existing image_attachment_id")
    ap.add_argument("--include-inactive", action="store_true", help="Include inactive items")
    ap.add_argument("--set-image-alt", action="store_true", help="Also patch image_alt from CSV item name")
    ap.add_argument("--limit", type=int, default=0, help="Per-company max items to process (0 = unlimited)")
    ap.add_argument("--max-image-mb", type=int, default=5)
    ap.add_argument("--sleep-ms", type=int, default=0, help="Sleep between successful item updates")
    ap.add_argument("--shard-count", type=int, default=1, help="Shard total for parallel runs (default 1)")
    ap.add_argument("--shard-index", type=int, default=0, help="Shard index [0..shard-count-1] for this run")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.email or not args.password:
        _die("missing POS credentials: --email/--password (or MELQARD_ADMIN_*)")

    wanted_companies = [x.strip() for x in str(args.companies).split(",") if x.strip()]
    if not wanted_companies:
        _die("no companies selected")
    if int(args.shard_count) < 1:
        _die("--shard-count must be >= 1")
    if int(args.shard_index) < 0 or int(args.shard_index) >= int(args.shard_count):
        _die("--shard-index must be in [0 .. shard-count-1]")

    sku_images = load_sku_images(Path(str(args.item_csv)))

    pos = PosClient(str(args.api_base))
    erp_images = ErpImageClient(str(args.erp_base))
    pos.login(str(args.email), str(args.password))

    companies = pos.get_companies()
    by_name = {str(c.get("name") or ""): str(c.get("id") or "") for c in companies}

    summary: list[dict[str, Any]] = []
    max_bytes = max(1, int(args.max_image_mb)) * 1024 * 1024

    for cname in wanted_companies:
        cid = by_name.get(cname) or ""
        if not cid:
            summary.append(
                {
                    "company": cname,
                    "error": "company_not_found",
                }
            )
            continue

        items = pos.list_items(cid)
        by_sku = {str(it.get("sku") or "").strip(): dict(it) for it in items if str(it.get("sku") or "").strip()}

        candidates: list[dict[str, Any]] = []
        for sku, ref in sku_images.items():
            it = by_sku.get(sku)
            if not it:
                continue
            if not _in_shard(sku, int(args.shard_count), int(args.shard_index)):
                continue
            if not args.include_inactive and not bool(it.get("is_active", True)):
                continue
            if not args.overwrite and _norm(it.get("image_attachment_id")):
                continue
            candidates.append(
                {
                    "sku": sku,
                    "item_id": str(it.get("id") or ""),
                    "item_name": _norm(it.get("name")) or _norm(ref.get("item_name")) or sku,
                    "image_ref": _norm(ref.get("image_ref")),
                }
            )

        candidates.sort(key=lambda x: x["sku"])
        if int(args.limit or 0) > 0:
            candidates = candidates[: int(args.limit)]

        rec: dict[str, Any] = {
            "company": cname,
            "company_id": cid,
            "items_total": len(items),
            "candidate_items": len(candidates),
            "imported": 0,
            "skipped_too_large": 0,
            "failed_download": 0,
            "failed_upload": 0,
            "failed_patch": 0,
            "examples": [],
            "dry_run": bool(args.dry_run),
            "shard_count": int(args.shard_count),
            "shard_index": int(args.shard_index),
        }

        # Cache by resolved URL to reduce repeated ERP fetches.
        image_cache: dict[str, tuple[bytes, str, str]] = {}

        for i, row in enumerate(candidates, start=1):
            sku = row["sku"]
            item_id = row["item_id"]
            item_name = row["item_name"]
            image_ref = row["image_ref"]

            if args.dry_run:
                rec["imported"] += 1
                continue

            try:
                if image_ref in image_cache:
                    payload, content_type, final_url = image_cache[image_ref]
                else:
                    payload, content_type, final_url = erp_images.fetch(image_ref)
                    image_cache[image_ref] = (payload, content_type, final_url)
            except Exception as e:
                rec["failed_download"] += 1
                if len(rec["examples"]) < 20:
                    rec["examples"].append({"sku": sku, "stage": "download", "error": str(e)})
                continue

            if len(payload) == 0:
                rec["failed_download"] += 1
                if len(rec["examples"]) < 20:
                    rec["examples"].append({"sku": sku, "stage": "download", "error": "empty_payload"})
                continue
            if len(payload) > max_bytes:
                rec["skipped_too_large"] += 1
                if len(rec["examples"]) < 20:
                    rec["examples"].append({"sku": sku, "stage": "validate", "error": f"too_large:{len(payload)}"})
                continue

            parsed = urlparse(final_url)
            raw_name = _sanitize_filename(unquote(os.path.basename(parsed.path or "")), "")
            if not raw_name:
                raw_name = _sanitize_filename(unquote(os.path.basename(urlparse(image_ref).path or "")), "")
            if not raw_name:
                raw_name = sku + _guess_ext_from_content_type(content_type)

            try:
                aid = pos.upload_item_image_attachment(
                    cid,
                    item_id,
                    filename=raw_name,
                    content_type=content_type,
                    payload=payload,
                )
            except Exception as e:
                rec["failed_upload"] += 1
                if len(rec["examples"]) < 20:
                    rec["examples"].append({"sku": sku, "stage": "upload", "error": str(e)})
                continue

            try:
                alt = item_name if args.set_image_alt else None
                pos.patch_item_image(cid, item_id, aid, image_alt=alt)
                rec["imported"] += 1
            except Exception as e:
                rec["failed_patch"] += 1
                if len(rec["examples"]) < 20:
                    rec["examples"].append({"sku": sku, "stage": "patch", "error": str(e)})
                continue

            if int(args.sleep_ms or 0) > 0:
                time.sleep(float(args.sleep_ms) / 1000.0)

            if i % 100 == 0:
                print(f"[{cname}] progress {i}/{len(candidates)} imported={rec['imported']}", file=sys.stderr)

        summary.append(rec)

    print(
        json.dumps(
            {
                "ok": True,
                "api_base": args.api_base,
                "erp_base": args.erp_base,
                "item_csv": args.item_csv,
                "companies": summary,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
