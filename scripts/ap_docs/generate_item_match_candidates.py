#!/usr/bin/env python3
"""
Generate item match candidates for extracted supplier invoice line clusters.

Inputs:
- item_mapping_queue.csv (from line_item_extract_final)
- local POS SQLite cache (local_items_cache + local_item_barcodes_cache)

Outputs (under --out-dir):
- item_mapping_with_candidates.csv  (one best candidate per cluster)
- item_match_candidates_topk.csv    (top-k candidates per cluster)
- item_match_high_confidence.csv    (best candidates ready for fast review)
- item_match_review_queue.csv       (everything needing manual review)
- matching_summary.json
"""

from __future__ import annotations

import argparse
import csv
import difflib
import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


STOP_TOKENS = {
    "x",
    "pc",
    "pcs",
    "piece",
    "pieces",
    "box",
    "pack",
    "pkt",
    "ml",
    "cl",
    "l",
    "lt",
    "g",
    "gr",
    "kg",
    "gm",
}

NON_ITEM_PATTERNS = [
    r"\bcash\b",
    r"\bdiscount\b",
    r"\bvat\b",
    r"\btax\b",
    r"\bdelivery\b",
    r"\bfreight\b",
    r"\btransport\b",
    r"\bpayment\b",
    r"\bround(ing)?\b",
    r"\bbalance\b",
    r"\bsubtotal\b",
    r"\btotal\b",
]


@dataclass
class ItemRec:
    item_id: str
    sku: str
    name: str
    uom: str
    primary_barcode: str
    sku_norm: str
    name_norm: str
    name_tokens: set[str]
    barcodes_norm: set[str]


