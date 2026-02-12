#!/usr/bin/env python3
"""
Unified installer launcher for on-prem + POS setup.

This provides an installer-like UX:
- Full (On-Prem + POS)
- On-Prem only
- POS only

Under the hood it delegates to onboard_onprem_pos.py with safe flags.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _runner_path() -> Path:
    return _repo_root() / "scripts" / "onboard_onprem_pos.py"


def _run_runner(mode: str, extra_args: list[str]) -> int:
    runner = _runner_path()
    if not runner.exists():
        print(f"Missing runner: {runner}", file=sys.stderr)
        return 2

    cmd = [sys.executable, str(runner)]
    if mode == "onprem":
        cmd.append("--skip-devices")
    elif mode == "pos":
        cmd.append("--skip-start")
    elif mode == "full":
        pass
    else:
        print(f"Unknown mode: {mode}", file=sys.stderr)
        return 2

    cmd.extend(extra_args)
    print(f"\nRunning: {' '.join(cmd)}\n")
    proc = subprocess.run(cmd, cwd=str(_repo_root()))
    return int(proc.returncode)


def _run_helper_script(rel_path: str) -> int:
    script = _repo_root() / rel_path
    if not script.exists():
        print(f"Missing helper script: {script}", file=sys.stderr)
        return 2
    proc = subprocess.run(["bash", str(script)], cwd=str(_repo_root()))
    return int(proc.returncode)


def _menu() -> str:
    print("")
    print("Melqard Installer")
    print("1) Hybrid setup (On-Prem + POS) [Recommended]")
    print("2) On-Prem only (local server)")
    print("3) POS only (register devices + export packs)")
    print("4) Edge status")
    print("5) Edge start")
    print("6) Exit")
    print("")
    raw = input("Select option [1-6]: ").strip()
    return raw


def main() -> int:
    parser = argparse.ArgumentParser(description="Installer launcher for on-prem + POS setup.")
    parser.add_argument(
        "mode",
        nargs="?",
        choices=["menu", "full", "onprem", "pos", "status", "start"],
        default="menu",
        help="Installer mode. Default: menu",
    )
    parser.add_argument(
        "extra",
        nargs=argparse.REMAINDER,
        help="Extra args passed to onboard_onprem_pos.py (for full/onprem/pos modes).",
    )
    args = parser.parse_args()

    mode = args.mode
    extra = list(args.extra or [])
    if extra and extra[0] == "--":
        extra = extra[1:]

    if mode == "menu":
        choice = _menu()
        if choice == "1":
            return _run_runner("full", [])
        if choice == "2":
            return _run_runner("onprem", [])
        if choice == "3":
            return _run_runner("pos", [])
        if choice == "4":
            return _run_helper_script("deploy/edge/status.sh")
        if choice == "5":
            return _run_helper_script("deploy/edge/start.sh")
        return 0

    if mode == "status":
        return _run_helper_script("deploy/edge/status.sh")
    if mode == "start":
        return _run_helper_script("deploy/edge/start.sh")
    if mode in {"full", "onprem", "pos"}:
        return _run_runner(mode, extra)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
