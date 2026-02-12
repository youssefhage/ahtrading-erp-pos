#!/usr/bin/env python3
"""Heuristic audit of FastAPI router endpoints for missing auth/permission guards.

This is intentionally conservative: it reports potential issues for manual review.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

RE_DECORATOR = re.compile(r"^\s*@router\.(get|post|put|patch|delete)\(\s*([\"\'])(.*?)\2")
RE_DEP_REQUIRE_PERMISSION = re.compile(r"dependencies\s*=\s*\[\s*Depends\(\s*require_permission\(")
RE_REQUIRE_PERMISSION_CALL = re.compile(r"\brequire_permission\(")
RE_DEP_REQUIRE_DEVICE = re.compile(r"Depends\(\s*require_device\s*\)")
RE_DEP_REQUIRE_COMPANY_ACCESS = re.compile(r"Depends\(\s*require_company_access\s*\)")
RE_DEP_GET_SESSION = re.compile(r"Depends\(\s*get_session\s*\)")
RE_DEP_GET_CURRENT_USER = re.compile(r"Depends\(\s*get_current_user\s*\)")
RE_FUNC_DEF = re.compile(r"^\s*def\s+([a-zA-Z0-9_]+)\s*\(")

def _router_has_auth_guard(lines: list[str]) -> bool:
    head = "\n".join(lines[:160])
    return "dependencies=[Depends(get_current_user)]" in head or "dependencies = [Depends(get_current_user)]" in head

# Router files where public endpoints are expected.
PUBLIC_ROUTER_FILES = {
    "auth.py",      # login/MFA endpoints etc.
    "updates.py",   # download endpoints intentionally public
}

# Endpoints that are explicitly secret-gated (acceptable without require_permission)
SECRET_GATED_HINTS = [
    "X-Updates-Key",
    "X-Telegram-Bot-Api-Secret-Token",
    "X-Edge-Sync-Key",
    "EDGE_SYNC_KEY",
    "WEBHOOK_SECRET",
]

@dataclass
class Finding:
    file: Path
    line: int
    method: str
    path: str
    handler: str | None
    reason: str


def _read_lines(p: Path) -> list[str]:
    try:
        return p.read_text(encoding="utf-8").splitlines()
    except Exception:
        return []


def audit_file(p: Path) -> list[Finding]:
    lines = _read_lines(p)
    out: list[Finding] = []
    router_guarded = False
    try:
        router_guarded = _router_has_auth_guard(lines)
    except Exception:
        router_guarded = False

    i = 0
    while i < len(lines):
        m = RE_DECORATOR.match(lines[i])
        if not m:
            i += 1
            continue

        method = m.group(1).upper()
        route_path = m.group(3)
        dec_line = i

        # Scan decorator block + next ~40 lines for handler + dependency hints.
        block = "\n".join(lines[i : min(len(lines), i + 45)])

        handler = None
        for j in range(i + 1, min(len(lines), i + 20)):
            fm = RE_FUNC_DEF.match(lines[j])
            if fm:
                handler = fm.group(1)
                break

        guarded = False
        guard_reasons: list[str] = []

        if router_guarded:
            guarded = True
            guard_reasons.append("router:get_current_user")
        if RE_DEP_REQUIRE_PERMISSION.search(block):
            guarded = True
            guard_reasons.append("require_permission")
        if RE_REQUIRE_PERMISSION_CALL.search(block):
            guarded = True
            guard_reasons.append("require_permission(call)")
        if RE_DEP_REQUIRE_DEVICE.search(block):
            guarded = True
            guard_reasons.append("require_device")
        if RE_DEP_REQUIRE_COMPANY_ACCESS.search(block):
            guarded = True
            guard_reasons.append("require_company_access")
        if RE_DEP_GET_SESSION.search(block):
            # Session dependency isn't permission gating, but at least enforces auth.
            guarded = True
            guard_reasons.append("get_session")
        if RE_DEP_GET_CURRENT_USER.search(block):
            guarded = True
            guard_reasons.append("get_current_user")

        # Some routers are expected to have public endpoints.
        if p.name in PUBLIC_ROUTER_FILES:
            i += 1
            continue

        # If not guarded, check if it's probably secret-gated (webhooks etc.).
        if not guarded:
            if any(h in block for h in SECRET_GATED_HINTS):
                out.append(
                    Finding(
                        file=p,
                        line=dec_line + 1,
                        method=method,
                        path=route_path,
                        handler=handler,
                        reason="No require_permission/device/session dependency detected (looks secret-gated; please confirm)",
                    )
                )
            else:
                out.append(
                    Finding(
                        file=p,
                        line=dec_line + 1,
                        method=method,
                        path=route_path,
                        handler=handler,
                        reason="No require_permission/device/session dependency detected",
                    )
                )

        i += 1

    return out


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    routers = root / "backend" / "app" / "routers"
    findings: list[Finding] = []

    for p in sorted(routers.glob("*.py")):
        findings.extend(audit_file(p))

    if not findings:
        print("No findings.")
        return 0

    for f in findings:
        h = f.handler or "(unknown)"
        rel = f.file.relative_to(root)
        print(f"{rel}:{f.line}: {f.method} {f.path} -> {h}: {f.reason}")

    print(f"\nTotal potential unguarded endpoints (excluding allowlisted router files): {len(findings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
