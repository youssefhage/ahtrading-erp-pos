"use client";

import { useEffect, useMemo, useState } from "react";
import { Moon, Sun, Palette } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/business/page-header";
import { apiGet, getCompanyId } from "@/lib/api";
import { cn } from "@/lib/utils";

type ColorTheme = "light" | "dark";
type AccentTheme = "cobalt" | "sky" | "emerald" | "teal" | "rose" | "slate";
const COLOR_THEME_STORAGE_KEY = "admin.colorTheme";
const ACCENT_THEME_STORAGE_KEY = "admin.accentTheme";

const ALL_ACCENT_THEMES = ["cobalt", "sky", "emerald", "teal", "rose", "slate"] as const;

const ACCENT_THEMES: {
  key: AccentTheme;
  label: string;
  primary: string;
  dim: string;
}[] = [
  { key: "cobalt", label: "Cobalt", primary: "37 99 235", dim: "29 78 216" },
  { key: "sky", label: "Sky", primary: "14 165 233", dim: "3 105 161" },
  { key: "emerald", label: "Emerald", primary: "16 185 129", dim: "4 120 87" },
  { key: "teal", label: "Teal", primary: "20 184 166", dim: "15 118 110" },
  { key: "rose", label: "Rose", primary: "244 63 94", dim: "190 18 60" },
  { key: "slate", label: "Slate", primary: "100 116 139", dim: "51 65 85" },
];

function normalizeCompanyThemeScope(companyId: string) {
  return String(companyId || "").trim();
}

function themeStorageKey(baseKey: string, companyId: string) {
  const cid = normalizeCompanyThemeScope(companyId);
  return cid ? `${baseKey}.${cid}` : baseKey;
}

function readThemeStorage(baseKey: string, companyId: string) {
  try {
    const scoped = localStorage.getItem(themeStorageKey(baseKey, companyId));
    if (scoped != null) return scoped;
    return localStorage.getItem(baseKey);
  } catch {
    return null;
  }
}

function saveThemeStorage(baseKey: string, companyId: string, value: string) {
  try {
    localStorage.setItem(themeStorageKey(baseKey, companyId), value);
  } catch {
    // ignore
  }
}

function emitThemeChange(detail: { color?: ColorTheme; accent?: AccentTheme; companyId?: string }) {
  try {
    window.dispatchEvent(new CustomEvent("admin-theme-change", { detail }));
  } catch {
    // ignore
  }
}

