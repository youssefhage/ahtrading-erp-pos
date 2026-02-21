#!/usr/bin/env python3
"""
Build a lightweight "Setup Runner" zip for Windows/macOS.

This pack contains:
- onboard_onprem_pos.py (the guided runner)
- docker-compose.edge.images.yml (pulls prebuilt local-node images)
- .env.edge.example
- convenience launchers for Windows/macOS
"""

from __future__ import annotations

import argparse
import textwrap
import zipfile
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="", help="Output zip path. Default: dist/setup-runner/MelqardSetupRunner-latest.zip")
    ap.add_argument("--version", default="0.0.3", help="Displayed version string (UI only).")
    args = ap.parse_args()

    root = _repo_root()
    out = Path(args.out).expanduser().resolve() if args.out else (root / "dist" / "setup-runner" / "MelqardSetupRunner-latest.zip").resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    runner = (root / "scripts" / "onboard_onprem_pos.py").resolve()
    compose = (root / "deploy" / "edge" / "docker-compose.edge.images.yml").resolve()
    env_example = (root / "deploy" / "edge" / ".env.edge.example").resolve()

    missing = [p for p in [runner, compose, env_example] if not p.exists()]
    if missing:
        raise SystemExit(f"Missing required files: {', '.join(str(p) for p in missing)}")

    readme = textwrap.dedent(
        f"""\
        Melqard Setup Runner (v{args.version})

        This package provisions the on-prem local server and exports POS device packs.

        Requirements (install once on the server machine):
        - Docker Desktop (Windows/macOS)
        - Windows: no Python install needed (the launcher downloads a portable Python automatically)
        - macOS: Python 3 is recommended (Homebrew: `brew install python`)

        Quick Start
        1) Extract this zip into a folder (e.g. C:\\MelqardSetup or ~/MelqardSetup).
        2) Run:
           - Windows (PowerShell):   .\\run_setup.ps1
           - macOS (Terminal):      ./run_setup.sh

        Notes
        - The runner writes .env.edge and onboarding output into this same folder.
        - It uses docker-compose.edge.images.yml (pulls prebuilt images).
        - Keep generated device packs private (they contain device tokens).
        """
    ).strip() + "\n"

    run_setup_sh = textwrap.dedent(
        """\
        #!/usr/bin/env bash
        set -euo pipefail
        cd "$(dirname "${BASH_SOURCE[0]}")"
        python3 onboard_onprem_pos.py --compose-mode images --edge-home .
        """
    ).strip() + "\n"

    run_setup_ps1 = textwrap.dedent(
        """\
        $ErrorActionPreference = "Stop"
        $here = Split-Path -Parent $MyInvocation.MyCommand.Path
        Set-Location $here

        function Run-Py([string]$cmd, [string[]]$args) {
          & $cmd @args
          exit $LASTEXITCODE
        }

        # Prefer Windows Python Launcher (py), then python, then python3.
        if (Get-Command py -ErrorAction SilentlyContinue) {
          Run-Py "py" @("-3", ".\\onboard_onprem_pos.py", "--compose-mode", "images", "--edge-home", ".")
        }

        # Some Windows builds ship a "python" app execution alias that opens the Microsoft Store.
        # Verify python really runs before using it.
        if (Get-Command python -ErrorAction SilentlyContinue) {
          $ver = & python --version 2>&1
          if ($LASTEXITCODE -eq 0 -and ($ver -match "^Python\\s+3\\.")) {
            Run-Py "python" @(".\\onboard_onprem_pos.py", "--compose-mode", "images", "--edge-home", ".")
          }
        }

        if (Get-Command python3 -ErrorAction SilentlyContinue) {
          $ver = & python3 --version 2>&1
          if ($LASTEXITCODE -eq 0 -and ($ver -match "^Python\\s+3\\.")) {
            Run-Py "python3" @(".\\onboard_onprem_pos.py", "--compose-mode", "images", "--edge-home", ".")
          }
        }

        # No Python found: download a portable (embeddable) Python into this folder and run it.
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

        $pyVersion = "3.11.8"
        $pyUrl = "https://www.python.org/ftp/python/$pyVersion/python-$pyVersion-embed-amd64.zip"
        $pyDir = Join-Path $here ".python"
        $pyExe = Join-Path $pyDir "python.exe"
        $zipPath = Join-Path $here ".python-embed.zip"

        if (-not (Test-Path $pyExe)) {
          Write-Host "Python not found. Downloading portable Python $pyVersion..." -ForegroundColor Yellow
          Invoke-WebRequest -Uri $pyUrl -OutFile $zipPath
          if (Test-Path $pyDir) { Remove-Item $pyDir -Recurse -Force }
          New-Item -ItemType Directory -Path $pyDir | Out-Null
          Expand-Archive -Path $zipPath -DestinationPath $pyDir -Force
          Remove-Item $zipPath -Force
        }

        if (-not (Test-Path $pyExe)) {
          Write-Error "Portable Python download failed. Please install Python 3 and retry."
          exit 2
        }

        Run-Py $pyExe @(".\\onboard_onprem_pos.py", "--compose-mode", "images", "--edge-home", ".")
        """
    ).strip() + "\n"

    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.write(runner, arcname="onboard_onprem_pos.py")
        z.write(compose, arcname="docker-compose.edge.images.yml")
        z.write(env_example, arcname=".env.edge.example")
        z.writestr("README.txt", readme)
        z.writestr("run_setup.sh", run_setup_sh)
        z.writestr("run_setup.ps1", run_setup_ps1)

    print(str(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
