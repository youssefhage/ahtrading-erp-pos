#!/usr/bin/env python3
"""
Guided onboarding runner for on-prem EDGE + POS device provisioning.

What it does:
1) Generates deploy/edge/.env.edge from safe defaults + your inputs.
2) Starts the EDGE stack (docker compose).
3) Waits for API health.
4) Logs in as admin and registers POS devices per company.
5) Exports ready-to-use POS config packs for each registered device.

This script intentionally does NOT modify your Dokploy/cloud deployment.
"""

from __future__ import annotations

import argparse
import getpass
import json
import re
import secrets
import socket
import string
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


DEFAULT_CLOUD_API_URL = "https://pos.melqard.com/api"


class ApiError(RuntimeError):
    pass


@dataclass
class CompanyPlan:
    company_id: str
    company_name: str
    branch_id: str | None
    branch_name: str | None
    device_count: int


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _rand_secret(length: int = 30) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _truthy(raw: str) -> bool:
    return (raw or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _slug(raw: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (raw or "").strip().lower()).strip("-")
    return s or "company"


def _device_code_prefix(company_name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", company_name).strip("-").upper()
    if not cleaned:
        return "POS"
    return cleaned[:14]


def _ask(
    label: str,
    *,
    default: str | None = None,
    secret: bool = False,
    required: bool = False,
    non_interactive: bool = False,
) -> str:
    if non_interactive:
        if default is not None:
            return default
        if required:
            raise SystemExit(f"Missing required value for non-interactive prompt: {label}")
        return ""

    while True:
        prompt = f"{label}"
        if default is not None:
            prompt += f" [{default}]"
        prompt += ": "
        raw = getpass.getpass(prompt) if secret else input(prompt)
        value = raw.strip()
        if not value and default is not None:
            value = default
        if required and not value:
            print("Value is required.")
            continue
        return value


def _http_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout_s: float = 12.0,
) -> dict[str, Any]:
    body = None
    req_headers = {"Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = Request(url=url, data=body, method=method.upper(), headers=req_headers)
    try:
        with urlopen(req, timeout=timeout_s) as res:  # nosec B310
            raw = res.read().decode("utf-8") if res else ""
            if not raw:
                return {}
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
            return {"data": parsed}
    except HTTPError as ex:
        detail = ""
        try:
            payload_raw = ex.read().decode("utf-8")
            if payload_raw:
                try:
                    parsed = json.loads(payload_raw)
                    if isinstance(parsed, dict):
                        detail = str(parsed.get("detail") or parsed.get("error") or parsed)
                    else:
                        detail = str(parsed)
                except Exception:
                    detail = payload_raw[:300]
        except Exception:
            detail = ""
        raise ApiError(f"HTTP {ex.code} {ex.reason}: {detail}".strip()) from ex
    except URLError as ex:
        raise ApiError(f"Network error calling {url}: {ex}") from ex


def _run(cmd: list[str], *, cwd: Path) -> None:
    subprocess.run(cmd, cwd=str(cwd), check=True)


def _wait_api_healthy(base_url: str, timeout_s: int = 300) -> None:
    health_url = base_url.rstrip("/") + "/health"
    start = time.time()
    last_err = ""
    while (time.time() - start) < timeout_s:
        try:
            res = _http_json("GET", health_url, timeout_s=3.0)
            if str(res.get("status", "")).lower() == "ok":
                return
            last_err = f"health status={res.get('status')}"
        except Exception as ex:  # pragma: no cover (best-effort retry loop)
            last_err = str(ex)
        time.sleep(2)
    raise RuntimeError(f"Edge API did not become healthy in time ({timeout_s}s). Last error: {last_err}")


def _write_env_file(path: Path, values: dict[str, str]) -> None:
    lines = [
        "# Auto-generated by scripts/onboard_onprem_pos.py",
        "# Do not commit this file (contains secrets).",
        "",
        "# Edge service ports",
        f"API_PORT={values['API_PORT']}",
        f"ADMIN_PORT={values['ADMIN_PORT']}",
        "",
        "# Postgres",
        f"POSTGRES_DB={values['POSTGRES_DB']}",
        f"POSTGRES_USER={values['POSTGRES_USER']}",
        f"POSTGRES_PASSWORD={values['POSTGRES_PASSWORD']}",
        "",
        "# App DB role",
        f"APP_DB_USER={values['APP_DB_USER']}",
        f"APP_DB_PASSWORD={values['APP_DB_PASSWORD']}",
        "",
        "# Bootstrap admin (script toggles this off after provisioning)",
        f"BOOTSTRAP_ADMIN={values['BOOTSTRAP_ADMIN']}",
        f"BOOTSTRAP_ADMIN_EMAIL={values['BOOTSTRAP_ADMIN_EMAIL']}",
        f"BOOTSTRAP_ADMIN_PASSWORD={values['BOOTSTRAP_ADMIN_PASSWORD']}",
        f"BOOTSTRAP_ADMIN_RESET_PASSWORD={values['BOOTSTRAP_ADMIN_RESET_PASSWORD']}",
        "",
        "# MinIO / attachments",
        f"MINIO_ROOT_USER={values['MINIO_ROOT_USER']}",
        f"MINIO_ROOT_PASSWORD={values['MINIO_ROOT_PASSWORD']}",
        f"S3_BUCKET={values['S3_BUCKET']}",
        "",
        "# Edge -> cloud sync (optional)",
        f"EDGE_SYNC_TARGET_URL={values['EDGE_SYNC_TARGET_URL']}",
        f"EDGE_SYNC_KEY={values['EDGE_SYNC_KEY']}",
        f"EDGE_SYNC_NODE_ID={values['EDGE_SYNC_NODE_ID']}",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def _read_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def _edge_compose_cmd(repo_root: Path, env_path: Path, *extra: str) -> list[str]:
    return [
        "docker",
        "compose",
        "--env-file",
        str(env_path),
        "-f",
        str(repo_root / "deploy" / "docker-compose.edge.yml"),
        *extra,
    ]


def _api_login(api_base: str, email: str, password: str) -> str:
    res = _http_json("POST", api_base.rstrip("/") + "/auth/login", payload={"email": email, "password": password})
    if res.get("mfa_required"):
        raise RuntimeError("Admin user requires MFA, automation cannot continue. Use a non-MFA bootstrap admin for onboarding.")
    token = str(res.get("token") or "").strip()
    if not token:
        raise RuntimeError("Login succeeded but no token was returned.")
    return token


def _auth_headers(token: str, company_id: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if company_id:
        headers["X-Company-Id"] = company_id
    return headers


def _list_companies(api_base: str, token: str) -> list[dict[str, Any]]:
    res = _http_json("GET", api_base.rstrip("/") + "/companies", headers=_auth_headers(token))
    companies = res.get("companies")
    if not isinstance(companies, list):
        return []
    return [c for c in companies if isinstance(c, dict)]


def _list_branches(api_base: str, token: str, company_id: str) -> list[dict[str, Any]]:
    res = _http_json(
        "GET",
        api_base.rstrip("/") + "/branches",
        headers=_auth_headers(token, company_id),
    )
    branches = res.get("branches")
    if not isinstance(branches, list):
        return []
    return [b for b in branches if isinstance(b, dict)]


def _register_device(
    api_base: str,
    token: str,
    *,
    company_id: str,
    branch_id: str | None,
    device_code: str,
) -> dict[str, str]:
    query = {
        "company_id": company_id,
        "device_code": device_code,
        "reset_token": "true",
    }
    if branch_id:
        query["branch_id"] = branch_id
    url = api_base.rstrip("/") + "/pos/devices/register?" + urlencode(query, quote_via=quote)
    res = _http_json("POST", url, headers=_auth_headers(token, company_id), payload={})
    device_id = str(res.get("id") or "").strip()
    device_token = str(res.get("token") or "").strip()
    if not device_id or not device_token:
        raise RuntimeError(f"Failed to register device {device_code} for company {company_id}")
    return {"device_id": device_id, "device_token": device_token}


def _choose_plans(
    *,
    companies: list[dict[str, Any]],
    api_base: str,
    token: str,
    requested_company_ids: set[str],
    default_device_count: int,
    interactive: bool,
) -> list[CompanyPlan]:
    plans: list[CompanyPlan] = []
    for c in companies:
        company_id = str(c.get("id") or "").strip()
        company_name = str(c.get("name") or company_id).strip()
        if not company_id:
            continue
        if requested_company_ids and company_id not in requested_company_ids:
            continue

        include = True
        if interactive:
            answer = _ask(f"Include company '{company_name}'", default="y")
            include = _truthy(answer)
        if not include:
            continue

        branches = _list_branches(api_base, token, company_id)
        branch_id = None
        branch_name = None
        if branches:
            selected_idx = 0
            if interactive and len(branches) > 1:
                print(f"Branches for {company_name}:")
                for i, b in enumerate(branches, start=1):
                    b_name = str(b.get("name") or b.get("id") or "").strip()
                    print(f"  {i}. {b_name}")
                raw_idx = _ask("Select branch number", default="1")
                try:
                    selected_idx = max(0, min(len(branches) - 1, int(raw_idx) - 1))
                except Exception:
                    selected_idx = 0
            selected_branch = branches[selected_idx]
            branch_id = str(selected_branch.get("id") or "").strip() or None
            branch_name = str(selected_branch.get("name") or branch_id or "").strip() or None

        count = default_device_count
        if interactive:
            raw_count = _ask(f"How many POS devices for '{company_name}'", default=str(default_device_count))
            try:
                count = int(raw_count)
            except Exception:
                count = default_device_count
        if count < 1:
            count = 1

        plans.append(
            CompanyPlan(
                company_id=company_id,
                company_name=company_name,
                branch_id=branch_id,
                branch_name=branch_name,
                device_count=count,
            )
        )
    return plans


def _tauri_prefill(devices: list[dict[str, Any]], edge_api_url_for_pos: str) -> dict[str, Any]:
    def pick(kind: str) -> dict[str, Any] | None:
        kind_lower = kind.lower()
        for d in devices:
            name = str(d.get("company_name") or "").lower()
            # Guard against "unofficial" accidentally matching "official".
            if kind_lower == "official":
                if "official" in name and "unofficial" not in name:
                    return d
                continue
            if kind_lower in name:
                return d
        return None

    official = pick("official")
    unofficial = pick("unofficial")
    if official is None and devices:
        official = devices[0]
    if unofficial is None and len(devices) > 1:
        unofficial = devices[1]
    if unofficial is None:
        unofficial = official

    return {
        "edgeUrl": edge_api_url_for_pos,
        "portOfficial": 7070,
        "portUnofficial": 7072,
        "companyOfficial": official.get("company_id") if official else "",
        "companyUnofficial": unofficial.get("company_id") if unofficial else "",
        "deviceIdOfficial": official.get("device_id") if official else "",
        "deviceTokenOfficial": official.get("device_token") if official else "",
        "deviceIdUnofficial": unofficial.get("device_id") if unofficial else "",
        "deviceTokenUnofficial": unofficial.get("device_token") if unofficial else "",
    }


def _write_output_bundle(
    out_dir: Path,
    *,
    edge_api_url_for_pos: str,
    plans: list[CompanyPlan],
    devices: list[dict[str, Any]],
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    packs_dir = out_dir / "pos-device-packs"
    packs_dir.mkdir(parents=True, exist_ok=True)

    for d in devices:
        company_slug = _slug(str(d["company_name"]))
        device_code = str(d["device_code"])
        filename = f"{company_slug}__{_slug(device_code)}.json"
        payload = {
            "api_base_url": edge_api_url_for_pos,
            "company_id": d["company_id"],
            "branch_id": d["branch_id"] or "",
            "device_code": device_code,
            "device_id": d["device_id"],
            "device_token": d["device_token"],
            "shift_id": "",
        }
        (packs_dir / filename).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    summary = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "edge_api_url_for_pos": edge_api_url_for_pos,
        "companies": [
            {
                "company_id": p.company_id,
                "company_name": p.company_name,
                "branch_id": p.branch_id,
                "branch_name": p.branch_name,
                "device_count": p.device_count,
            }
            for p in plans
        ],
        "devices": devices,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (out_dir / "tauri-launcher-prefill.json").write_text(
        json.dumps(_tauri_prefill(devices, edge_api_url_for_pos), indent=2), encoding="utf-8"
    )

    readme = f"""On-Prem POS Onboarding Bundle
Generated: {summary['generated_at']}

Files:
- pos-device-packs/*.json
  - Use each file as a ready config for Python POS agent (config.json).
- tauri-launcher-prefill.json
  - Copy these values into the POS Desktop launcher advanced fields.
- summary.json
  - Full onboarding summary.

Security note:
- Device tokens are sensitive secrets. Keep this folder private.
- Rotate token from Admin -> System -> POS Devices if exposed.
"""
    (out_dir / "README.txt").write_text(readme, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Automate on-prem EDGE + POS onboarding without touching cloud Dokploy.",
    )
    parser.add_argument("--non-interactive", action="store_true", help="Do not prompt for input.")
    parser.add_argument("--force", action="store_true", help="Overwrite deploy/edge/.env.edge without confirmation.")
    parser.add_argument(
        "--update-env",
        action="store_true",
        help="Update deploy/edge/.env.edge in-place (ports/sync/bootstrap). Default is to reuse existing env unchanged.",
    )
    parser.add_argument("--skip-start", action="store_true", help="Do not start or restart EDGE compose stack.")
    parser.add_argument("--skip-devices", action="store_true", help="Skip POS device registration and pack export.")
    parser.add_argument(
        "--api-base-url",
        default="",
        help="Override Edge API base URL for onboarding calls (health/login/register). "
        "Useful when registering devices against a remote Edge server. Example: http://192.168.1.50:8001",
    )
    parser.add_argument("--api-port", type=int, default=None, help="Edge API port on the on-prem server.")
    parser.add_argument("--admin-port", type=int, default=None, help="Edge admin UI port on the on-prem server.")
    parser.add_argument(
        "--edge-api-url-for-pos",
        default="",
        help="URL POS terminals should use (example: http://192.168.1.50:8001).",
    )
    parser.add_argument("--cloud-api-url", default=DEFAULT_CLOUD_API_URL, help="Cloud API URL for edge->cloud sync.")
    parser.add_argument("--edge-sync-key", default="", help="Shared secret for edge->cloud sync.")
    parser.add_argument("--edge-node-id", default="", help="Unique edge node id (store identifier).")
    parser.add_argument("--admin-email", default=None, help="Bootstrap admin email for edge.")
    parser.add_argument("--admin-password", default=None, help="Bootstrap admin password for edge.")
    parser.add_argument("--device-count", type=int, default=1, help="Default number of devices to register per company.")
    parser.add_argument("--companies", nargs="*", default=[], help="Optional list of company IDs to onboard.")
    args = parser.parse_args()

    repo_root = _repo_root()
    env_path = repo_root / "deploy" / "edge" / ".env.edge"
    onboarding_root = repo_root / "deploy" / "edge" / "onboarding"

    print("== On-Prem + POS Onboarding ==")
    print("This flow only manages local on-prem EDGE and POS setup.")

    existing_env = _read_env_file(env_path)
    non_interactive = bool(args.non_interactive)
    env_exists = env_path.exists()
    should_write_env = (not env_exists) or bool(args.force) or bool(args.update_env)
    if env_exists and not should_write_env and not non_interactive:
        print(f"Found existing {env_path}. Reusing it (no changes will be written).")

    api_port = args.api_port if args.api_port is not None else int(existing_env.get("API_PORT") or "8001")
    admin_port = args.admin_port if args.admin_port is not None else int(existing_env.get("ADMIN_PORT") or "3000")

    edge_api_url_for_pos = (args.edge_api_url_for_pos or "").strip()
    if not edge_api_url_for_pos:
        default_url = f"http://127.0.0.1:{api_port}"
        edge_api_url_for_pos = _ask(
            "POS Edge API URL (LAN address that cashiers will use)",
            default=default_url,
            non_interactive=non_interactive,
        )
    edge_api_url_for_pos = edge_api_url_for_pos.rstrip("/")

    cloud_api_url = (args.cloud_api_url or existing_env.get("EDGE_SYNC_TARGET_URL") or "").strip().rstrip("/")
    edge_sync_key = (args.edge_sync_key or "").strip()
    if not edge_sync_key:
        edge_sync_key = (existing_env.get("EDGE_SYNC_KEY") or "").strip()
    sync_enabled = bool(cloud_api_url and edge_sync_key)
    if not sync_enabled and not non_interactive:
        enable_sync = _ask("Enable edge->cloud sync now", default="y")
        sync_enabled = _truthy(enable_sync)
        if sync_enabled:
            cloud_api_url = _ask("Cloud API URL", default=cloud_api_url or DEFAULT_CLOUD_API_URL)
            edge_sync_key = _ask("EDGE_SYNC_KEY (must match cloud EDGE_SYNC_KEY)", required=True, secret=True)

    admin_email = (args.admin_email or existing_env.get("BOOTSTRAP_ADMIN_EMAIL") or "admin@ahtrading.local").strip()
    admin_password = (args.admin_password or "").strip()
    if not admin_password:
        admin_password = (existing_env.get("BOOTSTRAP_ADMIN_PASSWORD") or "").strip()
    generated_admin_password = False
    if not admin_password:
        if non_interactive:
            admin_password = _rand_secret(20)
            generated_admin_password = True
        else:
            maybe_pw = _ask("Bootstrap admin password (leave blank to auto-generate)")
            if maybe_pw:
                admin_password = maybe_pw
            else:
                admin_password = _rand_secret(20)
                generated_admin_password = True

    edge_node_id = (args.edge_node_id or existing_env.get("EDGE_SYNC_NODE_ID") or "").strip() or socket.gethostname()
    pg_password = (existing_env.get("POSTGRES_PASSWORD") or "").strip() or _rand_secret(24)
    app_password = (existing_env.get("APP_DB_PASSWORD") or "").strip() or _rand_secret(24)
    minio_password = (existing_env.get("MINIO_ROOT_PASSWORD") or "").strip() or _rand_secret(24)

    env_values = {
        "API_PORT": str(api_port),
        "ADMIN_PORT": str(admin_port),
        "POSTGRES_DB": (existing_env.get("POSTGRES_DB") or "ahtrading").strip(),
        "POSTGRES_USER": (existing_env.get("POSTGRES_USER") or "ahtrading").strip(),
        "POSTGRES_PASSWORD": pg_password,
        "APP_DB_USER": (existing_env.get("APP_DB_USER") or "ahapp").strip(),
        "APP_DB_PASSWORD": app_password,
        # Only force bootstrap on fresh installs or explicit update runs.
        "BOOTSTRAP_ADMIN": "1" if should_write_env else (existing_env.get("BOOTSTRAP_ADMIN") or "0").strip() or "0",
        "BOOTSTRAP_ADMIN_EMAIL": admin_email,
        "BOOTSTRAP_ADMIN_PASSWORD": admin_password,
        "BOOTSTRAP_ADMIN_RESET_PASSWORD": "1" if should_write_env else (existing_env.get("BOOTSTRAP_ADMIN_RESET_PASSWORD") or "0").strip() or "0",
        "MINIO_ROOT_USER": (existing_env.get("MINIO_ROOT_USER") or "minioadmin").strip(),
        "MINIO_ROOT_PASSWORD": minio_password,
        "S3_BUCKET": (existing_env.get("S3_BUCKET") or "attachments").strip(),
        "EDGE_SYNC_TARGET_URL": cloud_api_url if sync_enabled else "",
        "EDGE_SYNC_KEY": edge_sync_key if sync_enabled else "",
        "EDGE_SYNC_NODE_ID": edge_node_id,
    }

    if should_write_env:
        _write_env_file(env_path, env_values)
        print(f"Wrote {env_path}")
    else:
        print("Env reuse mode: not writing .env.edge.")

    if not args.skip_start:
        print("Starting EDGE stack...")
        _run(_edge_compose_cmd(repo_root, env_path, "up", "-d", "--build"), cwd=repo_root)
    else:
        print("Skipping EDGE start (--skip-start).")

    api_base = (args.api_base_url or "").strip().rstrip("/")
    if not api_base:
        api_base = f"http://127.0.0.1:{api_port}"
    print(f"Waiting for EDGE API health at {api_base}/health ...")
    _wait_api_healthy(api_base)
    print("EDGE API is healthy.")

    devices: list[dict[str, Any]] = []
    plans: list[CompanyPlan] = []

    if not args.skip_devices:
        print("Authenticating admin...")
        token = _api_login(api_base, admin_email, admin_password)
        companies = _list_companies(api_base, token)
        if not companies:
            raise RuntimeError("No companies available for this admin user. Cannot provision POS devices.")

        requested_ids = {c.strip() for c in args.companies if c.strip()}
        plans = _choose_plans(
            companies=companies,
            api_base=api_base,
            token=token,
            requested_company_ids=requested_ids,
            default_device_count=max(1, args.device_count),
            interactive=not non_interactive,
        )
        if not plans:
            raise RuntimeError("No companies selected for device onboarding.")

        for plan in plans:
            prefix = _device_code_prefix(plan.company_name)
            print(f"Registering devices for {plan.company_name} ({plan.company_id}) ...")
            for i in range(1, plan.device_count + 1):
                code = f"{prefix}-POS-{i:02d}"
                reg = _register_device(
                    api_base,
                    token,
                    company_id=plan.company_id,
                    branch_id=plan.branch_id,
                    device_code=code,
                )
                devices.append(
                    {
                        "company_id": plan.company_id,
                        "company_name": plan.company_name,
                        "branch_id": plan.branch_id,
                        "branch_name": plan.branch_name,
                        "device_code": code,
                        "device_id": reg["device_id"],
                        "device_token": reg["device_token"],
                    }
                )
                print(f"  - {code} registered")
    else:
        print("Skipping POS device registration (--skip-devices).")

    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    out_dir = onboarding_root / timestamp
    if devices:
        _write_output_bundle(out_dir, edge_api_url_for_pos=edge_api_url_for_pos, plans=plans, devices=devices)
        print(f"Exported onboarding bundle to: {out_dir}")

    # Harden future restarts only for fresh installs / explicit env update runs.
    if should_write_env:
        env_values["BOOTSTRAP_ADMIN"] = "0"
        env_values["BOOTSTRAP_ADMIN_RESET_PASSWORD"] = "0"
        _write_env_file(env_path, env_values)
        print("Updated .env.edge to disable bootstrap reset on future restarts.")

        if not args.skip_start:
            print("Applying final hardened env (quick compose refresh)...")
            _run(_edge_compose_cmd(repo_root, env_path, "up", "-d"), cwd=repo_root)

    print("")
    print("Onboarding complete.")
    print(f"- Edge API URL for POS: {edge_api_url_for_pos}")
    if sync_enabled:
        print(f"- Edge->Cloud sync target: {cloud_api_url}")
    else:
        print("- Edge->Cloud sync: disabled")
    if generated_admin_password:
        print("- Bootstrap admin password was auto-generated for this run:")
        print(f"  {admin_password}")
    if devices:
        print(f"- POS devices provisioned: {len(devices)}")
        print(f"- Device packs: {out_dir}")
    print("")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
