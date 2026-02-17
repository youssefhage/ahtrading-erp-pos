"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/error-banner";

type ShiftRow = {
  id: string;
  device_id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash_usd: string | number;
  opening_cash_lbp: string | number;
  closing_cash_usd: string | number | null;
  closing_cash_lbp: string | number | null;
  expected_cash_usd: string | number | null;
  expected_cash_lbp: string | number | null;
  variance_usd: string | number | null;
  variance_lbp: string | number | null;
};

type DeviceRow = {
  id: string;
  branch_id: string | null;
  device_code: string;
  created_at: string;
  has_token: boolean;
};

type CashMovementRow = {
  id: string;
  shift_id: string;
  device_id: string;
  device_code: string;
  movement_type: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  notes: string | null;
  created_at: string;
};

type CashRecon = {
  shift: ShiftRow;
  cash_methods: string[];
  sales_cash_usd: string | number;
  sales_cash_lbp: string | number;
  refunds_cash_usd: string | number;
  refunds_cash_lbp: string | number;
  cash_movements: Array<{ movement_type: string; usd: string | number; lbp: string | number }>;
  cash_movements_net_usd: string | number;
  cash_movements_net_lbp: string | number;
  expected_computed_usd: string | number;
  expected_computed_lbp: string | number;
};

