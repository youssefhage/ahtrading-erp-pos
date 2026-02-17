import { formatDate, formatDateTime } from "@/lib/datetime";

export function fmtIsoDate(iso?: string | null): string {
  return formatDate(iso);
}

export function safeFilenamePart(s: string): string {
  const cleaned = String(s || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "document";
}

export function generatedAtStamp(): string {
  return formatDateTime(new Date());
}