function applyColorTheme(next: ColorTheme, companyId: string) {
  saveThemeStorage(COLOR_THEME_STORAGE_KEY, companyId, next);
  if (next === "dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
  emitThemeChange({ color: next, companyId: normalizeCompanyThemeScope(companyId) });
}

function applyAccentTheme(next: AccentTheme, companyId: string) {
  saveThemeStorage(ACCENT_THEME_STORAGE_KEY, companyId, next);
  const root = document.documentElement;
  ALL_ACCENT_THEMES.forEach((t) => root.classList.remove(`theme-${t}`));
  root.classList.add(`theme-${next}`);
  root.style.removeProperty("--primary");
  root.style.removeProperty("--primary-fg");
  root.style.removeProperty("--primary-dim");
  root.style.removeProperty("--primary-glow");
  root.style.removeProperty("--ring");
  emitThemeChange({ accent: next, companyId: normalizeCompanyThemeScope(companyId) });
}

function safeReadTheme(companyId: string): { color: ColorTheme; accent: AccentTheme } {
  try {
    const cRaw = readThemeStorage(COLOR_THEME_STORAGE_KEY, companyId);
    const aRaw = readThemeStorage(ACCENT_THEME_STORAGE_KEY, companyId);
    const color: ColorTheme = cRaw === "dark" ? "dark" : "light";
    const accent: AccentTheme =
      aRaw === "cobalt" || aRaw === "emerald" || aRaw === "teal" || aRaw === "rose" || aRaw === "slate" || aRaw === "sky"
        ? aRaw
        : "cobalt";
    return { color, accent };
  } catch {
    return { color: "light", accent: "cobalt" };
  }
}

function swatchBg(primary: string, dim: string) {
  return `linear-gradient(135deg, rgb(${primary} / 0.95), rgb(${dim} / 0.95))`;
}

export default function AppearanceSettingsPage() {
  const [companyId, setCompanyId] = useState<string>(() => getCompanyId());
  const [companyName, setCompanyName] = useState("");
  const [colorTheme, setColorTheme] = useState<ColorTheme>("light");
  const [accentTheme, setAccentTheme] = useState<AccentTheme>("cobalt");

  useEffect(() => {
    const nextCompanyId = getCompanyId();
    setCompanyId(nextCompanyId);
    const t = safeReadTheme(nextCompanyId);
    setColorTheme(t.color);
    setAccentTheme(t.accent);
    if (nextCompanyId) {
      apiGet<{ companies: Array<{ id: string; name: string }> }>("/companies")
        .then((res) => {
          const match = (res.companies || []).find((c) => c.id === nextCompanyId);
          if (match) setCompanyName(match.name);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "ahtrading.companyId") {
        const nextCompanyId = getCompanyId();
        setCompanyId(nextCompanyId);
        const t = safeReadTheme(nextCompanyId);
        setColorTheme(t.color);
        setAccentTheme(t.accent);
        return;
      }
      if (!e.key) return;
      if (e.key === COLOR_THEME_STORAGE_KEY || e.key.startsWith(`${COLOR_THEME_STORAGE_KEY}.`)) {
        setColorTheme(safeReadTheme(getCompanyId()).color);
      }
      if (e.key === ACCENT_THEME_STORAGE_KEY || e.key.startsWith(`${ACCENT_THEME_STORAGE_KEY}.`)) {
        setAccentTheme(safeReadTheme(getCompanyId()).accent);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const selectedAccent = useMemo(
    () => ACCENT_THEMES.find((t) => t.key === accentTheme) ?? ACCENT_THEMES[0],
    [accentTheme],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Appearance"
        description="Choose how the portal looks on this device. Your selection is saved in your browser per active company."
      >
        <p className="text-xs text-muted-foreground">
          Active company: <span className="font-medium text-sm">{companyName || companyId || "not selected"}</span>
        </p>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {colorTheme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            Color Mode
          </CardTitle>
          <CardDescription>Light or dark UI mode.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={colorTheme === "light"}
              className={cn(
                "group flex items-center gap-4 rounded-lg border p-4 text-left transition-colors",
                colorTheme === "light"
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border hover:border-muted-foreground/30",
              )}
              onClick={() => {
                setColorTheme("light");
                applyColorTheme("light", companyId);
              }}
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
              {colorTheme === "light" && (
                <span className="ml-auto rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Active
                </span>
              )}
            </button>

            <button
              type="button"
              aria-pressed={colorTheme === "dark"}
              className={cn(
                "group flex items-center gap-4 rounded-lg border p-4 text-left transition-colors",
                colorTheme === "dark"
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border hover:border-muted-foreground/30",
              )}
              onClick={() => {
                setColorTheme("dark");
                applyColorTheme("dark", companyId);
              }}
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
              {colorTheme === "dark" && (
                <span className="ml-auto rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Active
                </span>
              )}
            </button>
          </div>
        </CardContent>
      </Card>

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
                onClick={() => {
                  setAccentTheme(t.key);
                  applyAccentTheme(t.key, companyId);
                }}
              >
                <span
                  className="h-10 w-10 shrink-0 rounded-md border"
                  style={{ background: swatchBg(t.primary, t.dim) }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="font-mono text-xs text-muted-foreground">{t.primary}</div>
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
                style={{ background: `rgb(${selectedAccent.primary})` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
