#!/usr/bin/env python3
"""
Finalize AP packet line-item extraction outputs into one canonical dataset.

This script merges:
- main output dir:      <base>/line_item_extract
- optional shard dirs:  <base>/line_item_extract_shards/shard*

Outputs:
- <out>/packet_extract_history.csv   (all result rows with source tag)
- <out>/packet_extract_latest.csv    (latest result row per packet_id)
- <out>/packet_line_items.csv        (rebuilt from latest successful JSON payload per packet)
- <out>/unresolved_packets.csv       (packets not resolved to latest status=ok)
- <out>/summary.json                 (high-level counters)
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class LatestRow:
    row: dict[str, str]
    source: str
    ts: int
    seq: int


def _to_int(value: str | None, default: int = 0) -> int:
    if value is None:
        return default
    s = str(value).strip()
    if not s:
        return default
    try:
        return int(float(s))
    except Exception:
        return default


def _first_nonempty(obj: Any, *keys: str) -> str:
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return ""
        cur = cur.get(k)
    if cur is None:
        return ""
    return str(cur).strip()


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as f:
        dr = csv.DictReader(f)
        return (dr.fieldnames or []), list(dr)


def _source_dirs(base: Path) -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    main = base / "line_item_extract"
    if main.exists():
        out.append(("main", main))
    shards_root = base / "line_item_extract_shards"
    if shards_root.exists():
        for d in sorted(shards_root.glob("shard*")):
            if d.is_dir():
                out.append((d.name, d))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Finalize AP line-item extraction outputs")
    ap.add_argument(
        "--base",
        default=".cache/ap_docs_packets_52_batch1_fixed",
        help="Base batch folder containing reports/, line_item_extract/, line_item_extract_shards/",
    )
    ap.add_argument(
        "--out",
        default="",
        help="Output folder (default: <base>/line_item_extract_final)",
    )
    args = ap.parse_args()

    base = Path(args.base).expanduser().resolve()
    out_dir = (
        Path(args.out).expanduser().resolve()
        if str(args.out or "").strip()
        else (base / "line_item_extract_final")
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    queue_csv = base / "reports" / "line_item_extract_queue.csv"
    if not queue_csv.exists():
        raise FileNotFoundError(f"queue CSV not found: {queue_csv}")
    _, queue_rows = _read_csv(queue_csv)
    queue_by_pid = {(r.get("packet_id") or "").strip(): r for r in queue_rows if (r.get("packet_id") or "").strip()}
    queue_order = [pid for pid in (r.get("packet_id", "").strip() for r in queue_rows) if pid]

    history_rows: list[dict[str, str]] = []
    latest: dict[str, LatestRow] = {}
    seq = 0

    for source_name, source_dir in _source_dirs(base):
        results_csv = source_dir / "packet_extract_results.csv"
        if not results_csv.exists():
            continue
        _, rows = _read_csv(results_csv)
        for row in rows:
            pid = (row.get("packet_id") or "").strip()
            if not pid:
                continue
            seq += 1
            ts = _to_int(row.get("ts"))
            row_hist = dict(row)
            row_hist["source"] = source_name
            history_rows.append(row_hist)

            prev = latest.get(pid)
            cand = LatestRow(row=dict(row), source=source_name, ts=ts, seq=seq)
            if prev is None or (cand.ts, cand.seq) >= (prev.ts, prev.seq):
                latest[pid] = cand

    # Write history.
    history_cols = ["ts", "packet_id", "status", "files_count", "line_count", "elapsed_ms", "error", "source"]
    history_path = out_dir / "packet_extract_history.csv"
    with history_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=history_cols)
        w.writeheader()
        for row in history_rows:
            w.writerow({k: row.get(k, "") for k in history_cols})

    # Rebuild canonical line-items from latest successful JSON payload per packet.
    line_cols = [
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
        "json_path",
    ]
    line_rows: list[dict[str, Any]] = []

    latest_cols = [
        "packet_id",
        "status",
        "ts",
        "source",
        "files_count",
        "line_count",
        "elapsed_ms",
        "error",
        "json_path",
        "line_count_rebuilt",
    ]
    latest_rows: list[dict[str, Any]] = []
    unresolved_rows: list[dict[str, Any]] = []

    source_dirs = _source_dirs(base)
    source_dir_map = {name: path for name, path in source_dirs}

    for pid in queue_order:
        ent = latest.get(pid)
        if ent is None:
            unresolved_rows.append(
                {
                    "packet_id": pid,
                    "reason": "no_result_row",
                    "status": "",
                    "error": "",
                }
            )
            latest_rows.append(
                {
                    "packet_id": pid,
                    "status": "",
                    "ts": "",
                    "source": "",
                    "files_count": "",
                    "line_count": "",
                    "elapsed_ms": "",
                    "error": "",
                    "json_path": "",
                    "line_count_rebuilt": "",
                }
            )
            continue

        row = ent.row
        status = (row.get("status") or "").strip()
        source_dir = source_dir_map.get(ent.source)
        json_path = source_dir / "json" / f"{pid}.json" if source_dir else None
        json_path_s = str(json_path) if json_path and json_path.exists() else ""

        line_count_rebuilt = 0
        if status == "ok":
            if not json_path_s:
                unresolved_rows.append(
                    {
                        "packet_id": pid,
                        "reason": "ok_but_json_missing",
                        "status": status,
                        "error": "",
                    }
                )
            else:
                data = json.loads(Path(json_path_s).read_text(encoding="utf-8"))
                supplier_name = _first_nonempty(data, "supplier", "name")
                invoice_no = _first_nonempty(data, "invoice", "invoice_no")
                invoice_date = _first_nonempty(data, "invoice", "invoice_date")
                currency = _first_nonempty(data, "invoice", "currency") or _first_nonempty(data, "totals", "currency")
                total = _first_nonempty(data, "totals", "total")
                lines = data.get("lines") or []
                if isinstance(lines, list) and lines:
                    for pos, ln in enumerate(lines, start=1):
                        if not isinstance(ln, dict):
                            continue
                        line_count_rebuilt += 1
                        line_rows.append(
                            {
                                "packet_id": pid,
                                "line_no": pos,
                                "supplier_name": supplier_name,
                                "invoice_no": invoice_no,
                                "invoice_date": invoice_date,
                                "currency": currency,
                                "total": total,
                                "supplier_item_code": ln.get("supplier_item_code", ""),
                                "supplier_item_name": ln.get("supplier_item_name", ""),
                                "qty": ln.get("qty", ""),
                                "unit_price": ln.get("unit_price", ""),
                                "line_currency": ln.get("currency", ""),
                                "json_path": json_path_s,
                            }
                        )
                else:
                    # Keep trace row for packets with no extracted lines.
                    line_rows.append(
                        {
                            "packet_id": pid,
                            "line_no": 0,
                            "supplier_name": supplier_name,
                            "invoice_no": invoice_no,
                            "invoice_date": invoice_date,
                            "currency": currency,
                            "total": total,
                            "supplier_item_code": "",
                            "supplier_item_name": "",
                            "qty": "",
                            "unit_price": "",
                            "line_currency": "",
                            "json_path": json_path_s,
                        }
                    )
        else:
            unresolved_rows.append(
                {
                    "packet_id": pid,
                    "reason": "latest_status_not_ok",
                    "status": status,
                    "error": (row.get("error") or ""),
                }
            )

        latest_rows.append(
            {
                "packet_id": pid,
                "status": status,
                "ts": row.get("ts", ""),
                "source": ent.source,
                "files_count": row.get("files_count", ""),
                "line_count": row.get("line_count", ""),
                "elapsed_ms": row.get("elapsed_ms", ""),
                "error": row.get("error", ""),
                "json_path": json_path_s,
                "line_count_rebuilt": line_count_rebuilt,
            }
        )

    latest_path = out_dir / "packet_extract_latest.csv"
    with latest_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=latest_cols)
        w.writeheader()
        for r in latest_rows:
            w.writerow({k: r.get(k, "") for k in latest_cols})

    lines_path = out_dir / "packet_line_items.csv"
    with lines_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=line_cols)
        w.writeheader()
        for r in line_rows:
            w.writerow({k: r.get(k, "") for k in line_cols})

    unresolved_cols = ["packet_id", "reason", "status", "error"]
    unresolved_path = out_dir / "unresolved_packets.csv"
    with unresolved_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=unresolved_cols)
        w.writeheader()
        for r in unresolved_rows:
            w.writerow({k: r.get(k, "") for k in unresolved_cols})

    ok_count = sum(1 for r in latest_rows if (r.get("status") or "").strip() == "ok")
    summary = {
        "queue_total": len(queue_order),
        "latest_ok": ok_count,
        "latest_not_ok_or_missing": len(queue_order) - ok_count,
        "history_rows": len(history_rows),
        "latest_rows": len(latest_rows),
        "line_rows_rebuilt": len(line_rows),
        "unresolved_rows": len(unresolved_rows),
        "out_dir": str(out_dir),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False))
    print(f"history_csv={history_path}")
    print(f"latest_csv={latest_path}")
    print(f"line_items_csv={lines_path}")
    print(f"unresolved_csv={unresolved_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
