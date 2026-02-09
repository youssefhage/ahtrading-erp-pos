export type NavMemoryEntry = {
  href: string;
  label: string;
  at: string; // ISO timestamp
};

const RECENTS_KEY = "admin.nav.recents.v1";
const FAVORITES_KEY = "admin.nav.favorites.v1";

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
  if (typeof window === "undefined") return [];
  try {
    return clampEntries(safeParse(localStorage.getItem(RECENTS_KEY)), 12);
  } catch {
    return [];
  }
}

export function addRecent(entry: { href: string; label: string }) {
  if (typeof window === "undefined") return;
  const next: NavMemoryEntry = { ...entry, at: new Date().toISOString() };
  try {
    const prev = getRecents();
    const merged = [next, ...prev.filter((e) => e.href !== next.href)].slice(0, 12);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

export function clearRecents() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(RECENTS_KEY);
  } catch {
    // ignore
  }
}

export function getFavorites(): NavMemoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return clampEntries(safeParse(localStorage.getItem(FAVORITES_KEY)), 24);
  } catch {
    return [];
  }
}

export function isFavorite(href: string): boolean {
  return getFavorites().some((e) => e.href === href);
}

export function toggleFavorite(entry: { href: string; label: string }): boolean {
  if (typeof window === "undefined") return false;
  try {
    const prev = getFavorites();
    const exists = prev.some((e) => e.href === entry.href);
    const next = exists
      ? prev.filter((e) => e.href !== entry.href)
      : [{ href: entry.href, label: entry.label, at: new Date().toISOString() }, ...prev].slice(0, 24);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    return !exists;
  } catch {
    return false;
  }
}

