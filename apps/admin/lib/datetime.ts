type DateLike = string | number | Date | null | undefined;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/;

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function isValidDate(d: Date): boolean {
  return Number.isFinite(d.getTime());
}

function normalizeDateInput(raw: string): string {
  let s = raw.trim();
  if (!s) return s;

  if (DATE_ONLY_RE.test(s)) return `${s}T00:00:00Z`;
  if (s[10] === " ") s = s.slice(0, 10) + "T" + s.slice(11);

  // JS Date supports milliseconds (3 digits), while APIs may return microseconds.
  s = s.replace(/\.(\d{3})\d+/, ".$1");
  return s;
}

export function isIsoLikeDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const s = value.trim();
  return DATE_ONLY_RE.test(s) || DATE_TIME_RE.test(s);
}

export function formatDate(value: DateLike, fallback = "-"): string {
  if (value == null || value === "") return fallback;
  const d = value instanceof Date ? value : new Date(normalizeDateInput(String(value)));
  if (!isValidDate(d)) return fallback;
  return DATE_FMT.format(d);
}

export function formatDateTime(value: DateLike, fallback = "-"): string {
  if (value == null || value === "") return fallback;
  const d = value instanceof Date ? value : new Date(normalizeDateInput(String(value)));
  if (!isValidDate(d)) return fallback;
  return DATETIME_FMT.format(d);
}

export function formatDateLike(value: DateLike, fallback = "-"): string {
  if (value == null || value === "") return fallback;
  if (value instanceof Date || typeof value === "number") return formatDateTime(value, fallback);
  const s = String(value).trim();
  if (!s) return fallback;
  if (DATE_ONLY_RE.test(s)) return formatDate(s, fallback);
  if (DATE_TIME_RE.test(s)) return formatDateTime(s, fallback);
  return s;
}

