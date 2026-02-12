import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ESLINT_BIN = path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js");

function walk(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      // Skip common large/generated dirs.
      if (ent.name === "node_modules" || ent.name === ".next" || ent.name === "dist") continue;
      walk(p, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!/\.(ts|tsx|js|mjs)$/.test(ent.name)) continue;
    out.push(p);
  }
}

function chunk(arr, size) {
  const n = Math.max(1, Number(size || 25) || 25);
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function main() {
  if (!fs.existsSync(ESLINT_BIN)) {
    console.error(`ESLint binary not found at ${ESLINT_BIN}`);
    process.exit(2);
  }

  const roots = ["app", "components", "lib", "scripts"].map((d) => path.join(ROOT, d));
  const files = [];
  for (const r of roots) walk(r, files);

  if (!files.length) return;
  const batchSize = process.env.ESLINT_CHUNK_SIZE || "25";
  for (const batch of chunk(files, batchSize)) {
    const res = spawnSync(process.execPath, [ESLINT_BIN, ...batch, "--max-warnings", "0"], {
      stdio: "inherit"
    });
    if (res.status !== 0) process.exit(res.status || 1);
  }
}

main();

