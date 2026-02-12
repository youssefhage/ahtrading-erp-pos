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
const specPath = join(repoRoot, "pos-desktop", "packaging", "pos_agent.spec");

function sidecarExists() {
  return existsSync(unixBinary) || existsSync(windowsBinary);
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  return (res.status ?? 1) === 0;
}

function buildWithPython() {
  const pythonCandidates =
    process.platform === "win32"
      ? [
          ["py", "-3"],
          ["python"],
          ["python3"],
        ]
      : [["python3"], ["python"]];

  for (const candidate of pythonCandidates) {
    const [bin, ...prefix] = candidate;
    console.log(`[pos-desktop] trying sidecar build with ${candidate.join(" ")}...`);
    const pipOk = run(bin, [
      ...prefix,
      "-m",
      "pip",
      "install",
      "--upgrade",
      "pip",
      "pyinstaller",
      "bcrypt",
    ]);
    if (!pipOk) continue;
    const pyiOk = run(bin, [...prefix, "-m", "PyInstaller", "--noconfirm", specPath]);
    if (pyiOk) return true;
  }
  return false;
}

if (!sidecarExists()) {
  let built = false;
  if (process.platform !== "win32") {
    const builder = join(repoRoot, "pos-desktop", "packaging", "build_pos_agent.sh");
    if (existsSync(builder)) {
      console.log("[pos-desktop] building POS sidecar with PyInstaller...");
      built = run("bash", [builder]);
    }
  }

  if (!built && !sidecarExists()) {
    built = buildWithPython();
  }

  if (!built && !sidecarExists()) {
    console.error("[pos-desktop] failed to build POS sidecar automatically.");
    process.exit(1);
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
