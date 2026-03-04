/** Well-known company IDs used for company-specific rendering logic. */
export const OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Fallback USD→LBP exchange rate used when the backend is unreachable
 * and no locally-cached rate is available. Keep this reasonably close to
 * the real market rate so financial displays are never absurdly wrong.
 */
export const FALLBACK_FX_RATE_USD_LBP = 89500;

/** Update page title, favicon, and accent class to reflect the active company type. */
export function applyCompanyMetadata(companyId: string) {
  if (typeof document === "undefined") return;
  const cid = String(companyId || "").trim();

  // No company selected — neutral title, no favicon/accent changes
  if (!cid) {
    document.title = "Codex Admin";
    return;
  }

  const isUnofficial = cid !== OFFICIAL_COMPANY_ID;

  // Title
  document.title = isUnofficial ? "Codex Admin - Unofficial" : "Codex Admin - Official";

  // Favicon — remove ALL existing icon links first, then add our dynamic SVG
  const color = isUnofficial ? "#e11d48" : "#0d9488";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-family="sans-serif" font-weight="bold">A</text></svg>`;
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  document.querySelectorAll('link[rel="icon"],link[rel="shortcut icon"]').forEach((el) => el.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = href;
  document.head.appendChild(link);

  // Accent class — read the stored accent or default unofficial to "rose"
  // Keep in sync with COMPANY_INIT_SCRIPT accent list in layout.tsx
  const accentThemes = ["cobalt", "sky", "emerald", "teal", "rose", "slate"];
  let scoped: string | null = null;
  let raw = "";
  try {
    scoped = localStorage.getItem(`admin.accentTheme.${cid}`);
    raw = scoped ?? localStorage.getItem("admin.accentTheme") ?? "";
  } catch { /* localStorage unavailable */ }
  const accent = (raw && accentThemes.includes(raw)) ? raw : (isUnofficial ? "rose" : "");
  // Remove any existing accent class, then add the new one
  const cl = document.documentElement.classList;
  accentThemes.forEach((t) => cl.remove(`theme-${t}`));
  if (accent) cl.add(`theme-${accent}`);
}
