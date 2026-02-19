import { parseNumberInput } from "@/lib/numbers";

type MoneyFormatOptions = {
  maximumFractionDigits?: number;
};

type MoneyMaybeOptions = MoneyFormatOptions & {
  // In some screens, "0" in the secondary currency really means "not set/unknown",
  // e.g. USD-only price lists where LBP is derived from an exchange rate.
  dashIfZero?: boolean;
};

function toFiniteNumber(v: unknown): number {
  const r = parseNumberInput(v);
  return r.ok ? r.value : 0;
}

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

const usdFormatters = new Map<number, Intl.NumberFormat>();
function usdFormatter(maximumFractionDigits: number) {
  const key = Math.max(0, Math.min(6, Math.floor(maximumFractionDigits)));
  const existing = usdFormatters.get(key);
  if (existing) return existing;
  const nf = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 0,
    maximumFractionDigits: key
  });
  usdFormatters.set(key, nf);
  return nf;
}

const lbpFormatters = new Map<number, Intl.NumberFormat>();
function lbpFormatter(maximumFractionDigits: number) {
  const key = Math.max(0, Math.min(6, Math.floor(maximumFractionDigits)));
  const existing = lbpFormatters.get(key);
  if (existing) return existing;
  const nf = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: key
  });
  lbpFormatters.set(key, nf);
  return nf;
}

export function fmtUsd(amount: unknown, opts?: MoneyFormatOptions): string {
  const n = toFiniteNumber(amount);
  return usdFormatter(opts?.maximumFractionDigits ?? 2).format(n);
}

export function fmtLbp(amount: unknown, opts?: MoneyFormatOptions): string {
  const n = toFiniteNumber(amount);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}LL ${lbpFormatter(opts?.maximumFractionDigits ?? 0).format(abs)}`;
}

export function fmtUsdMaybe(amount: unknown, opts?: MoneyMaybeOptions): string {
  if (isMissing(amount)) return "$-";
  const n = toFiniteNumber(amount);
  if (opts?.dashIfZero && n === 0) return "$-";
  return usdFormatter(opts?.maximumFractionDigits ?? 2).format(n);
}

export function fmtLbpMaybe(amount: unknown, opts?: MoneyMaybeOptions): string {
  if (isMissing(amount)) return "-";
  const n = toFiniteNumber(amount);
  if (opts?.dashIfZero && n === 0) return "-";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}LL ${lbpFormatter(opts?.maximumFractionDigits ?? 0).format(abs)}`;
}

export function fmtUsdLbp(
  usdAmount: unknown,
  lbpAmount: unknown,
  opts?: {
    sep?: string;
    // When one side is non-zero and the other is zero, it's often "not set / derived".
    // This replaces the zero side with a dash to avoid confusion.
    dashIfZeroWhenOtherNonZero?: boolean;
    // Hide the missing side entirely (instead of showing a trailing dash) to keep UI concise.
    hideMissingSide?: boolean;
    usd?: MoneyMaybeOptions;
    lbp?: MoneyMaybeOptions;
  }
): string {
  const sep = opts?.sep ?? " / ";
  const dash = opts?.dashIfZeroWhenOtherNonZero ?? true;
  const hideMissingSide = opts?.hideMissingSide ?? true;
  const u = toFiniteNumber(usdAmount);
  const l = toFiniteNumber(lbpAmount);
  const usdDash = dash && u === 0 && l !== 0;
  const lbpDash = dash && l === 0 && u !== 0;
  const usdText = fmtUsdMaybe(usdAmount, { ...opts?.usd, dashIfZero: (opts?.usd?.dashIfZero ?? false) || usdDash });
  const lbpText = fmtLbpMaybe(lbpAmount, {
    ...opts?.lbp,
    dashIfZero: (opts?.lbp?.dashIfZero ?? false) || lbpDash,
  });
  if (hideMissingSide) {
    const usdMissing = usdText === "$-";
    const lbpMissing = lbpText === "-";
    if (usdMissing && lbpMissing) return "$-";
    if (usdMissing) return lbpText;
    if (lbpMissing) return usdText;
  }
  return `${usdText}${sep}${lbpText}`;
}
