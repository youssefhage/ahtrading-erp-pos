import { apiGet, apiPost, getCompanyId } from "@/lib/api";

export type FxRate = {
  rate_date: string | null;
  rate_type: string;
  usd_to_lbp: string | number;
  source?: "exact" | "latest" | "fallback";
};

function cacheKey(companyId: string) {
  return `admin.fx.usd_to_lbp.v1.${companyId || "unknown"}`;
}

function safeReadCached(companyId: string) {
  try {
    const raw = localStorage.getItem(cacheKey(companyId));
    const n = Number(raw || 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function safeWriteCached(companyId: string, rate: number) {
  try {
    if (rate > 0) localStorage.setItem(cacheKey(companyId), String(rate));
  } catch {
    // ignore
  }
}

export async function getFxRateUsdToLbp(opts?: { rateDate?: string; rateType?: string }): Promise<FxRate> {
  const cid = getCompanyId();
  try {
    const params = new URLSearchParams();
    if (opts?.rateDate) params.set("rate_date", opts.rateDate);
    if (opts?.rateType) params.set("rate_type", opts.rateType);
    const qs = params.toString();
    const res = await apiGet<{ rate: FxRate }>(`/fx/rate${qs ? `?${qs}` : ""}`);
    const rate = res.rate || ({} as any);
    const n = Number((rate as any).usd_to_lbp || 0);
    if (Number.isFinite(n) && n > 0) safeWriteCached(cid, n);
    return rate;
  } catch {
    const cached = safeReadCached(cid);
    return {
      rate_date: null,
      rate_type: String(opts?.rateType || "market"),
      usd_to_lbp: cached && cached > 0 ? cached : 90000,
      source: "fallback",
    };
  }
}

export async function upsertFxRateUsdToLbp(input: { usdToLbp: number; rateDate?: string; rateType?: string }) {
  const cid = getCompanyId();
  const usd = Number(input.usdToLbp || 0);
  const payload: any = { usd_to_lbp: usd };
  if (input.rateDate) payload.rate_date = input.rateDate;
  if (input.rateType) payload.rate_type = input.rateType;
  const res = await apiPost<{ ok: boolean; rate: FxRate }>("/fx/rate", payload);
  const n = Number(res.rate?.usd_to_lbp || 0);
  if (Number.isFinite(n) && n > 0) safeWriteCached(cid, n);
  return res;
}

