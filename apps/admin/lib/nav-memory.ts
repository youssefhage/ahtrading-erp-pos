export type NavMemoryEntry = {
  href: string;
  label: string;
  at: string; // ISO timestamp
};

const RECENTS_KEY = "admin.nav.recents.v1";
const FAVORITES_KEY = "admin.nav.favorites.v1";

function scopedKey(baseKey: string, companyId?: string): string {
  const cid = String(companyId || "").trim();
  return `${baseKey}.${cid || "unknown"}`;
}

function maybeMigrateLegacy(legacyKey: string, nextKey: string) {
  // One-time migration: legacy keys were global and caused cross-company leakage.
  // We migrate them into the *current* company scope so switching companies shows
  // an empty set (unless that company has its own entries).
  try {
    const legacy = localStorage.getItem(legacyKey);
    if (!legacy) return;
    if (localStorage.getItem(nextKey)) return;
    localStorage.setItem(nextKey, legacy);
    localStorage.removeItem(legacyKey);
  } catch {
    // ignore
  }
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function clampEntries(raw: any, max: number): NavMemoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: NavMemoryEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const href = String((r as any).href || "");
    const label = String((r as any).label || "");
    const at = String((r as any).at || "");
    if (!href || !label || !at) continue;
    out.push({ href, label, at });
    if (out.length >= max) break;
  }
  return out;
}

export function getRecents(): NavMemoryEntry[] {
  return getRecentsForCompany();
}

export function getRecentsForCompany(companyId?: string): NavMemoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const k = scopedKey(RECENTS_KEY, companyId);
    maybeMigrateLegacy(RECENTS_KEY, k);
    return clampEntries(safeParse(localStorage.getItem(k)), 12);
  } catch {
    return [];
  }
}

export function addRecent(entry: { href: string; label: string }) {
  addRecentForCompany(entry);
}

export function addRecentForCompany(entry: { href: string; label: string }, companyId?: string) {
  if (typeof window === "undefined") return;
  const next: NavMemoryEntry = { ...entry, at: new Date().toISOString() };
  try {
    const k = scopedKey(RECENTS_KEY, companyId);
    maybeMigrateLegacy(RECENTS_KEY, k);
    const prev = getRecentsForCompany(companyId);
    const merged = [next, ...prev.filter((e) => e.href !== next.href)].slice(0, 12);
    localStorage.setItem(k, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

export function clearRecents() {
  clearRecentsForCompany();
}

export function clearRecentsForCompany(companyId?: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(scopedKey(RECENTS_KEY, companyId));
    // Also drop legacy, just in case.
    localStorage.removeItem(RECENTS_KEY);
  } catch {
    // ignore
  }
}

export function getFavorites(): NavMemoryEntry[] {
  return getFavoritesForCompany();
}

export function getFavoritesForCompany(companyId?: string): NavMemoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const k = scopedKey(FAVORITES_KEY, companyId);
    maybeMigrateLegacy(FAVORITES_KEY, k);
    return clampEntries(safeParse(localStorage.getItem(k)), 24);
  } catch {
    return [];
  }
}

export function isFavorite(href: string): boolean {
  return getFavoritesForCompany().some((e) => e.href === href);
}

export function toggleFavorite(entry: { href: string; label: string }): boolean {
  return toggleFavoriteForCompany(entry);
}

export function toggleFavoriteForCompany(entry: { href: string; label: string }, companyId?: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const k = scopedKey(FAVORITES_KEY, companyId);
    maybeMigrateLegacy(FAVORITES_KEY, k);
    const prev = getFavoritesForCompany(companyId);
    const exists = prev.some((e) => e.href === entry.href);
    const next = exists
      ? prev.filter((e) => e.href !== entry.href)
      : [{ href: entry.href, label: entry.label, at: new Date().toISOString() }, ...prev].slice(0, 24);
    localStorage.setItem(k, JSON.stringify(next));
    return !exists;
  } catch {
    return false;
  }
}
