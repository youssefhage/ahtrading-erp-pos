import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(thisDir, "..", "..", "..");
const distDir = join(repoRoot, "dist");
const targetBinDir = join(repoRoot, "apps", "pos-desktop", "src-tauri", "bin");

const unixBinary = join(distDir, "pos-agent");
const windowsBinary = join(distDir, "pos-agent.exe");

function sidecarExists() {
  return existsSync(unixBinary) || existsSync(windowsBinary);
}

if (!sidecarExists() && process.platform !== "win32") {
  const builder = join(repoRoot, "pos-desktop", "packaging", "build_pos_agent.sh");
  if (existsSync(builder)) {
    console.log("[pos-desktop] building POS sidecar with PyInstaller...");
    const run = spawnSync("bash", [builder], { stdio: "inherit" });
    if (run.status !== 0) {
      process.exit(run.status ?? 1);
    }
  }
}

if (!sidecarExists()) {
  console.error("[pos-desktop] missing sidecar binary.");
  console.error("[pos-desktop] expected one of:");
  console.error(`  - ${unixBinary}`);
  console.error(`  - ${windowsBinary}`);
  console.error(
    "[pos-desktop] on macOS/Linux run: ./pos-desktop/packaging/build_pos_agent.sh"
  );
  process.exit(1);
}

mkdirSync(targetBinDir, { recursive: true });
if (existsSync(unixBinary)) {
  copyFileSync(unixBinary, join(targetBinDir, "pos-agent"));
  console.log("[pos-desktop] copied sidecar: pos-agent");
}
if (existsSync(windowsBinary)) {
  copyFileSync(windowsBinary, join(targetBinDir, "pos-agent.exe"));
  console.log("[pos-desktop] copied sidecar: pos-agent.exe");
}
