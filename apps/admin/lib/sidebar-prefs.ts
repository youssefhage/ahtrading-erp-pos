/**
 * Persist sidebar section collapse state per module (localStorage).
 * Company-scoped to avoid cross-company UI leakage.
 */

const KEY = "admin.sidebar.collapsed.v1";

function storageKey(companyId?: string): string {
  const cid = String(companyId || "").trim() || "default";
  return `${KEY}.${cid}`;
}

type CollapsedMap = Record<string, string[]>; // moduleId -> sectionLabel[]

function read(companyId?: string): CollapsedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    return raw ? (JSON.parse(raw) as CollapsedMap) : {};
  } catch {
    return {};
  }
}

function write(data: CollapsedMap, companyId?: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(companyId), JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function getCollapsedSections(moduleId: string, companyId?: string): Set<string> {
  const map = read(companyId);
  return new Set(map[moduleId] || []);
}

export function toggleSectionCollapsed(
  moduleId: string,
  sectionLabel: string,
  companyId?: string
): boolean {
  const map = read(companyId);
  const arr = map[moduleId] || [];
  const idx = arr.indexOf(sectionLabel);
  if (idx >= 0) {
    arr.splice(idx, 1);
  } else {
    arr.push(sectionLabel);
  }
  map[moduleId] = arr;
  write(map, companyId);
  return idx < 0; // returns true if now collapsed
}
