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
  const isUnofficial = !!cid && cid !== OFFICIAL_COMPANY_ID;

  // Title
  document.title = isUnofficial ? "Codex Admin - Unofficial" : "Codex Admin - Official";

  // Favicon
  const color = isUnofficial ? "#e11d48" : "#0d9488";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18" font-family="sans-serif" font-weight="bold">A</text></svg>`;
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    const existing = document.querySelector('link[rel="icon"]');
    if (existing) existing.remove();
    document.head.appendChild(link);
  }
  link.href = href;

  // Accent class — read the stored accent or default unofficial to "rose"
  const accentThemes = ["cobalt", "sky", "emerald", "teal", "rose", "slate"];
  const scoped = cid ? localStorage.getItem(`admin.accentTheme.${cid}`) : null;
  const raw = scoped ?? localStorage.getItem("admin.accentTheme") ?? "";
  const accent = (raw && accentThemes.includes(raw)) ? raw : (isUnofficial ? "rose" : "");
  // Remove any existing accent class, then add the new one
  const cl = document.documentElement.classList;
  accentThemes.forEach((t) => cl.remove(`theme-${t}`));
  if (accent) cl.add(`theme-${accent}`);
}
