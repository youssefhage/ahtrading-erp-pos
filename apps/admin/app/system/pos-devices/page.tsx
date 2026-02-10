"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPost, getCompanyId } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { SearchableSelect } from "@/components/searchable-select";

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

export default function PosDevicesPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [status, setStatus] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const [deviceCode, setDeviceCode] = useState("");
  const [branchId, setBranchId] = useState("");
  const [registering, setRegistering] = useState(false);
  const [lastToken, setLastToken] = useState<{ id: string; token: string | null } | null>(null);

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

    setRegistering(true);
    setStatus("Registering device...");
    setLastToken(null);
    try {
      const qs = new URLSearchParams();
      qs.set("company_id", companyId);
      qs.set("device_code", deviceCode.trim());
      if (branchId.trim()) qs.set("branch_id", branchId.trim());
      const res = await apiPost<{ id: string; token: string | null }>(`/pos/devices/register?${qs.toString()}`, {});
      setLastToken(res);
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

  async function resetToken(deviceId: string) {
    setStatus("Resetting token...");
    setLastToken(null);
    try {
      const res = await apiPost<{ id: string; token: string }>(`/pos/devices/${deviceId}/reset-token`, {});
      setLastToken(res);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      {devices.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Create Your First POS Device</CardTitle>
            <CardDescription>Register a device, copy the one-time token, then run the POS agent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-fg-subtle">
              <li>Click Register Device, choose an optional Branch, and set a device code like POS-01.</li>
              <li>Copy the one-time token (shown once).</li>
              <li>Paste it into `pos-desktop/config.json` as `device_id` + `device_token`.</li>
              <li>Start the stack and verify the agent can sync.</li>
            </ol>
            <div className="flex justify-end">
              <Button onClick={() => setRegisterOpen(true)}>Register Device</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {lastToken ? (
        <Card>
          <CardHeader>
            <CardTitle>Device Token (One-Time)</CardTitle>
            <CardDescription>This token is shown once. Copy it into the POS agent `pos-desktop/config.json`.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-fg-muted">Device ID</span>
              <code className="rounded bg-bg-sunken/30 px-2 py-1 text-xs">{lastToken.id}</code>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-fg-muted">Token</span>
              <code className="rounded bg-bg-sunken/30 px-2 py-1 text-xs break-all">{lastToken.token || "(token not returned; already registered)"}</code>
            </div>
            {lastToken.token ? (
              <div className="space-y-1">
                <div className="text-xs font-medium text-fg-muted">Suggested `pos-desktop/config.json`</div>
                <pre className="whitespace-pre-wrap rounded-md border border-border bg-bg-sunken/30 p-3 text-xs">
                  {JSON.stringify(
                    {
                      api_base_url: "http://localhost:8001",
                      device_id: lastToken.id,
                      device_token: lastToken.token,
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
          <CardDescription>{devices.length} devices</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-end gap-2">
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
          </div>

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
                  <Button variant="outline" size="sm" onClick={() => resetToken(d.id)}>
                    Reset Token
                  </Button>
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
        </CardContent>
      </Card>
    </div>
  );
}
