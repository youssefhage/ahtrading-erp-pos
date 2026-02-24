#!/usr/bin/env python3
"""
Extract line items from packetized AP invoice groups using OpenAI vision.

Input:
- line_item_extract_queue.csv produced from packetization reports.

Output (resumable):
- packet_extract_results.csv  (per-packet status)
- packet_line_items.csv       (flattened lines for downstream mapping/review)
- json/<packet_id>.json       (raw structured extraction per packet)

Notes:
- Skips packets already marked "ok" in packet_extract_results.csv.
- Reads OPENAI_API_KEY from environment.
"""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import os
import sys
import time
from pathlib import Path
from typing import Any


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


# Reuse backend extractor logic directly.
sys.path.insert(0, str(_project_root() / "backend"))
from app.ai.purchase_invoice_import import openai_extract_purchase_invoice_from_images  # noqa: E402


def _split_paths(value: str) -> list[str]:
    if not value:
        return []
    return [p.strip() for p in value.split("||") if p.strip()]


def _ensure_csv_header(path: Path, cols: list[str]) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)


def _append_csv(path: Path, row: list[Any]) -> None:
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(row)


def _load_done_ok(path: Path) -> set[str]:
    done: set[str] = set()
    if not path.exists():
        return done
    with path.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if (r.get("status") or "").strip() == "ok":
                pid = (r.get("packet_id") or "").strip()
                if pid:
                    done.add(pid)
    return done


def _first_nonempty(obj: Any, *keys: str) -> str:
    cur = obj or {}
    for k in keys:
        if not isinstance(cur, dict):
            return ""
        cur = cur.get(k)
    if cur is None:
        return ""
    return str(cur).strip()


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract packet line-items from high-confidence queue")
    ap.add_argument("--queue", required=True, help="Path to line_item_extract_queue.csv")
    ap.add_argument("--out", required=True, help="Output directory for extraction results")
    ap.add_argument("--openai-model", default="gpt-5.2")
    ap.add_argument("--start", type=int, default=0, help="Start index in queue rows (0-based)")
    ap.add_argument("--limit", type=int, default=0, help="How many queue rows to process (0=all from start)")
    ap.add_argument("--progress-every", type=int, default=25)
    ap.add_argument("--sleep-ms", type=int, default=0, help="Optional delay between packets")
    args = ap.parse_args()

    queue_path = Path(args.queue).expanduser().resolve()
    out_dir = Path(args.out).expanduser().resolve()
    json_dir = out_dir / "json"
    out_dir.mkdir(parents=True, exist_ok=True)
    json_dir.mkdir(parents=True, exist_ok=True)

    results_csv = out_dir / "packet_extract_results.csv"
    lines_csv = out_dir / "packet_line_items.csv"

    _ensure_csv_header(
        results_csv,
        [
            "ts",
            "packet_id",
            "status",
            "files_count",
            "line_count",
            "elapsed_ms",
            "error",
        ],
    )
    _ensure_csv_header(
        lines_csv,
        [
            "packet_id",
            "line_no",
            "supplier_name",
            "invoice_no",
            "invoice_date",
            "currency",
            "total",
            "supplier_item_code",
            "supplier_item_name",
            "qty",
            "unit_price",
            "line_currency",
        ],
    )

    if not os.environ.get("OPENAI_API_KEY", "").strip():
        print("OPENAI_API_KEY is missing")
        return 2

    with queue_path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    start = max(0, int(args.start or 0))
    lim = int(args.limit or 0)
    end = len(rows) if lim <= 0 else min(len(rows), start + lim)
    work = rows[start:end]

    done_ok = _load_done_ok(results_csv)
    processed = 0
    skipped = 0
    ok = 0
    failed = 0

    print(f"queue_rows={len(rows)} start={start} end={end} work={len(work)} done_ok={len(done_ok)}")

    for idx, r in enumerate(work, start=1):
        pid = (r.get("packet_id") or "").strip()
        if not pid:
            skipped += 1
            continue
        if pid in done_ok:
            skipped += 1
            continue

        paths = _split_paths(r.get("original_paths") or "")
        images: list[dict[str, Any]] = []
        for p in paths:
            src = Path(p).expanduser()
            if not src.exists() or not src.is_file():
                continue
            raw = src.read_bytes()
            ctype = mimetypes.guess_type(src.name)[0] or "application/octet-stream"
            images.append({"raw": raw, "content_type": ctype, "filename": src.name})

        ts = int(time.time())
        t0 = time.time()
        if not images:
            failed += 1
            _append_csv(results_csv, [ts, pid, "failed", len(paths), 0, 0, "no_readable_files"])
            continue

        try:
            data = openai_extract_purchase_invoice_from_images(
                images=images,
                filename_hint=pid,
                model=(args.openai_model or "").strip() or None,
            )
            elapsed_ms = int((time.time() - t0) * 1000)
            (json_dir / f"{pid}.json").write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )

            supplier_name = _first_nonempty(data, "supplier", "name")
            invoice_no = _first_nonempty(data, "invoice", "invoice_no")
            invoice_date = _first_nonempty(data, "invoice", "invoice_date")
            currency = _first_nonempty(data, "invoice", "currency") or _first_nonempty(
                data, "totals", "currency"
            )
            total = _first_nonempty(data, "totals", "total")
            lines = data.get("lines") or []
            line_count = 0
            if isinstance(lines, list) and lines:
                for pos, ln in enumerate(lines, start=1):
                    if not isinstance(ln, dict):
                        continue
                    line_count += 1
                    _append_csv(
                        lines_csv,
                        [
                            pid,
                            pos,
                            supplier_name,
                            invoice_no,
                            invoice_date,
                            currency,
                            total,
                            (ln.get("supplier_item_code") or ""),
                            (ln.get("supplier_item_name") or ""),
                            ln.get("qty"),
                            ln.get("unit_price"),
                            (ln.get("currency") or ""),
                        ],
                    )
            else:
                # Keep a trace row even when lines are empty.
                _append_csv(
                    lines_csv,
                    [
                        pid,
                        0,
                        supplier_name,
                        invoice_no,
                        invoice_date,
                        currency,
                        total,
                        "",
                        "",
                        "",
                        "",
                        "",
                    ],
                )

            _append_csv(results_csv, [ts, pid, "ok", len(images), line_count, elapsed_ms, ""])
            ok += 1
            done_ok.add(pid)
        except Exception as ex:
            elapsed_ms = int((time.time() - t0) * 1000)
            failed += 1
            _append_csv(results_csv, [ts, pid, "failed", len(images), 0, elapsed_ms, str(ex)[:1200]])

        processed += 1
        if args.progress_every > 0 and processed % int(args.progress_every) == 0:
            print(
                f"processed={processed}/{len(work)} ok={ok} failed={failed} skipped={skipped}"
            )
        if args.sleep_ms > 0:
            time.sleep(max(0, int(args.sleep_ms)) / 1000.0)

    print(f"done processed={processed} ok={ok} failed={failed} skipped={skipped}")
    print(f"results_csv={results_csv}")
    print(f"lines_csv={lines_csv}")
    print(f"json_dir={json_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

