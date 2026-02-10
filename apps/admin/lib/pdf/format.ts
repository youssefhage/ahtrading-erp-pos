export function fmtIsoDate(iso?: string | null): string {
  const s = String(iso || "").slice(0, 10);
  return s || "-";
}

export function safeFilenamePart(s: string): string {
  const cleaned = String(s || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "document";
}

export function generatedAtStamp(): string {
  // ISO-ish without timezone to keep filenames/logs tidy.
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

