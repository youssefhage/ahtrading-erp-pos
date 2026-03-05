// Lightweight fuzzy search utilities (no external deps).
// Port of apps/admin/lib/fuzzy.ts for Svelte POS Desktop.
//
// Goals:
// - Work well for "typeahead" + table filtering.
// - Prefer exact / prefix / word-start matches, but still catch typos-ish input via subsequence matching.
// - Keep API small and easy to use across the app.

export function normalizeSearchText(input) {
  const s = String(input || "");
  try {
    return s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "") // Latin combining diacritics
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670]/g, "") // Arabic tashkeel / diacritics
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }
}

function splitTokens(q) {
  return normalizeSearchText(q)
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
}

function isWordBoundary(hay, idx) {
  if (idx <= 0) return true;
  const prev = hay[idx - 1] || "";
  return prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === "." || prev === "#" || prev === "(" || prev === ")";
}

// Returns a positive score (higher is better) if token matches text, else null.
function scoreToken(token, text) {
  const t = normalizeSearchText(token);
  const h = normalizeSearchText(text);
  if (!t || !h) return null;

  if (t === h) return 1000;

  const idx = h.indexOf(t);
  if (idx >= 0) {
    if (idx === 0) return 700 + Math.min(100, t.length * 6);
    if (isWordBoundary(h, idx)) return 520 + Math.min(80, t.length * 4) - Math.min(60, idx);
    return 360 + Math.min(60, t.length * 3) - Math.min(120, idx);
  }

  // Subsequence match: characters appear in order, with gaps allowed.
  if (t.length < 2) return null;
  let ti = 0;
  let lastPos = -1;
  let gaps = 0;
  for (let hi = 0; hi < h.length && ti < t.length; hi++) {
    if (h[hi] === t[ti]) {
      if (lastPos >= 0) gaps += hi - lastPos - 1;
      lastPos = hi;
      ti++;
    }
  }
  if (ti !== t.length) return null;
  const first = h.indexOf(t[0]);
  const base = 120 + t.length * 10;
  const penalty = Math.min(120, gaps * 4) + Math.min(80, Math.max(0, first) * 2);
  const score = base - penalty;
  return score > 0 ? score : 1;
}

export function scoreFuzzyQuery(query, text) {
  const tokens = splitTokens(query);
  if (!tokens.length) return null;

  const h = normalizeSearchText(text);
  if (!h) return null;

  let total = 0;
  for (const tok of tokens) {
    const s = scoreToken(tok, h);
    if (s == null) return null;
    total += s;
  }
  if (tokens.length >= 2) total += 30 * tokens.length;
  return total;
}

export function filterAndRankByFuzzy(rows, query, toText, opts) {
  const q = normalizeSearchText(query);
  if (!q) return rows;
  const minScore = opts?.minScore ?? 1;
  const scored = rows
    .map((row, idx) => {
      const s = scoreFuzzyQuery(q, toText(row));
      return { row, idx, score: s ?? 0 };
    })
    .filter((x) => x.score >= minScore);
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  const out = scored.map((x) => x.row);
  return typeof opts?.limit === "number" ? out.slice(0, Math.max(0, opts.limit)) : out;
}
