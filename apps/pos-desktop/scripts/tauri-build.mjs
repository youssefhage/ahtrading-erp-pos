import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const thisDir = dirname(fileURLToPath(import.meta.url));
const appRoot = join(thisDir, "..");
const tauriConfigPath = join(appRoot, "src-tauri", "tauri.conf.json");
const tmpConfigPath = join(appRoot, "src-tauri", "tauri.conf.nosign.generated.json");
const passthroughArgs = process.argv.slice(2);

function runBuild(args) {
  const res = spawnSync("npx", ["tauri", "build", ...args], {
    cwd: appRoot,
    stdio: "inherit",
    env: process.env,
  });
  return res.status ?? 1;
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