def _normalize_text(value: str) -> str:
    s = (value or "").strip().lower()
    s = re.sub(r"[_\-/\\|]+", " ", s)
    s = re.sub(r"[^\w\s]+", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _normalize_code(value: str) -> str:
    s = (value or "").strip().upper()
    s = re.sub(r"[^A-Z0-9]+", "", s)
    return s


def _tokens(value: str) -> set[str]:
    out: set[str] = set()
    for t in _normalize_text(value).split():
        if len(t) <= 1:
            continue
        if t in STOP_TOKENS:
            continue
        out.add(t)
    return out


def _safe_float(value: Any) -> float:
    try:
        return float(str(value).replace(",", ""))
    except Exception:
        return 0.0


def _is_non_item(name: str, code: str) -> bool:
    s = f"{name} {code}".strip().lower()
    if not s:
        return False
    for p in NON_ITEM_PATTERNS:
        if re.search(p, s):
            return True
    return False


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _sequence_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _bucket(score: float, reason: str, gap: float) -> str:
    if reason in {"sku_exact", "barcode_exact", "name_exact"}:
        return "high"
    if score >= 0.92 and gap >= 0.03:
        return "high"
    if score >= 0.84:
        return "medium"
    return "low"


def _load_items(sqlite_path: Path) -> list[ItemRec]:
    conn = sqlite3.connect(str(sqlite_path))
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, sku, name, unit_of_measure, barcode
            FROM local_items_cache
            WHERE COALESCE(is_active, 1) = 1
            """
        )
        item_rows = list(cur.fetchall())

        cur.execute("SELECT item_id, barcode FROM local_item_barcodes_cache")
        barcode_rows = list(cur.fetchall())
    finally:
        conn.close()

    barcodes_by_item: dict[str, set[str]] = {}
    for r in barcode_rows:
        item_id = str(r["item_id"] or "").strip()
        bc = str(r["barcode"] or "").strip()
        if not item_id or not bc:
            continue
        barcodes_by_item.setdefault(item_id, set()).add(_normalize_code(bc))

    out: list[ItemRec] = []
    for r in item_rows:
        item_id = str(r["id"] or "").strip()
        sku = str(r["sku"] or "").strip()
        name = str(r["name"] or "").strip()
        uom = str(r["unit_of_measure"] or "").strip()
        bc_primary = str(r["barcode"] or "").strip()
        bcs = set(barcodes_by_item.get(item_id, set()))
        if bc_primary:
            bcs.add(_normalize_code(bc_primary))
        out.append(
            ItemRec(
                item_id=item_id,
                sku=sku,
                name=name,
                uom=uom,
                primary_barcode=bc_primary,
                sku_norm=_normalize_code(sku),
                name_norm=_normalize_text(name),
                name_tokens=_tokens(name),
                barcodes_norm=bcs,
            )
        )
    return out


def _candidate_pool(
    code_norm: str,
    name_norm: str,
    name_tokens: set[str],
    *,
    items: list[ItemRec],
    sku_idx: dict[str, list[int]],
    barcode_idx: dict[str, list[int]],
    token_idx: dict[str, set[int]],
) -> tuple[set[int], str]:
    # Hard exact paths first.
    if code_norm and code_norm in sku_idx:
        return set(sku_idx[code_norm]), "sku_exact"
    if code_norm and code_norm in barcode_idx:
        return set(barcode_idx[code_norm]), "barcode_exact"
    if name_norm:
        exact_name = {i for i, it in enumerate(items) if it.name_norm == name_norm}
        if exact_name:
            return exact_name, "name_exact"

    cand: set[int] = set()
    for t in name_tokens:
        ids = token_idx.get(t)
        if ids:
            cand.update(ids)

    # Weak code hint: sku contains code.
    if code_norm and len(code_norm) >= 3:
        for i, it in enumerate(items):
            if code_norm in it.sku_norm:
                cand.add(i)
            if code_norm in it.barcodes_norm:
                cand.add(i)

    # Fallback if token search is empty.
    if not cand:
        for i, it in enumerate(items):
            if not name_norm:
                continue
            if name_norm in it.name_norm or it.name_norm in name_norm:
                cand.add(i)

    if not cand:
        cand = set(range(len(items)))
    return cand, "fuzzy"


def _score_candidate(code_norm: str, name_norm: str, name_tokens: set[str], item: ItemRec, mode: str) -> tuple[float, str]:
    if mode == "sku_exact":
        if code_norm and item.sku_norm == code_norm:
            return 1.0, "sku_exact"
    if mode == "barcode_exact":
        if code_norm and code_norm in item.barcodes_norm:
            return 0.99, "barcode_exact"
    if mode == "name_exact":
        if name_norm and item.name_norm == name_norm:
            return 0.97, "name_exact"

    seq = _sequence_ratio(name_norm, item.name_norm)
    jac = _jaccard(name_tokens, item.name_tokens)
    prefix = 1.0 if name_norm and (item.name_norm.startswith(name_norm) or name_norm.startswith(item.name_norm)) and min(len(name_norm), len(item.name_norm)) >= 6 else 0.0
    code_hit = 1.0 if code_norm and (code_norm in item.sku_norm or code_norm in item.barcodes_norm) else 0.0
    score = (0.55 * seq) + (0.30 * jac) + (0.10 * prefix) + (0.05 * code_hit)
    return score, "fuzzy"


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _write_csv(path: Path, rows: Iterable[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate item match candidates from supplier item clusters")
    ap.add_argument(
        "--mapping-csv",
        default=".cache/ap_docs_packets_52_batch1_fixed/line_item_extract_final/item_mapping_queue.csv",
    )
    ap.add_argument("--sqlite", default="pos-desktop/pos.sqlite")
    ap.add_argument(
        "--out-dir",
        default=".cache/ap_docs_packets_52_batch1_fixed/line_item_extract_final/matching",
    )
    ap.add_argument("--top-k", type=int, default=3)
    args = ap.parse_args()

    mapping_csv = Path(args.mapping_csv).expanduser().resolve()
    sqlite_path = Path(args.sqlite).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    clusters = _read_csv(mapping_csv)
    items = _load_items(sqlite_path)

    sku_idx: dict[str, list[int]] = {}
    barcode_idx: dict[str, list[int]] = {}
    token_idx: dict[str, set[int]] = {}
    for i, it in enumerate(items):
        if it.sku_norm:
            sku_idx.setdefault(it.sku_norm, []).append(i)
        for bc in it.barcodes_norm:
            barcode_idx.setdefault(bc, []).append(i)
        for t in it.name_tokens:
            token_idx.setdefault(t, set()).add(i)

    best_rows: list[dict[str, Any]] = []
    topk_rows: list[dict[str, Any]] = []

    high = 0
    medium = 0
    low = 0
    non_item = 0
    unmatched = 0

    for c in clusters:
        supplier_code = (c.get("supplier_item_code") or "").strip()
        supplier_name = (c.get("supplier_item_name") or "").strip()
        occ = int(_safe_float(c.get("occurrences") or 0))
        code_norm = _normalize_code(supplier_code)
        name_norm = _normalize_text(supplier_name)
        name_tokens = _tokens(supplier_name)

        if _is_non_item(supplier_name, supplier_code):
            non_item += 1
            row = dict(c)
            row.update(
                {
                    "candidate_item_id": "",
                    "candidate_sku": "",
                    "candidate_name": "",
                    "candidate_uom": "",
                    "candidate_barcode": "",
                    "candidate_score": 0.0,
                    "candidate_reason": "non_item_line",
                    "confidence_bucket": "skip",
                    "score_gap": 0.0,
                    "top2_score": 0.0,
                    "top3_score": 0.0,
                    "auto_accept": "false",
                }
            )
            best_rows.append(row)
            continue

        cand_ids, mode = _candidate_pool(code_norm, name_norm, name_tokens, items=items, sku_idx=sku_idx, barcode_idx=barcode_idx, token_idx=token_idx)
        scored: list[tuple[float, str, ItemRec]] = []
        for cid in cand_ids:
            score, reason = _score_candidate(code_norm, name_norm, name_tokens, items[cid], mode)
            if score <= 0:
                continue
            scored.append((score, reason, items[cid]))
        scored.sort(key=lambda x: x[0], reverse=True)
        scored = scored[: max(1, int(args.top_k))]

        if not scored:
            unmatched += 1
            row = dict(c)
            row.update(
                {
                    "candidate_item_id": "",
                    "candidate_sku": "",
                    "candidate_name": "",
                    "candidate_uom": "",
                    "candidate_barcode": "",
                    "candidate_score": 0.0,
                    "candidate_reason": "no_candidate",
                    "confidence_bucket": "low",
                    "score_gap": 0.0,
                    "top2_score": 0.0,
                    "top3_score": 0.0,
                    "auto_accept": "false",
                }
            )
            best_rows.append(row)
            continue

        # Capture top-k rows.
        for rank, (score, reason, it) in enumerate(scored, start=1):
            topk_rows.append(
                {
                    "cluster_key": c.get("cluster_key", ""),
                    "supplier_item_code": supplier_code,
                    "supplier_item_name": supplier_name,
                    "occurrences": occ,
                    "rank": rank,
                    "candidate_item_id": it.item_id,
                    "candidate_sku": it.sku,
                    "candidate_name": it.name,
                    "candidate_uom": it.uom,
                    "candidate_barcode": it.primary_barcode,
                    "candidate_score": round(score, 6),
                    "candidate_reason": reason,
                }
            )

        s1, r1, i1 = scored[0]
        s2 = scored[1][0] if len(scored) >= 2 else 0.0
        s3 = scored[2][0] if len(scored) >= 3 else 0.0
        gap = max(0.0, s1 - s2)
        bucket = _bucket(s1, r1, gap)
        if bucket == "high":
            high += 1
        elif bucket == "medium":
            medium += 1
        else:
            low += 1

        # Require both high bucket and a small ambiguity guard for auto-accept.
        auto_accept = bucket == "high" and (gap >= 0.03 or r1 in {"sku_exact", "barcode_exact", "name_exact"})

        row = dict(c)
        row.update(
            {
                "candidate_item_id": i1.item_id,
                "candidate_sku": i1.sku,
                "candidate_name": i1.name,
                "candidate_uom": i1.uom,
                "candidate_barcode": i1.primary_barcode,
                "candidate_score": round(s1, 6),
                "candidate_reason": r1,
                "confidence_bucket": bucket,
                "score_gap": round(gap, 6),
                "top2_score": round(s2, 6),
                "top3_score": round(s3, 6),
                "auto_accept": "true" if auto_accept else "false",
            }
        )
        best_rows.append(row)

    # Output files.
    best_cols = list(clusters[0].keys()) + [
        "candidate_item_id",
        "candidate_sku",
        "candidate_name",
        "candidate_uom",
        "candidate_barcode",
        "candidate_score",
        "candidate_reason",
        "confidence_bucket",
        "score_gap",
        "top2_score",
        "top3_score",
        "auto_accept",
    ]
    topk_cols = [
        "cluster_key",
        "supplier_item_code",
        "supplier_item_name",
        "occurrences",
        "rank",
        "candidate_item_id",
        "candidate_sku",
        "candidate_name",
        "candidate_uom",
        "candidate_barcode",
        "candidate_score",
        "candidate_reason",
    ]

    best_csv = out_dir / "item_mapping_with_candidates.csv"
    topk_csv = out_dir / "item_match_candidates_topk.csv"
    high_csv = out_dir / "item_match_high_confidence.csv"
    review_csv = out_dir / "item_match_review_queue.csv"

    _write_csv(best_csv, best_rows, best_cols)
    _write_csv(topk_csv, topk_rows, topk_cols)

    high_rows = [r for r in best_rows if r.get("auto_accept") == "true"]
    review_rows = [r for r in best_rows if r.get("auto_accept") != "true" and r.get("confidence_bucket") != "skip"]
    _write_csv(high_csv, high_rows, best_cols)
    _write_csv(review_csv, review_rows, best_cols)

    summary = {
        "clusters_total": len(clusters),
        "items_active": len(items),
        "high_confidence": high,
        "medium_confidence": medium,
        "low_confidence": low,
        "non_item_skipped": non_item,
        "unmatched": unmatched,
        "high_auto_accept": len(high_rows),
        "review_queue": len(review_rows),
        "best_csv": str(best_csv),
        "topk_csv": str(topk_csv),
        "high_csv": str(high_csv),
        "review_csv": str(review_csv),
    }
    (out_dir / "matching_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
