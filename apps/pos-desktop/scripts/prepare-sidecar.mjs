import { existsSync, mkdirSync, copyFileSync, unlinkSync } from "node:fs";
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
const agentUiDist = join(repoRoot, "pos-desktop", "ui", "dist");

function sidecarExists() {
  return existsSync(unixBinary) || existsSync(windowsBinary);
}

function requiredSidecarExists() {
  return process.platform === "win32" ? existsSync(windowsBinary) : existsSync(unixBinary);
}

function requiredSidecarPath() {
  return process.platform === "win32" ? windowsBinary : unixBinary;
}

function run(cmd, args, { cwd = repoRoot } = {}) {
  const useWindowsShell = process.platform === "win32" && (cmd === "npm" || cmd === "npx");
  const resolvedCmd = useWindowsShell ? cmd : cmd;
  const res = spawnSync(resolvedCmd, args, {
    cwd,
    stdio: "inherit",
    shell: useWindowsShell,
  });
  if (res.error) {
    console.error(`[pos-desktop] failed to start command (${resolvedCmd}): ${res.error.message}`);
  }
  return (res.status ?? 1) === 0;
}

function ensureAgentUiBuilt() {
  // The PyInstaller spec bundles `pos-desktop/ui/dist`. On fresh CI checkouts
  // (especially Windows), this folder won't exist unless we build it.
  if (existsSync(join(agentUiDist, "index.html"))) return true;

  const uiDir = join(repoRoot, "pos-desktop", "ui");
  if (!existsSync(join(uiDir, "package.json"))) return true; // unexpected, but don't block

  // Best-effort: build the UI if npm exists. If it fails, PyInstaller will
  // still fail unless the spec file handles missing UI dist.
  console.log("[pos-desktop] building sidecar UI (pos-desktop/ui)...");
  const ciOk = run("npm", ["ci"], { cwd: uiDir });
  if (!ciOk) return false;
  const buildOk = run("npm", ["run", "build"], { cwd: uiDir });
  return buildOk;
}

function buildWithPython() {
  // Ensure UI dist exists before running PyInstaller (Windows CI doesn't run the bash builder).
  ensureAgentUiBuilt();

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

if (!requiredSidecarExists()) {
  let built = false;
  if (process.platform !== "win32") {
    const builder = join(repoRoot, "pos-desktop", "packaging", "build_pos_agent.sh");
    if (existsSync(builder)) {
      console.log("[pos-desktop] building POS sidecar with PyInstaller...");
      built = run("bash", [builder]);
    }
  }

  if (!built && !requiredSidecarExists()) {
    built = buildWithPython();
  }

  if (!built && !requiredSidecarExists()) {
    console.error("[pos-desktop] failed to build POS sidecar automatically.");
    process.exit(1);
  }
}

if (!requiredSidecarExists()) {
  console.error("[pos-desktop] missing sidecar binary.");
  console.error(`[pos-desktop] expected: ${requiredSidecarPath()}`);
  if (process.platform === "win32") {
    console.error("[pos-desktop] run this build on Windows so PyInstaller can emit pos-agent.exe.");
  } else {
    console.error("[pos-desktop] on macOS/Linux run: ./pos-desktop/packaging/build_pos_agent.sh");
  }
  process.exit(1);
}

mkdirSync(targetBinDir, { recursive: true });
for (const stale of [join(targetBinDir, "pos-agent"), join(targetBinDir, "pos-agent.exe")]) {
  if (existsSync(stale)) {
    try {
      unlinkSync(stale);
    } catch {
      // Ignore stale cleanup errors.
    }
  }
}

if (process.platform === "win32") {
  copyFileSync(windowsBinary, join(targetBinDir, "pos-agent.exe"));
  console.log("[pos-desktop] copied sidecar: pos-agent.exe");
} else {
  copyFileSync(unixBinary, join(targetBinDir, "pos-agent"));
  console.log("[pos-desktop] copied sidecar: pos-agent");
}
