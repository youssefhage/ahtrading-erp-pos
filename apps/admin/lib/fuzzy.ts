// Lightweight fuzzy search utilities (no external deps).
//
// Goals:
// - Work well for "typeahead" + table filtering.
// - Prefer exact / prefix / word-start matches, but still catch typos-ish input via subsequence matching.
// - Keep API small and easy to use across the app.

export function normalizeSearchText(input: string): string {
  const s = String(input || "");
  // Remove diacritics where possible (NFKD splits base char + combining marks).
  // If normalize isn't supported for some reason, fall back to plain lowercase.
  try {
    return s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }
}

function splitTokens(q: string): string[] {
  return normalizeSearchText(q)
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
}

function isWordBoundary(hay: string, idx: number): boolean {
  if (idx <= 0) return true;
  const prev = hay[idx - 1] || "";
  // Treat common separators as boundaries.
  return prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === "." || prev === "#" || prev === "(" || prev === ")";
}

// Returns a positive score (higher is better) if token matches text, else null.
function scoreToken(token: string, text: string): number | null {
  const t = normalizeSearchText(token);
  const h = normalizeSearchText(text);
  if (!t || !h) return null;

  if (t === h) return 1000;

  const idx = h.indexOf(t);
  if (idx >= 0) {
    // Strong preference for prefix / word-start matches.
    if (idx === 0) return 700 + Math.min(100, t.length * 6);
    if (isWordBoundary(h, idx)) return 520 + Math.min(80, t.length * 4) - Math.min(60, idx);
    // Plain substring match.
    return 360 + Math.min(60, t.length * 3) - Math.min(120, idx);
  }

  // Subsequence match: characters appear in order, with gaps allowed.
  // Helps with "closest suggestions" when the user types partial/abbrev.
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
  const first = (() => {
    // Find first matched position quickly.
    const ch = t[0];
    return h.indexOf(ch);
  })();
  // Base score scales with token length; penalize gaps + later matches.
  const base = 120 + t.length * 10;
  const penalty = Math.min(120, gaps * 4) + Math.min(80, Math.max(0, first) * 2);
  const score = base - penalty;
  return score > 0 ? score : 1;
}

export function scoreFuzzyQuery(query: string, text: string): number | null {
  const tokens = splitTokens(query);
  if (!tokens.length) return null;

  const h = normalizeSearchText(text);
  if (!h) return null;

  let total = 0;
  for (const tok of tokens) {
    const s = scoreToken(tok, h);
    if (s == null) return null; // require all tokens to match somewhere in the same text
    total += s;
  }
  // Small bonus for multi-token queries when everything matched.
  if (tokens.length >= 2) total += 30 * tokens.length;
  return total;
}

export function filterAndRankByFuzzy<T>(
  rows: T[],
  query: string,
  toText: (row: T) => string,
  opts?: { limit?: number; minScore?: number }
): T[] {
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

export function rankByFuzzy<T>(rows: T[], query: string, toText: (row: T) => string): T[] {
  const q = normalizeSearchText(query);
  if (!q) return rows;
  const scored = rows.map((row, idx) => ({ row, idx, score: scoreFuzzyQuery(q, toText(row)) ?? 0 }));
  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return scored.map((x) => x.row);
}

