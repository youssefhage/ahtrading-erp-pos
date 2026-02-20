import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const thisDir = dirname(fileURLToPath(import.meta.url));
const appRoot = join(thisDir, "..");
const tauriConfigPath = join(appRoot, "src-tauri", "tauri.conf.json");
const tmpConfigPath = join(appRoot, "src-tauri", "tauri.conf.nosign.generated.json");
const passthroughArgs = process.argv.slice(2);

function requestedBundles(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const cur = String(args[i] || "");
    if (cur === "--bundles") {
      const next = String(args[i + 1] || "");
      if (next) {
        out.push(...next.split(",").map((x) => x.trim()).filter(Boolean));
        i += 1;
      }
      continue;
    }
    if (cur.startsWith("--bundles=")) {
      out.push(
        ...cur
          .slice("--bundles=".length)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      );
    }
  }
  return out;
}

function runBuild(args) {
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const res = spawnSync(npxCmd, ["tauri", "build", ...args], {
    cwd: appRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (res.error) {
    console.error(`[pos-desktop] failed to start Tauri build command (${npxCmd}): ${res.error.message}`);
  }
  return res.status ?? 1;
}

const bundles = requestedBundles(passthroughArgs).map((x) => x.toLowerCase());
const wantsWindowsBundles = bundles.some((x) => x === "nsis" || x === "msi");
if (wantsWindowsBundles && process.platform !== "win32") {
  console.error("[pos-desktop] Windows bundles (nsis/msi) must be built on Windows.");
  console.error("[pos-desktop] Run `npm run build:windows` from a Windows machine/runner.");
  process.exit(1);
}

const signingKey = String(process.env.TAURI_SIGNING_PRIVATE_KEY || "").trim();
if (signingKey) {
  process.exit(runBuild(passthroughArgs));
}

const config = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
config.bundle = config.bundle || {};
config.bundle.createUpdaterArtifacts = false;
if (config.plugins && config.plugins.updater && typeof config.plugins.updater === "object") {
  delete config.plugins.updater.pubkey;
}

writeFileSync(tmpConfigPath, JSON.stringify(config, null, 2));
console.warn("[pos-desktop] TAURI_SIGNING_PRIVATE_KEY not set; building unsigned bundles (updater artifacts disabled).");
let code = 1;
try {
  code = runBuild(["--config", tmpConfigPath, ...passthroughArgs]);
} finally {
  if (existsSync(tmpConfigPath)) {
    try {
      unlinkSync(tmpConfigPath);
    } catch {
      // Ignore cleanup errors.
    }
  }
}
process.exit(code);
