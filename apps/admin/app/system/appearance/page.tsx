"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Palette } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/business/page-header";
import { apiGet, getCompanyId } from "@/lib/api";
import { OFFICIAL_COMPANY_ID, applyCompanyMetadata } from "@/lib/constants";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Accent theme definitions                                           */
/* ------------------------------------------------------------------ */

type AccentTheme = "default" | "cobalt" | "sky" | "emerald" | "teal" | "rose" | "slate";

const ACCENT_THEME_STORAGE_KEY = "admin.accentTheme";

const ACCENT_CLASSES: AccentTheme[] = ["cobalt", "sky", "emerald", "teal", "rose", "slate"];

const ACCENT_THEMES: {
  key: AccentTheme;
  label: string;
  /** HSL string for the preview swatch (light variant) */
  swatch: string;
  /** HSL string for the swatch gradient end */
  swatchDim: string;
}[] = [
  { key: "default", label: "Default", swatch: "240 5.9% 10%", swatchDim: "240 3.8% 46.1%" },
  { key: "cobalt", label: "Cobalt", swatch: "217 89% 53%", swatchDim: "217 89% 42%" },
  { key: "sky", label: "Sky", swatch: "199 89% 48%", swatchDim: "199 89% 38%" },
  { key: "emerald", label: "Emerald", swatch: "160 84% 39%", swatchDim: "160 84% 29%" },
  { key: "teal", label: "Teal", swatch: "173 80% 40%", swatchDim: "173 80% 30%" },
  { key: "rose", label: "Rose", swatch: "350 89% 60%", swatchDim: "350 89% 48%" },
  { key: "slate", label: "Slate", swatch: "215 16% 47%", swatchDim: "215 16% 35%" },
];

/* ------------------------------------------------------------------ */
/*  Scoped localStorage helpers for accent theme                       */
/* ------------------------------------------------------------------ */

function scopeKey(companyId: string) {
  const cid = String(companyId || "").trim();
  return cid ? `${ACCENT_THEME_STORAGE_KEY}.${cid}` : ACCENT_THEME_STORAGE_KEY;
}

function isUnofficialCompany(companyId: string): boolean {
  const cid = String(companyId || "").trim();
  return !!cid && cid !== OFFICIAL_COMPANY_ID;
}

function readAccent(companyId: string): AccentTheme {
  try {
    const scoped = localStorage.getItem(scopeKey(companyId));
    const raw = scoped ?? localStorage.getItem(ACCENT_THEME_STORAGE_KEY);
    if (raw && ACCENT_CLASSES.includes(raw as AccentTheme)) return raw as AccentTheme;
    if (raw === "default") return "default";
    // Unofficial companies default to rose (red) when no accent is stored
    return isUnofficialCompany(companyId) ? "rose" : "default";
  } catch {
    return "default";
  }
}

