export type ParsedNumber =
  | { ok: true; value: number }
  | { ok: false; reason: "empty" | "invalid" };

function cleanNumberString(s: string): string {
  // Allow common human formatting like "90,000" and " 1 234.50 ".
  return s.replace(/,/g, "").replace(/\s+/g, "");
}

export function parseNumberInput(raw: unknown): ParsedNumber {
  if (raw === null || raw === undefined) return { ok: false, reason: "empty" };
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false, reason: "invalid" };
  }
  if (typeof raw !== "string") return { ok: false, reason: "invalid" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  // Support fraction notation like "1/48", "48/1", "3/4"
  const fractionMatch = trimmed.match(/^([0-9.,\s]+)\/([0-9.,\s]+)$/);
  if (fractionMatch) {
    const num = Number(cleanNumberString(fractionMatch[1]));
    const den = Number(cleanNumberString(fractionMatch[2]));
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return { ok: true, value: num / den };
    }
    return { ok: false, reason: "invalid" };
  }
  const n = Number(cleanNumberString(trimmed));
  if (!Number.isFinite(n)) return { ok: false, reason: "invalid" };
  return { ok: true, value: n };
}

