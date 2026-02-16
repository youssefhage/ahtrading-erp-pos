"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiDelete, apiGet, apiPatch, apiPost, getCompanyId } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";
import { SearchableSelect } from "@/components/searchable-select";
import { ConfirmButton } from "@/components/confirm-button";
import { Page, PageHeader, Section } from "@/components/page";
import { ViewRaw } from "@/components/view-raw";

type DeviceRow = {
  id: string;
  branch_id: string | null;
  branch_name?: string | null;
  device_code: string;
  created_at: string;
  updated_at?: string;
  last_seen_at?: string | null;
  last_seen_status?: string | null;
  pending_events?: number;
  failed_events?: number;
  last_event_at?: string | null;
  open_shift_count?: number;
  assigned_cashiers_count?: number;
  assigned_employees_count?: number;
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

type DeviceCashierRow = {
  id: string;
  name: string;
  is_active: boolean;
  assigned: boolean;
};

type DeviceEmployeeRow = {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  assigned: boolean;
};

function inferDefaultApiBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  const proto = window.location.protocol || "http:";
  const port = String(window.location.port || "");
  // On-prem: Admin runs on :3000 but POS API is :8001.
  if (port === "3000") return `${proto}//${host}:8001`;
  // Cloud: /api is reverse-proxied on the same origin.
  return `${window.location.origin.replace(/\/+$/, "")}/api`;
}