export default function PosShiftsPage() {
  const [status, setStatus] = useState("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [recon, setRecon] = useState<CashRecon | null>(null);
  const [movementsLimit, setMovementsLimit] = useState("200");

  const deviceById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  const shiftColumns = useMemo((): Array<DataTableColumn<ShiftRow>> => {
    return [
      {
        id: "opened_at",
        header: "Opened",
        sortable: true,
        mono: true,
        accessor: (s) => s.opened_at,
        cell: (s) => <span className="font-mono text-xs">{formatDateTime(s.opened_at)}</span>,
      },
      {
        id: "device",
        header: "Device",
        sortable: true,
        mono: true,
        accessor: (s) => deviceById.get(s.device_id)?.device_code || s.device_id,
        cell: (s) => <span className="font-mono text-xs">{deviceById.get(s.device_id)?.device_code || s.device_id}</span>,
      },
      {
        id: "status",
        header: "Status",
        sortable: true,
        mono: true,
        accessor: (s) => s.status,
        cell: (s) => <span className="font-mono text-xs">{s.status}</span>,
      },
      {
        id: "opening_cash_usd",
        header: "Open USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.opening_cash_usd || 0),
        cell: (s) => (
          <span className="font-mono text-xs">
            {Number(s.opening_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        ),
      },
      {
        id: "expected_cash_usd",
        header: "Expected USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.expected_cash_usd || 0),
        cell: (s) => (
          <span className="font-mono text-xs">
            {Number(s.expected_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        ),
      },
      {
        id: "closing_cash_usd",
        header: "Close USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.closing_cash_usd || 0),
        cell: (s) => (
          <span className="font-mono text-xs">
            {Number(s.closing_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        ),
      },
      {
        id: "variance_usd",
        header: "Var USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => Number(s.variance_usd || 0),
        cell: (s) => (
          <span className="font-mono text-xs">
            {Number(s.variance_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        sortable: false,
        accessor: (s) => s.id,
        cell: (s) => {
          const active = selectedShiftId === s.id;
          return (
            <Button variant={active ? "secondary" : "outline"} size="sm" onClick={() => setSelectedShiftId(s.id)}>
              Cash Movements
            </Button>
          );
        },
      },
    ];
  }, [deviceById, selectedShiftId]);

  const movementColumns = useMemo((): Array<DataTableColumn<CashMovementRow>> => {
    return [
      {
        id: "created_at",
        header: "Created",
        sortable: true,
        mono: true,
        accessor: (m) => m.created_at,
        cell: (m) => <span className="font-mono text-xs">{formatDateTime(m.created_at)}</span>,
      },
      {
        id: "device_code",
        header: "Device",
        sortable: true,
        mono: true,
        accessor: (m) => m.device_code,
        cell: (m) => <span className="font-mono text-xs">{m.device_code}</span>,
      },
      {
        id: "movement_type",
        header: "Type",
        sortable: true,
        mono: true,
        accessor: (m) => m.movement_type,
        cell: (m) => <span className="font-mono text-xs">{m.movement_type}</span>,
      },
      {
        id: "amount_usd",
        header: "USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (m) => Number(m.amount_usd || 0),
        cell: (m) => (
          <span className="font-mono text-xs">
            {Number(m.amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        ),
      },
      {
        id: "amount_lbp",
        header: "LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (m) => Number(m.amount_lbp || 0),
        cell: (m) => (
          <span className="font-mono text-xs">
            {Number(m.amount_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
        ),
      },
      {
        id: "notes",
        header: "Notes",
        sortable: true,
        accessor: (m) => m.notes || "",
        cell: (m) => <span className="text-xs text-fg-muted">{m.notes || "-"}</span>,
      },
    ];
  }, []);

  async function load() {
    setStatus("Loading...");
    try {
      const [s, d] = await Promise.all([
        apiGet<{ shifts: ShiftRow[] }>("/pos/shifts"),
        apiGet<{ devices: DeviceRow[] }>("/pos/devices")
      ]);
      setShifts(s.shifts || []);
      setDevices(d.devices || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  async function loadMovements(shiftId: string) {
    if (!shiftId) {
      setMovements([]);
      setRecon(null);
      return;
    }
    setStatus("Loading cash movements...");
    try {
      const qs = new URLSearchParams();
      qs.set("shift_id", shiftId);
      const n = Number(movementsLimit || 200);
      qs.set("limit", Number.isFinite(n) ? String(n) : "200");
      const [res, rec] = await Promise.all([
        apiGet<{ movements: CashMovementRow[] }>(`/pos/cash-movements/admin?${qs.toString()}`),
        apiGet<CashRecon>(`/pos/shifts/${encodeURIComponent(shiftId)}/cash-reconciliation`)
      ]);
      setMovements(res.movements || []);
      setRecon(rec || null);
      setStatus("");
    } catch (err) {
      setMovements([]);
      setRecon(null);
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadMovements(selectedShiftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShiftId]);

  return (
    <Page width="lg" className="px-4 pb-10">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="POS Shifts"
        description="Shift history and cash movements for POS devices."
        actions={
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        }
      />

      <Section title="Shifts" description={`${shifts.length} shift(s) (latest first)`}>
        <DataTable<ShiftRow>
          tableId="system.pos_shifts.shifts"
          rows={shifts}
          columns={shiftColumns}
          getRowId={(r) => r.id}
          emptyText="No shifts."
          globalFilterPlaceholder="Search device / status / id"
          initialSort={{ columnId: "opened_at", dir: "desc" }}
        />
      </Section>

      <Section
        title="Cash Movements"
        description={
          selectedShiftId ? (
            <span>
              Shift: <span className="font-mono text-xs">{selectedShiftId}</span>
            </span>
          ) : (
            "Select a shift to view cash movements."
          )
        }
      >
        {recon ? (
          <div className="rounded-md border border-border-subtle bg-bg-sunken/20 p-4">
            <div className="text-sm font-medium text-foreground">Cash Reconciliation</div>
            <div className="mt-1 text-xs text-fg-subtle">
              Cash methods: <span className="font-mono">{(recon.cash_methods || []).length ? recon.cash_methods.join(", ") : "none"}</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-border-subtle bg-bg-sunken/40 p-3">
                <div className="text-xs text-fg-muted">Opening</div>
                <div className="mt-1 font-mono text-sm">
                  USD {Number(recon.shift.opening_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-sunken/40 p-3">
                <div className="text-xs text-fg-muted">Cash Sales</div>
                <div className="mt-1 font-mono text-sm">
                  USD {Number(recon.sales_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-sunken/40 p-3">
                <div className="text-xs text-fg-muted">Cash Refunds</div>
                <div className="mt-1 font-mono text-sm">
                  USD {Number(recon.refunds_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-sunken/40 p-3">
                <div className="text-xs text-fg-muted">Cash Movements (net)</div>
                <div className="mt-1 font-mono text-sm">
                  USD {Number(recon.cash_movements_net_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-sunken/40 p-3">
                <div className="text-xs text-fg-muted">Expected (computed)</div>
                <div className="mt-1 font-mono text-sm">
                  USD {Number(recon.expected_computed_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="rounded-md border border-border-subtle bg-bg-sunken/40 p-3">
                <div className="text-xs text-fg-muted">Closing (counted)</div>
                <div className="mt-1 font-mono text-sm">
                  USD {Number(recon.shift.closing_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
          <div className="w-full md:w-56">
            <label className="text-xs font-medium text-fg-muted">Limit</label>
            <Input value={movementsLimit} onChange={(e) => setMovementsLimit(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => loadMovements(selectedShiftId)} disabled={!selectedShiftId}>
            Refresh Movements
          </Button>
        </div>

        <div className="mt-3">
          <DataTable<CashMovementRow>
            tableId="system.pos_shifts.cash_movements"
            rows={movements}
            columns={movementColumns}
            getRowId={(r) => r.id}
            emptyText={selectedShiftId ? "No cash movements." : "Select a shift to view cash movements."}
            globalFilterPlaceholder="Search device / type / notes"
            initialSort={{ columnId: "created_at", dir: "desc" }}
          />
        </div>
      </Section>
    </Page>
  );
}
