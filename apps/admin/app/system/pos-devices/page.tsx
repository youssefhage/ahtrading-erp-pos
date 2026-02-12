"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiDelete, apiGet, apiPost, getCompanyId } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { SearchableSelect } from "@/components/searchable-select";
import { ConfirmButton } from "@/components/confirm-button";
import { Page, PageHeader, Section } from "@/components/page";

type DeviceRow = {
  id: string;
  branch_id: string | null;
  device_code: string;
  created_at: string;
  has_token: boolean;
};

type BranchRow = {
  id: string;
  name: string;
  address: string | null;
};

type DeviceSetup = {
  company_id: string;
  branch_id: string | null;
  branch_name: string | null;
  device_code: string;
  device_id: string;
  device_token: string | null;
  shift_id: string;
};

function inferDefaultApiBaseUrl(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin.replace(/\/+$/, "")}/api`;
}

function buildPosConfigPayload(setup: DeviceSetup, apiBaseUrl: string) {
  return {
    api_base_url: apiBaseUrl.trim(),
    company_id: setup.company_id,
    branch_id: setup.branch_id || "",
    device_code: setup.device_code,
    device_id: setup.device_id,
    device_token: setup.device_token || "",
    shift_id: setup.shift_id,
  };
}

function CopyValueButton(props: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = (props.text || "").trim();
  const disabled = !text;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={props.className || "h-8 w-8 text-fg-muted hover:text-foreground"}
      disabled={disabled}
      onClick={async () => {
        if (disabled) return;
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          // ignore clipboard errors
        }
      }}
      title={disabled ? undefined : `Copy${props.label ? ` ${props.label}` : ""}`}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}

function SetupField(props: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-sunken/20 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">{props.label}</span>
        <CopyValueButton text={props.value} label={props.label} className="h-7 w-7 text-fg-muted hover:text-foreground" />
      </div>
      <code className="block break-all text-xs">{props.value || "-"}</code>
    </div>
  );
}

export default function PosDevicesPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [status, setStatus] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const [deviceCode, setDeviceCode] = useState("");
  const [branchId, setBranchId] = useState("");
  const [registering, setRegistering] = useState(false);
  const [lastSetup, setLastSetup] = useState<DeviceSetup | null>(null);
  const [setupApiBaseUrl, setSetupApiBaseUrl] = useState("");

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const effectiveApiBaseUrl = (setupApiBaseUrl || inferDefaultApiBaseUrl()).trim();
  const setupPayload = useMemo(() => {
    if (!lastSetup) return null;
    return buildPosConfigPayload(lastSetup, effectiveApiBaseUrl);
  }, [lastSetup, effectiveApiBaseUrl]);
  const setupPayloadJson = useMemo(
    () => (setupPayload ? JSON.stringify(setupPayload, null, 2) : ""),
    [setupPayload]
  );

  async function load() {
    setStatus("Loading...");
    try {
      const [res, br] = await Promise.all([
        apiGet<{ devices: DeviceRow[] }>("/pos/devices"),
        apiGet<{ branches: BranchRow[] }>("/branches").catch(() => ({ branches: [] as BranchRow[] })),
      ]);
      setDevices(res.devices || []);
      setBranches(br.branches || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    setSetupApiBaseUrl(inferDefaultApiBaseUrl());
    load();
  }, []);

  async function registerDevice(e: React.FormEvent) {
    e.preventDefault();
    const companyId = getCompanyId();
    if (!companyId) {
      setStatus("Company is not selected. Go to Change Company first.");
      return;
    }
    if (!deviceCode.trim()) {
      setStatus("device_code is required");
      return;
    }

    const nextDeviceCode = deviceCode.trim();
    const nextBranchId = branchId.trim() || null;
    setRegistering(true);
    setStatus("Registering device...");
    setLastSetup(null);
    try {
      const qs = new URLSearchParams();
      qs.set("company_id", companyId);
      qs.set("device_code", nextDeviceCode);
      if (nextBranchId) qs.set("branch_id", nextBranchId);
      const res = await apiPost<{ id: string; token: string | null }>(`/pos/devices/register?${qs.toString()}`, {});
      const branch = nextBranchId ? branchById.get(nextBranchId) : null;
      setLastSetup({
        company_id: companyId,
        branch_id: nextBranchId,
        branch_name: branch?.name || null,
        device_code: nextDeviceCode,
        device_id: res.id,
        device_token: res.token,
        shift_id: "",
      });
      setDeviceCode("");
      setBranchId("");
      setRegisterOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setRegistering(false);
    }
  }

async function resetToken(device: DeviceRow) {
    const companyId = getCompanyId();
    if (!companyId) {
      setStatus("Company is not selected. Go to Change Company first.");
      return;
    }
    setStatus("Resetting token...");
    setLastSetup(null);
    try {
      const res = await apiPost<{ id: string; token: string }>(`/pos/devices/${device.id}/reset-token`, {});
      const branch = device.branch_id ? branchById.get(device.branch_id) : null;
      setLastSetup({
        company_id: companyId,
        branch_id: device.branch_id,
        branch_name: branch?.name || null,
        device_code: device.device_code,
        device_id: res.id,
        device_token: res.token,
        shift_id: "",
      });
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function deactivateDevice(device: DeviceRow) {
    setStatus("Deactivating device...");
    setLastSetup(null);
    try {
      await apiPost(`/pos/devices/${encodeURIComponent(device.id)}/deactivate`, {});
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function deleteDevice(device: DeviceRow) {
    setStatus("Deleting device...");
    setLastSetup(null);
    try {
      await apiDelete(`/pos/devices/${encodeURIComponent(device.id)}`);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <Page width="lg" className="px-4 pb-10">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="POS Devices"
        description="Register devices and generate setup packs for the POS agent."
        actions={
          <>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
            <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
              <DialogTrigger asChild>
                <Button>Register Device</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Register POS Device</DialogTitle>
                  <DialogDescription>Creates a device and returns a one-time token.</DialogDescription>
                </DialogHeader>
                <form onSubmit={registerDevice} className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Device Code</label>
                    <Input value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)} placeholder="POS-01" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-fg-muted">Branch (optional)</label>
                    <SearchableSelect
                      value={branchId}
                      onChange={setBranchId}
                      placeholder="No branch"
                      searchPlaceholder="Search branches..."
                      options={[
                        { value: "", label: "No branch" },
                        ...branches.map((b) => ({ value: b.id, label: b.name })),
                      ]}
                    />
                    {branchId ? <div className="text-[11px] text-fg-subtle">Branch ID: {branchId}</div> : null}
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={registering}>
                      {registering ? "..." : "Register"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {devices.length === 0 ? (
        <Section
          title="Create Your First POS Device"
          description="Register a device, then copy a full setup pack with all required fields."
          actions={<Button onClick={() => setRegisterOpen(true)}>Register Device</Button>}
        >
          <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-subtle">
            <li>Click Register Device, choose an optional Branch, and set a device code like POS-01.</li>
            <li>Copy the generated Setup Pack (includes API URL, company, branch, code, device id, token).</li>
            <li>Paste those values in POS `Settings` and Save.</li>
            <li>Sync to verify the agent can connect.</li>
          </ol>
        </Section>
      ) : null}

      {lastSetup ? (
        <Section
          title="POS Setup Pack"
          description="Everything needed for POS setup after register/reset. Copy values directly into the POS Settings screen."
        >
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">API Base URL for POS agents</label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={setupApiBaseUrl}
                  onChange={(e) => setSetupApiBaseUrl(e.target.value)}
                  placeholder="https://pos.example.com/api"
                  className="max-w-xl"
                />
                <CopyValueButton text={effectiveApiBaseUrl} label="API Base URL" />
              </div>
              <p className="text-xs text-fg-subtle">
                Default is this admin host + `/api`. Change it only if your POS devices use a different API endpoint.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <SetupField label="Company ID" value={lastSetup.company_id} />
              <SetupField label="Branch ID" value={lastSetup.branch_id || ""} />
              <SetupField label="Branch Name" value={lastSetup.branch_name || ""} />
              <SetupField label="Device Code" value={lastSetup.device_code} />
              <SetupField label="Device ID" value={lastSetup.device_id} />
              <SetupField label="Device Token" value={lastSetup.device_token || ""} />
              <SetupField label="Shift ID (optional)" value={lastSetup.shift_id} />
            </div>

            {setupPayload ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-fg-muted">POS Config JSON</div>
                  <CopyValueButton text={setupPayloadJson} label="config json" />
                </div>
                <pre className="whitespace-pre-wrap rounded-md border border-border bg-bg-sunken/30 p-3 text-xs">{setupPayloadJson}</pre>
              </div>
            ) : null}

            {lastSetup.device_token ? null : (
              <div className="rounded-md border border-border-strong bg-bg-elevated p-3 text-xs text-fg-subtle">
                Token was not returned (device already existed). Click <strong>Reset Token & Setup</strong> on that device to generate a fresh setup pack.
              </div>
            )}

            <div className="rounded-md border border-border bg-bg-sunken/20 p-3 text-xs text-fg-subtle">
              Use this pack in POS: open POS &rarr; <strong>Settings</strong> &rarr; paste values &rarr; Save &rarr; Sync.
            </div>
          </div>
        </Section>
      ) : null}

      <Section title="Devices" description={`${devices.length} device(s)`}>
          {(() => {
            const columns: Array<DataTableColumn<DeviceRow>> = [
              { id: "device_code", header: "Code", accessor: (d) => d.device_code, sortable: true, mono: true, cell: (d) => <span className="text-xs">{d.device_code}</span> },
              { id: "id", header: "Device ID", accessor: (d) => d.id, mono: true, defaultHidden: true, cell: (d) => <span className="text-xs text-fg-subtle">{d.id}</span> },
              { id: "branch_id", header: "Branch", accessor: (d) => d.branch_id || "", mono: true, cell: (d) => <span className="text-xs">{d.branch_id || "-"}</span> },
              { id: "token", header: "Token", accessor: (d) => (d.has_token ? "set" : "missing"), sortable: true, cell: (d) => <span className="text-xs text-fg-muted">{d.has_token ? "set" : "missing"}</span> },
              {
                id: "actions",
                header: "Actions",
                accessor: () => "",
                globalSearch: false,
                align: "right",
                cell: (d) => (
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => resetToken(d)}>
                      Reset Token & Setup
                    </Button>
                    <ConfirmButton
                      variant="outline"
                      size="sm"
                      title={`Deactivate "${d.device_code}"?`}
                      description="This revokes its token."
                      confirmText="Deactivate"
                      confirmVariant="destructive"
                      onError={(err) => setStatus(err instanceof Error ? err.message : String(err))}
                      onConfirm={() => deactivateDevice(d)}
                    >
                      Deactivate
                    </ConfirmButton>
                    <ConfirmButton
                      variant="outline"
                      size="sm"
                      title={`Delete "${d.device_code}"?`}
                      description="Only allowed if it has no linked records."
                      confirmText="Delete"
                      confirmVariant="destructive"
                      onError={(err) => setStatus(err instanceof Error ? err.message : String(err))}
                      onConfirm={() => deleteDevice(d)}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                ),
              },
            ];

            return (
              <DataTable<DeviceRow>
                tableId="system.posDevices"
                rows={devices}
                columns={columns}
                emptyText="No devices yet."
                globalFilterPlaceholder="Search device code / branch / token..."
                initialSort={{ columnId: "device_code", dir: "asc" }}
              />
            );
          })()}
      </Section>
    </Page>
  );
}