function buildPosConfigPayload(setup: DeviceSetup, apiBaseUrl: string) {
  const cloud = apiBaseUrl.trim();
  return {
    api_base_url: cloud,
    cloud_api_base_url: cloud,
    edge_api_base_url: "",
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

function deviceHealthLabel(row: DeviceRow) {
  const seen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  if (!seen) return "never seen";
  const ageMs = Date.now() - seen;
  if (ageMs <= 5 * 60 * 1000) return "online";
  if (ageMs <= 60 * 60 * 1000) return "idle";
  return "offline";
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
  const [editOpen, setEditOpen] = useState(false);
  const [editDeviceId, setEditDeviceId] = useState("");
  const [editDeviceCode, setEditDeviceCode] = useState("");
  const [editBranchId, setEditBranchId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDevice, setAssignDevice] = useState<DeviceRow | null>(null);
  const [assignCashiers, setAssignCashiers] = useState<DeviceCashierRow[]>([]);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [assignEmployeesOpen, setAssignEmployeesOpen] = useState(false);
  const [assignEmployeesDevice, setAssignEmployeesDevice] = useState<DeviceRow | null>(null);
  const [assignEmployees, setAssignEmployees] = useState<DeviceEmployeeRow[]>([]);
  const [savingEmployeeAssignments, setSavingEmployeeAssignments] = useState(false);

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const effectiveApiBaseUrl = (setupApiBaseUrl || inferDefaultApiBaseUrl()).trim();
  const setupPayload = useMemo(() => {
    if (!lastSetup) return null;
    return buildPosConfigPayload(lastSetup, effectiveApiBaseUrl);
  }, [lastSetup, effectiveApiBaseUrl]);

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

  function openEditDevice(device: DeviceRow) {
    setEditDeviceId(device.id);
    setEditDeviceCode(device.device_code || "");
    setEditBranchId(device.branch_id || "");
    setEditOpen(true);
  }

  async function saveDeviceEdits(e: React.FormEvent) {
    e.preventDefault();
    if (!editDeviceId) return;
    const nextCode = editDeviceCode.trim();
    if (!nextCode) {
      setStatus("device_code is required");
      return;
    }
    setSavingEdit(true);
    setStatus("Saving device settings...");
    try {
      await apiPatch(`/pos/devices/${encodeURIComponent(editDeviceId)}`, {
        device_code: nextCode,
        branch_id: editBranchId.trim() || null,
      });
      setEditOpen(false);
      setEditDeviceId("");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function openAssignCashiers(device: DeviceRow) {
    setAssignOpen(true);
    setAssignDevice(device);
    setAssignCashiers([]);
    setStatus("Loading cashier assignments...");
    try {
      const res = await apiGet<{ cashiers: DeviceCashierRow[] }>(`/pos/devices/${encodeURIComponent(device.id)}/cashiers`);
      setAssignCashiers(res.cashiers || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      setAssignOpen(false);
      setAssignDevice(null);
    }
  }

  function toggleCashierAssignment(cashierId: string, checked: boolean) {
    setAssignCashiers((prev) => prev.map((c) => (c.id === cashierId ? { ...c, assigned: checked } : c)));
  }

  async function saveCashierAssignments() {
    if (!assignDevice) return;
    setSavingAssignments(true);
    setStatus("Saving cashier assignments...");
    try {
      const cashier_ids = assignCashiers.filter((c) => c.assigned).map((c) => c.id);
      await apiPatch(`/pos/devices/${encodeURIComponent(assignDevice.id)}/cashiers`, { cashier_ids });
      setAssignOpen(false);
      setAssignDevice(null);
      setAssignCashiers([]);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingAssignments(false);
    }
  }

  async function openAssignEmployees(device: DeviceRow) {
    setAssignEmployeesOpen(true);
    setAssignEmployeesDevice(device);
    setAssignEmployees([]);
    setStatus("Loading employee assignments...");
    try {
      const res = await apiGet<{ employees: DeviceEmployeeRow[] }>(`/pos/devices/${encodeURIComponent(device.id)}/employees`);
      setAssignEmployees(res.employees || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
      setAssignEmployeesOpen(false);
      setAssignEmployeesDevice(null);
    }
  }

  function toggleEmployeeAssignment(userId: string, checked: boolean) {
    setAssignEmployees((prev) => prev.map((u) => (u.id === userId ? { ...u, assigned: checked } : u)));
  }

  async function saveEmployeeAssignments() {
    if (!assignEmployeesDevice) return;
    setSavingEmployeeAssignments(true);
    setStatus("Saving employee assignments...");
    try {
      const user_ids = assignEmployees.filter((u) => u.assigned).map((u) => u.id);
      await apiPatch(`/pos/devices/${encodeURIComponent(assignEmployeesDevice.id)}/employees`, { user_ids });
      setAssignEmployeesOpen(false);
      setAssignEmployeesDevice(null);
      setAssignEmployees([]);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingEmployeeAssignments(false);
    }
  }

  return (
    <Page width="lg" className="px-4 pb-10">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="POS Devices"
        description="Register devices, edit terminal settings, and control cashier access."
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit POS Device</DialogTitle>
            <DialogDescription>Update code and branch without deleting the device.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveDeviceEdits} className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Device Code</label>
              <Input value={editDeviceCode} onChange={(e) => setEditDeviceCode(e.target.value)} placeholder="POS-01" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted">Branch (optional)</label>
              <SearchableSelect
                value={editBranchId}
                onChange={setEditBranchId}
                placeholder="No branch"
                searchPlaceholder="Search branches..."
                options={[
                  { value: "", label: "No branch" },
                  ...branches.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={savingEdit}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? "..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assignOpen}
        onOpenChange={(open) => {
          setAssignOpen(open);
          if (!open) {
            setAssignDevice(null);
            setAssignCashiers([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Cashiers</DialogTitle>
            <DialogDescription>
              {assignDevice ? `Choose who can log in on ${assignDevice.device_code}.` : "Choose who can log in on this device."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-md border border-border p-3">
            {assignCashiers.length ? (
              assignCashiers.map((c) => (
                <label key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="truncate">{c.name}</span>
                  <span className="flex items-center gap-2">
                    {c.is_active ? null : <span className="text-xs text-fg-subtle">inactive</span>}
                    <input
                      type="checkbox"
                      checked={!!c.assigned}
                      onChange={(e) => toggleCashierAssignment(c.id, e.target.checked)}
                    />
                  </span>
                </label>
              ))
            ) : (
              <div className="text-xs text-fg-subtle">No cashiers found. Create cashiers first in System → POS Cashiers.</div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)} disabled={savingAssignments}>
              Cancel
            </Button>
            <Button type="button" onClick={saveCashierAssignments} disabled={savingAssignments || !assignDevice}>
              {savingAssignments ? "..." : "Save Assignments"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assignEmployeesOpen}
        onOpenChange={(open) => {
          setAssignEmployeesOpen(open);
          if (!open) {
            setAssignEmployeesDevice(null);
            setAssignEmployees([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Employees</DialogTitle>
            <DialogDescription>
              {assignEmployeesDevice
                ? `Assign employees allowed on ${assignEmployeesDevice.device_code}. Only cashiers linked to these employees can log in on this device.`
                : "Assign employees allowed on this device. Only linked cashiers can log in."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-md border border-border p-3">
            {assignEmployees.length ? (
              assignEmployees.map((u) => (
                <label key={u.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="truncate">{u.full_name || u.email}</span>
                  <span className="flex items-center gap-2">
                    {u.is_active ? null : <span className="text-xs text-fg-subtle">inactive</span>}
                    <input
                      type="checkbox"
                      checked={!!u.assigned}
                      onChange={(e) => toggleEmployeeAssignment(u.id, e.target.checked)}
                    />
                  </span>
                </label>
              ))
            ) : (
              <div className="text-xs text-fg-subtle">No employees found for this company.</div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAssignEmployeesOpen(false)} disabled={savingEmployeeAssignments}>
              Cancel
            </Button>
            <Button type="button" onClick={saveEmployeeAssignments} disabled={savingEmployeeAssignments || !assignEmployeesDevice}>
              {savingEmployeeAssignments ? "..." : "Save Assignments"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                </div>
                <ViewRaw value={setupPayload} label="POS Config JSON" defaultOpen={false} />
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
              {
                id: "branch_id",
                header: "Branch",
                accessor: (d) => d.branch_name || d.branch_id || "",
                cell: (d) => (
                  <span className="text-xs">
                    {d.branch_name || (d.branch_id ? d.branch_id : "-")}
                  </span>
                ),
              },
              { id: "token", header: "Token", accessor: (d) => (d.has_token ? "set" : "missing"), sortable: true, cell: (d) => <span className="text-xs text-fg-muted">{d.has_token ? "set" : "missing"}</span> },
              {
                id: "health",
                header: "Health",
                accessor: (d) => `${deviceHealthLabel(d)} ${d.last_seen_at || ""}`,
                sortable: true,
                cell: (d) => (
                  <span className="text-xs text-fg-muted">
                    {deviceHealthLabel(d)}
                    {d.last_seen_at ? ` · ${new Date(d.last_seen_at).toLocaleString()}` : ""}
                  </span>
                ),
              },
              {
                id: "queue",
                header: "Queue",
                accessor: (d) => `${d.pending_events || 0}/${d.failed_events || 0}`,
                cell: (d) => <span className="text-xs text-fg-muted">pending {d.pending_events || 0} · failed {d.failed_events || 0}</span>,
              },
              {
                id: "assignments",
                header: "Assignments",
                accessor: (d) => `${d.assigned_employees_count || 0}/${d.assigned_cashiers_count || 0}`,
                cell: (d) => (
                  <span className="text-xs text-fg-muted">
                    employees {d.assigned_employees_count || 0} · cashiers {d.assigned_cashiers_count || 0} · open shifts {d.open_shift_count || 0}
                  </span>
                ),
              },
              {
                id: "actions",
                header: "Actions",
                accessor: () => "",
                globalSearch: false,
                align: "right",
                cell: (d) => (
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEditDevice(d)}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openAssignEmployees(d)}>
                      Assign Employees
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openAssignCashiers(d)}>
                      Assign Cashiers
                    </Button>
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
