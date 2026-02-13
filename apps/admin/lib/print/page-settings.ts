export type PrintPaper = "a4" | "receipt";

type PrintSettings = {
  paper: PrintPaper;
  landscape: boolean;
  // Keep margins conservative; users can still override in print dialog.
  marginMm: number;
  // Receipt width in mm (common thermal sizes are 58mm and 80mm).
  receiptWidthMm: number;
};

const STYLE_ID = "print-page-settings";

export function getPrintSettingsFromQuery(defaults?: Partial<Pick<PrintSettings, "paper" | "landscape">>) {
  const qs = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const rawPaper = (qs.get("paper") || "").toLowerCase();
  const rawLandscape = qs.get("landscape");

  const paper: PrintPaper =
    rawPaper === "receipt" ? "receipt" : rawPaper === "a4" ? "a4" : (defaults?.paper ?? "a4");
  const landscape =
    rawLandscape === "1" || rawLandscape === "true" ? true : rawLandscape === "0" || rawLandscape === "false" ? false : (defaults?.landscape ?? false);

  return { paper, landscape, hasExplicitPaper: !!rawPaper, hasExplicitLandscape: rawLandscape != null };
}

export function applyPrintPageSettings(opts: Partial<PrintSettings>) {
  if (typeof document === "undefined") return;

  const settings: PrintSettings = {
    paper: opts.paper ?? "a4",
    landscape: !!opts.landscape,
    marginMm: typeof opts.marginMm === "number" ? opts.marginMm : 12,
    receiptWidthMm: typeof opts.receiptWidthMm === "number" ? opts.receiptWidthMm : 80,
  };

  const cssParts: string[] = [];
  const margin = Math.max(0, Math.round(settings.marginMm * 10) / 10);

  if (settings.paper === "receipt") {
    const w = Math.max(40, Math.round(settings.receiptWidthMm * 10) / 10);
    cssParts.push(`@page { size: ${w}mm auto; margin: ${Math.max(0, Math.min(6, margin))}mm; }`);
    // Helps browsers size the preview, but doesn't force printer selection.
    cssParts.push(`html, body { width: ${w}mm; }`);
  } else if (settings.landscape) {
    cssParts.push(`@page { size: A4 landscape; margin: ${margin}mm; }`);
  } else {
    cssParts.push(`@page { size: A4; margin: ${margin}mm; }`);
  }

  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = cssParts.join("\n");
}

export function applyPrintSettingsFromQuery(defaults?: Partial<Pick<PrintSettings, "paper" | "landscape">>) {
  try {
    const q = getPrintSettingsFromQuery(defaults);
    applyPrintPageSettings({ paper: q.paper, landscape: q.landscape });
    return q;
  } catch {
    // ignore (print pages must remain resilient)
    return { paper: defaults?.paper ?? "a4", landscape: defaults?.landscape ?? false, hasExplicitPaper: false, hasExplicitLandscape: false };
  }
}

