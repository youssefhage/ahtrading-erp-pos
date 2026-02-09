import fs from "node:fs";
import path from "node:path";

// Prevent reintroducing hardcoded colors that break dark mode and fight the design tokens.
// We only scan TS/TSX source (not CSS), because globals.css intentionally contains a compatibility shim.

const ROOT = path.resolve(process.cwd());
const SCAN_DIRS = [path.join(ROOT, "app"), path.join(ROOT, "components")];
const EXT_OK = new Set([".ts", ".tsx"]);

const FORBIDDEN = [
  /\bbg-white\b(?!\/)/g,
  /\bbg-white\/\d+\b/g,
  /\btext-slate-\d+\b/g,
  /\bborder-slate-\d+\b/g,
  /\bbg-slate-\d+\b/g,
  // Use `primary` design tokens instead of Tailwind palettes in TSX/TS.
  /\b(?:bg|text|border|from|to|ring|border-t)-sky-\d+\b/g,
  // Use semantic status tokens (success/warning/danger/info) instead of Tailwind palettes in TSX/TS.
  /\b(?:bg|text|border|from|to|ring|border-t)-(?:green|emerald|red|yellow|amber|orange|blue)-\d+\b/g,
];

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out);
      continue;
    }
    const ext = path.extname(e.name);
    if (!EXT_OK.has(ext)) continue;
    out.push(full);
  }
}

function rel(p) {
  return path.relative(ROOT, p);
}

const files = [];
for (const d of SCAN_DIRS) walk(d, files);

const violations = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const re of FORBIDDEN) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    violations.push({ file, match: m[0] });
  }
}

if (violations.length) {
  // Keep output short but actionable.
  const lines = violations
    .slice(0, 50)
    .map((v) => `- ${rel(v.file)}: found \`${v.match}\``);
  const extra = violations.length > 50 ? `\n...and ${violations.length - 50} more` : "";
  console.error(
    [
      "Design-token lint failed.",
      "Replace hardcoded slate/white colors with design tokens (e.g. text-fg-muted, bg-bg-elevated, border-border-subtle).",
      "",
      ...lines,
    ].join("\n") + extra
  );
  process.exit(1);
}
