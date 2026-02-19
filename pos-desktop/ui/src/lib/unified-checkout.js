export function buildSalePaymentsForSettlement({
  paymentMethod = "cash",
  totalUsd = 0,
  totalLbp = 0,
  settlementCurrency = "USD",
} = {}) {
  const method = String(paymentMethod || "cash").trim().toLowerCase() || "cash";
  if (method === "credit") {
    return [{ method: "credit", amount_usd: 0, amount_lbp: 0 }];
  }

  const settle = String(settlementCurrency || "USD").trim().toUpperCase();
  if (settle === "LBP") {
    return [{ method, amount_usd: 0, amount_lbp: Number(totalLbp) || 0 }];
  }
  return [{ method, amount_usd: Number(totalUsd) || 0, amount_lbp: 0 }];
}

export function saleIdempotencyKeyForCompany(checkoutIntent, companyKey = "official") {
  const intent = String(checkoutIntent || "").trim();
  if (!intent) throw new Error("checkoutIntent is required");
  const company = String(companyKey || "").trim().toLowerCase() === "unofficial" ? "unofficial" : "official";
  return `${intent}:sale:${company}`;
}
