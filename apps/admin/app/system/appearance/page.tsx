"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ColorTheme = "light" | "dark";
type AccentTheme = "cobalt" | "sky" | "emerald" | "teal" | "rose" | "slate";

const ACCENT_THEME_VARS: Record<
  AccentTheme,
  { primary: string; primaryFg: string; primaryDim: string; primaryGlow: string; ring: string }
> = {
  cobalt: {
    primary: "37 99 235",
    primaryFg: "255 255 255",
    primaryDim: "29 78 216",
    primaryGlow: "37 99 235",
    ring: "37 99 235"
  },
  sky: {
    primary: "14 165 233",
    primaryFg: "0 0 0",
    primaryDim: "3 105 161",
    primaryGlow: "14 165 233",
    ring: "14 165 233"
  },
  emerald: {
    primary: "16 185 129",
    primaryFg: "0 0 0",
    primaryDim: "4 120 87",
    primaryGlow: "16 185 129",
    ring: "16 185 129"
  },
  teal: {
    primary: "20 184 166",
    primaryFg: "0 0 0",
    primaryDim: "15 118 110",
    primaryGlow: "20 184 166",
    ring: "20 184 166"
  },
  rose: {
    primary: "244 63 94",
    primaryFg: "255 255 255",
    primaryDim: "190 18 60",
    primaryGlow: "244 63 94",
    ring: "244 63 94"
  },
  slate: {
    primary: "100 116 139",
    primaryFg: "255 255 255",
    primaryDim: "51 65 85",
    primaryGlow: "100 116 139",
    ring: "100 116 139"
  }
};

const ACCENT_THEMES: {
  key: AccentTheme;
  label: string;
  primary: string; // "r g b"
  dim: string; // "r g b"
}[] = [
  { key: "cobalt", label: "Cobalt", primary: "37 99 235", dim: "29 78 216" },
  { key: "sky", label: "Sky", primary: "14 165 233", dim: "3 105 161" },
  { key: "emerald", label: "Emerald", primary: "16 185 129", dim: "4 120 87" },
  { key: "teal", label: "Teal", primary: "20 184 166", dim: "15 118 110" },
  { key: "rose", label: "Rose", primary: "244 63 94", dim: "190 18 60" },
  { key: "slate", label: "Slate", primary: "100 116 139", dim: "51 65 85" }
];

function emitThemeChange(detail: { color?: ColorTheme; accent?: AccentTheme }) {
  try {
    window.dispatchEvent(new CustomEvent("admin-theme-change", { detail }));
  } catch {
    // ignore
  }
}

function applyColorTheme(next: ColorTheme) {
  try {
    localStorage.setItem("admin.colorTheme", next);
  } catch {
    // ignore
  }
  if (next === "dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
  emitThemeChange({ color: next });
}

function applyAccentTheme(next: AccentTheme) {
  try {
    localStorage.setItem("admin.accentTheme", next);
  } catch {
    // ignore
  }
  // Remove any existing `theme-*` classes, then apply the new one.
  const cls = Array.from(document.documentElement.classList);
  for (const c of cls) {
    if (c.startsWith("theme-")) document.documentElement.classList.remove(c);
  }
  document.documentElement.classList.add(`theme-${next}`);
  const vars = ACCENT_THEME_VARS[next] ?? ACCENT_THEME_VARS.sky;
  document.documentElement.style.setProperty("--primary", vars.primary);
  document.documentElement.style.setProperty("--primary-fg", vars.primaryFg);
  document.documentElement.style.setProperty("--primary-dim", vars.primaryDim);
  document.documentElement.style.setProperty("--primary-glow", vars.primaryGlow);
  document.documentElement.style.setProperty("--ring", vars.ring);
  emitThemeChange({ accent: next });
}

function safeReadTheme(): { color: ColorTheme; accent: AccentTheme } {
  try {
    const cRaw = localStorage.getItem("admin.colorTheme");
    const aRaw = localStorage.getItem("admin.accentTheme");
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
  const [colorTheme, setColorTheme] = useState<ColorTheme>("light");
  const [accentTheme, setAccentTheme] = useState<AccentTheme>("cobalt");

  useEffect(() => {
    const t = safeReadTheme();
    setColorTheme(t.color);
    setAccentTheme(t.accent);
  }, []);

  const selectedAccent = useMemo(
    () => ACCENT_THEMES.find((t) => t.key === accentTheme) ?? ACCENT_THEMES[0],
    [accentTheme]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Appearance</h1>
        <p className="mt-1 text-sm text-fg-subtle">
          Choose how the portal looks on this device. Your selection is saved in your browser.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Color Mode</CardTitle>
          <CardDescription>Light or dark UI mode.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={colorTheme === "light"}
              className={cn(
                "group flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                colorTheme === "light"
                  ? "border-primary/30 bg-primary/5"
                  : "border-border-subtle bg-bg-elevated/50 hover:border-border-strong"
              )}
              onClick={() => {
                setColorTheme("light");
                applyColorTheme("light");
              }}
            >
              <span
                className="h-9 w-9 shrink-0 rounded-md border border-border-subtle"
                style={{
                  background: "linear-gradient(135deg, rgb(250 250 250), rgb(228 228 231))"
                }}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">Light</div>
                <div className="text-xs text-fg-subtle">Bright background, high contrast text.</div>
              </div>
              {colorTheme === "light" && (
                <span className="ml-auto rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  ACTIVE
                </span>
              )}
            </button>

            <button
              type="button"
              aria-pressed={colorTheme === "dark"}
              className={cn(
                "group flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                colorTheme === "dark"
                  ? "border-primary/30 bg-primary/5"
                  : "border-border-subtle bg-bg-elevated/50 hover:border-border-strong"
              )}
              onClick={() => {
                setColorTheme("dark");
                applyColorTheme("dark");
              }}
            >
              <span
                className="h-9 w-9 shrink-0 rounded-md border border-border-subtle"
                style={{
                  background: "linear-gradient(135deg, rgb(9 9 11), rgb(24 24 27))"
                }}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">Dark</div>
                <div className="text-xs text-fg-subtle">Low glare, better in dim environments.</div>
              </div>
              {colorTheme === "dark" && (
                <span className="ml-auto rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  ACTIVE
                </span>
              )}
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accent Theme</CardTitle>
          <CardDescription>Changes the primary color used for actions, highlights, and focus.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ACCENT_THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={accentTheme === t.key}
                className={cn(
                  "group flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  accentTheme === t.key
                    ? "border-primary/30 bg-primary/5"
                    : "border-border-subtle bg-bg-elevated/50 hover:border-border-strong"
                )}
                onClick={() => {
                  setAccentTheme(t.key);
                  applyAccentTheme(t.key);
                }}
              >
                <span
                  className="h-9 w-9 shrink-0 rounded-md border border-border-subtle"
                  style={{ background: swatchBg(t.primary, t.dim) }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{t.label}</div>
                  <div className="text-xs text-fg-subtle">
                    Primary: <span className="font-mono">{t.primary}</span>
                  </div>
                </div>
                {accentTheme === t.key && (
                  <span className="ml-auto rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    ACTIVE
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-border-subtle bg-bg-elevated/40 p-3">
            <div className="text-xs text-fg-subtle">
              Current accent:{" "}
              <span className="font-medium text-foreground">{selectedAccent.label}</span>{" "}
              <span className="ml-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: `rgb(${selectedAccent.primary})` }} />{" "}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
