type CompanyScopedKey = "defaultWarehouseId" | "defaultBranchId";

const PREFIX = "admin.opContext.v1";

function key(companyId: string, k: CompanyScopedKey) {
  const cid = String(companyId || "").trim();
  return `${PREFIX}.${cid || "unknown"}.${k}`;
}

export function getDefaultWarehouseId(companyId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key(companyId, "defaultWarehouseId")) || "";
  } catch {
    return "";
  }
}

export function setDefaultWarehouseId(companyId: string, warehouseId: string) {
  if (typeof window === "undefined") return;
  try {
    const v = String(warehouseId || "").trim();
    if (!v) window.localStorage.removeItem(key(companyId, "defaultWarehouseId"));
    else window.localStorage.setItem(key(companyId, "defaultWarehouseId"), v);
  } catch {
    // ignore
  }
}

export function getDefaultBranchId(companyId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key(companyId, "defaultBranchId")) || "";
  } catch {
    return "";
  }
}

export function setDefaultBranchId(companyId: string, branchId: string) {
  if (typeof window === "undefined") return;
  try {
    const v = String(branchId || "").trim();
    if (!v) window.localStorage.removeItem(key(companyId, "defaultBranchId"));
    else window.localStorage.setItem(key(companyId, "defaultBranchId"), v);
  } catch {
    // ignore
  }
}

