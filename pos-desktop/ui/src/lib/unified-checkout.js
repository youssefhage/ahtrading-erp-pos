const EPS = 1e-9;

const toNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundUsd = (value) => Math.max(0, Math.round((toNum(value, 0) + EPS) * 100) / 100);
const roundLbp = (value) => Math.max(0, Math.round(toNum(value, 0) + EPS));

export function normalizeSettlementCurrency(settlementCurrency = "USD") {
  const settle = String(settlementCurrency || "USD").trim().toUpperCase();
  return settle === "LBP" ? "LBP" : "USD";
}

export function buildSalePaymentsForSettlement({
  paymentMethod = "cash",
  totalUsd = 0,
  totalLbp = 0,
  settlementCurrency = "USD",
} = {}) {
  const method = String(paymentMethod || "cash").trim().toLowerCase() || "cash";
  const settled = normalizeSettlementCurrency(settlementCurrency);
  const usd = roundUsd(totalUsd);
  const lbp = roundLbp(totalLbp);

  if (method === "credit") {
    return [{ method: "credit", amount_usd: 0, amount_lbp: 0 }];
  }

  if (settled === "LBP") {
    return [{ method, amount_usd: 0, amount_lbp: lbp }];
  }
  return [{ method, amount_usd: usd, amount_lbp: 0 }];
}

export function assertPaymentsWithinTotals({
  paymentMethod = "cash",
  settlementCurrency = "USD",
  totalUsd = 0,
  totalLbp = 0,
  payments = [],
} = {}) {
  const method = String(paymentMethod || "cash").trim().toLowerCase() || "cash";
  if (method === "credit") return;

  const settled = normalizeSettlementCurrency(settlementCurrency);
  const expectedUsd = roundUsd(totalUsd);
  const expectedLbp = roundLbp(totalLbp);
  const rows = Array.isArray(payments) ? payments : [];

  let paidUsd = 0;
  let paidLbp = 0;
  for (const p of rows) {
    paidUsd += roundUsd(p?.amount_usd);
    paidLbp += roundLbp(p?.amount_lbp);
  }

  if (settled === "USD") {
    if (paidLbp > 0) {
      throw new Error("Checkout guardrail: USD settlement cannot include LBP payment amounts.");
    }
    if (paidUsd - expectedUsd > 0.009) {
      throw new Error("Checkout guardrail: payment exceeds invoice total (USD).");
    }
    return;
  }

  if (paidUsd > 0.0009) {
    throw new Error("Checkout guardrail: LBP settlement cannot include USD payment amounts.");
  }
  if (paidLbp > expectedLbp) {
    throw new Error("Checkout guardrail: payment exceeds invoice total (LBP).");
  }
}

export function saleIdempotencyKeyForCompany(checkoutIntent, companyKey = "official") {
  const intent = String(checkoutIntent || "").trim();
  if (!intent) throw new Error("checkoutIntent is required");
  const company = String(companyKey || "").trim().toLowerCase() === "unofficial" ? "unofficial" : "official";
  return `${intent}:sale:${company}`;
}