function saveAccent(companyId: string, value: AccentTheme) {
  try {
    localStorage.setItem(scopeKey(companyId), value);
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/*  Apply accent theme to document                                     */
/* ------------------------------------------------------------------ */

function applyAccent(next: AccentTheme) {
  const root = document.documentElement;
  // Remove any existing accent class
  ACCENT_CLASSES.forEach((t) => root.classList.remove(`theme-${t}`));
  // Add the new one (skip for "default" — base CSS applies)
  if (next !== "default") {
    root.classList.add(`theme-${next}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Swatch gradient helper                                             */
/* ------------------------------------------------------------------ */

function swatchBg(swatch: string, swatchDim: string) {
  return `linear-gradient(135deg, hsl(${swatch}), hsl(${swatchDim}))`;
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function AppearanceSettingsPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [companyId, setCompanyId] = useState<string>("");
  const [companyName, setCompanyName] = useState("");
  const [accentTheme, setAccentTheme] = useState<AccentTheme>("default");

  // Wait for client mount (next-themes needs this)
  useEffect(() => {
    setMounted(true);
    const cid = getCompanyId();
    setCompanyId(cid);
    setAccentTheme(readAccent(cid));
    applyCompanyMetadata(cid);
    if (cid) {
      apiGet<{ companies: Array<{ id: string; name: string }> }>("/companies")
        .then((res) => {
          const match = (res.companies || []).find((c) => c.id === cid);
          if (match) setCompanyName(match.name);
        })
        .catch(() => {});
    }
  }, []);

  // Listen for company switch or external accent changes
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "ahtrading.companyId") {
        // Ignore cross-tab company changes — this tab is locked to its own company
        // via sessionStorage. Only react if this tab has no sessionStorage company
        // (i.e. it hasn't picked a company yet).
        try {
          if (window.sessionStorage.getItem("ahtrading.companyId")) return;
        } catch { /* ignore */ }
        const cid = getCompanyId();
        setCompanyId(cid);
        setAccentTheme(readAccent(cid));
        applyCompanyMetadata(cid);
        return;
      }
      if (e.key && e.key.startsWith(ACCENT_THEME_STORAGE_KEY)) {
        setAccentTheme(readAccent(getCompanyId()));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const colorMode = mounted ? (resolvedTheme === "dark" ? "dark" : "light") : "light";

  const selectedAccent = useMemo(
    () => ACCENT_THEMES.find((t) => t.key === accentTheme) ?? ACCENT_THEMES[0],
    [accentTheme],
  );

  function handleAccentChange(next: AccentTheme) {
    setAccentTheme(next);
    saveAccent(companyId, next);
    applyAccent(next);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Appearance"
        description="Choose how the portal looks. Color mode is saved in your browser; accent theme is per company."
      >
        <p className="text-xs text-muted-foreground">
          Active company: <span className="font-medium text-sm">{companyName || companyId || "not selected"}</span>
        </p>
      </PageHeader>

      {/* ── Color Mode ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {colorMode === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            Color Mode
          </CardTitle>
          <CardDescription>Light or dark UI mode.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={colorMode === "light"}
              className={cn(
                "group flex items-center gap-4 rounded-lg border p-4 text-left transition-colors",
                colorMode === "light"
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border hover:border-muted-foreground/30",
              )}
              onClick={() => setTheme("light")}
            >
              <span
                className="h-10 w-10 shrink-0 rounded-md border"
                style={{
                  background: "linear-gradient(135deg, rgb(250 250 250), rgb(228 228 231))",
                }}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium">Light</div>
                <div className="text-xs text-muted-foreground">Bright background, high contrast text.</div>
              </div>
              {colorMode === "light" && (
                <span className="ml-auto rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Active
                </span>
              )}
            </button>

            <button
              type="button"
              aria-pressed={colorMode === "dark"}
              className={cn(
                "group flex items-center gap-4 rounded-lg border p-4 text-left transition-colors",
                colorMode === "dark"
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border hover:border-muted-foreground/30",
              )}
              onClick={() => setTheme("dark")}
            >
              <span
                className="h-10 w-10 shrink-0 rounded-md border"
                style={{
                  background: "linear-gradient(135deg, rgb(9 9 11), rgb(24 24 27))",
                }}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium">Dark</div>
                <div className="text-xs text-muted-foreground">Low glare, better in dim environments.</div>
              </div>
              {colorMode === "dark" && (
                <span className="ml-auto rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Active
                </span>
              )}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── Accent Theme ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Accent Theme
          </CardTitle>
          <CardDescription>Changes the primary color used for actions, highlights, and focus.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ACCENT_THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={accentTheme === t.key}
                className={cn(
                  "group flex items-center gap-4 rounded-lg border p-4 text-left transition-colors",
                  accentTheme === t.key
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : "border-border hover:border-muted-foreground/30",
                )}
                onClick={() => handleAccentChange(t.key)}
              >
                <span
                  className="h-10 w-10 shrink-0 rounded-md border"
                  style={{ background: swatchBg(t.swatch, t.swatchDim) }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t.label}</div>
                </div>
                {accentTheme === t.key && (
                  <span className="ml-auto rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Active
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Current accent:{" "}
              <span className="font-medium text-foreground">{selectedAccent.label}</span>
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: `hsl(${selectedAccent.swatch})` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
