/** Well-known company IDs used for company-specific rendering logic. */
export const OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Fallback USD→LBP exchange rate used when the backend is unreachable
 * and no locally-cached rate is available. Keep this reasonably close to
 * the real market rate so financial displays are never absurdly wrong.
 */
export const FALLBACK_FX_RATE_USD_LBP = 89500;
