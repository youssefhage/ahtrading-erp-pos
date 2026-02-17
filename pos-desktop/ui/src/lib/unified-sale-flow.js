export function cartCompaniesSet(lines = []) {
  return new Set((lines || []).map((c) => c?.companyKey).filter(Boolean));
}

export function primaryCompanyFromCart(lines = []) {
  const s = cartCompaniesSet(lines);
  if (s.size === 1) return Array.from(s.values())[0];
  return null;
}

export function effectiveInvoiceCompany({
  invoiceCompanyMode = "auto",
  originCompanyKey = "official",
  cart = [],
} = {}) {
  const v = String(invoiceCompanyMode || "auto").trim().toLowerCase();
  if (v === "official" || v === "unofficial") return v;
  return primaryCompanyFromCart(cart) || originCompanyKey || "official";
}

export function pickCompanyForAmbiguousMatch({
  invoiceCompanyMode = "auto",
  originCompanyKey = "official",
  cart = [],
  availableCompanies = [],
} = {}) {
  const available = Array.isArray(availableCompanies) ? availableCompanies.filter(Boolean) : [];
  if (available.length === 0) {
    return effectiveInvoiceCompany({ invoiceCompanyMode, originCompanyKey, cart });
  }
  const preferred = effectiveInvoiceCompany({ invoiceCompanyMode, originCompanyKey, cart });
  if (available.includes(preferred)) return preferred;
  if (available.includes("official")) return "official";
  if (available.includes("unofficial")) return "unofficial";
  return available[0];
}

export function itemExistsInCompanyCatalog({
  companyKey,
  itemId,
  otherCompanyKey = "unofficial",
  itemsByIdOrigin,
  itemsByIdOther,
} = {}) {
  const id = String(itemId || "").trim();
  if (!id) return false;
  const idx = companyKey === otherCompanyKey ? itemsByIdOther : itemsByIdOrigin;
  return !!idx?.get(id);
}

export function findMissingCompanyItems({
  companyKey,
  lines = [],
  otherCompanyKey = "unofficial",
  itemsByIdOrigin,
  itemsByIdOther,
} = {}) {
  const out = [];
  const seen = new Set();
  for (const ln of lines || []) {
    const id = String(ln?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (
      !itemExistsInCompanyCatalog({
        companyKey,
        itemId: id,
        otherCompanyKey,
        itemsByIdOrigin,
        itemsByIdOther,
      })
    ) {
      out.push(id);
    }
  }
  return out;
}
