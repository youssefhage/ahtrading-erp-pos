"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
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

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatUsd(value: unknown, { blankWhenNull = false } = {}) {
  if (blankWhenNull && (value === null || value === undefined || value === "")) return "-";
  return toNumber(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatUsdSigned(value: unknown, { blankWhenNull = false } = {}) {
  if (blankWhenNull && (value === null || value === undefined || value === "")) return "-";
  const n = toNumber(value);
  const abs = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

function formatDateOrDash(value: string | null | undefined) {
  if (!value) return "-";
  return formatDateTime(value);
}

function normalizeMovementsLimit(raw: string): string {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return "200";
  return String(Math.min(1000, Math.max(1, n)));
}

function humanizeMovementType(value: string) {
  const text = String(value || "").trim();
  if (!text) return "Unknown";
  return text
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export default function PosShiftsPage() {
  const [status, setStatus] = useState("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [recon, setRecon] = useState<CashRecon | null>(null);
  const [movementsLimit, setMovementsLimit] = useState("200");
  const loadingShifts = status === "Loading...";
  const loadingMovements = status === "Loading cash movements...";
  const statusIsBusy = loadingShifts || loadingMovements;

  const deviceById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const selectedShift = useMemo(() => shifts.find((s) => s.id === selectedShiftId) || null, [shifts, selectedShiftId]);
  const selectedDeviceCode = selectedShift ? (deviceById.get(selectedShift.device_id)?.device_code || selectedShift.device_id) : "";
  const openShiftCount = useMemo(() => shifts.filter((s) => String(s.status).toLowerCase() === "open").length, [shifts]);
  const closedShiftCount = Math.max(0, shifts.length - openShiftCount);

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
        accessor: (s) => s.status,
        cell: (s) => <StatusChip value={s.status} />,
      },
      {
        id: "closed_at",
        header: "Closed",
        sortable: true,
        mono: true,
        accessor: (s) => s.closed_at || "",
        cell: (s) => <span className="font-mono text-xs">{formatDateOrDash(s.closed_at)}</span>,
      },
      {
        id: "opening_cash_usd",
        header: "Open USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => toNumber(s.opening_cash_usd),
        cell: (s) => <span className="font-mono text-xs">{formatUsd(s.opening_cash_usd)}</span>,
      },
      {
        id: "expected_cash_usd",
        header: "Expected USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => toNumber(s.expected_cash_usd),
        cell: (s) => <span className="font-mono text-xs">{formatUsd(s.expected_cash_usd, { blankWhenNull: true })}</span>,
      },
      {
        id: "closing_cash_usd",
        header: "Close USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => toNumber(s.closing_cash_usd),
        cell: (s) => <span className="font-mono text-xs">{formatUsd(s.closing_cash_usd, { blankWhenNull: true })}</span>,
      },
      {
        id: "variance_usd",
        header: "Var USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (s) => toNumber(s.variance_usd),
        cell: (s) => {
          if (s.variance_usd === null || s.variance_usd === undefined || s.variance_usd === "") {
            return <span className="font-mono text-xs text-fg-muted">-</span>;
          }
          const v = toNumber(s.variance_usd);
          const cls = v === 0 ? "text-fg-muted" : v < 0 ? "ui-tone-negative" : "ui-tone-qty";
          return <span className={`font-mono text-xs ${cls}`}>{formatUsdSigned(v)}</span>;
        },
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
              {active ? "Viewing" : "View Details"}
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
        accessor: (m) => m.movement_type,
        cell: (m) => <span className="text-xs">{humanizeMovementType(m.movement_type)}</span>,
      },
      {
        id: "amount_usd",
        header: "USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (m) => toNumber(m.amount_usd),
        cell: (m) => {
          const amount = toNumber(m.amount_usd);
          const cls = amount === 0 ? "text-fg-muted" : amount < 0 ? "ui-tone-negative" : "ui-tone-qty";
          return <span className={`font-mono text-xs ${cls}`}>{formatUsdSigned(amount)}</span>;
        },
      },
      {
        id: "amount_lbp",
        header: "LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (m) => toNumber(m.amount_lbp),
        cell: (m) => (
          <span className="font-mono text-xs">
            {toNumber(m.amount_lbp).toLocaleString("en-US", { maximumFractionDigits: 0 })}
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
        apiGet<{ devices: DeviceRow[] }>("/pos/devices"),
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
      qs.set("limit", normalizeMovementsLimit(movementsLimit));
      const [res, rec] = await Promise.all([
        apiGet<{ movements: CashMovementRow[] }>(`/pos/cash-movements/admin?${qs.toString()}`),
        apiGet<CashRecon>(`/pos/shifts/${encodeURIComponent(shiftId)}/cash-reconciliation`),
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
    setSelectedShiftId((prev) => {
      if (!shifts.length) return "";
      if (prev && shifts.some((s) => s.id === prev)) return prev;
      return shifts[0]?.id || "";
    });
  }, [shifts]);

  useEffect(() => {
    loadMovements(selectedShiftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShiftId]);

  return (
    <Page width="lg" className="px-4 pb-10">
      {status && !statusIsBusy ? <ErrorBanner error={status} onRetry={load} /> : null}

      <PageHeader
        title="POS Shifts"
        description="Shift history, live expected cash, and cash movement drill-down for POS devices."
        meta={
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="rounded-md border border-border-subtle bg-bg-sunken/30 px-2 py-1">Open: {openShiftCount}</span>
            <span className="rounded-md border border-border-subtle bg-bg-sunken/30 px-2 py-1">Closed: {closedShiftCount}</span>
            <span className="rounded-md border border-border-subtle bg-bg-sunken/30 px-2 py-1">Total: {shifts.length}</span>
          </div>
        }
        actions={
          <Button variant="outline" onClick={load} disabled={statusIsBusy}>
            {loadingShifts ? "Loading..." : "Refresh"}
          </Button>
        }
      />

      <Section title="Shifts" description="Latest shifts first. Click any row to inspect its cash movements.">
        <DataTable<ShiftRow>
          tableId="system.pos_shifts.shifts"
          rows={shifts}
          columns={shiftColumns}
          getRowId={(r) => r.id}
          onRowClick={(r) => setSelectedShiftId(r.id)}
          rowClassName={(r) => (r.id === selectedShiftId ? "bg-bg-sunken/30" : undefined)}
          isLoading={loadingShifts}
          emptyText={loadingShifts ? "Loading shifts..." : "No shifts."}
          globalFilterPlaceholder="Search device / status / id"
          initialSort={{ columnId: "opened_at", dir: "desc" }}
        />
      </Section>

      <Section
        title="Cash Movements"
        description={
          selectedShift ? (
            <span className="flex flex-wrap items-center gap-2">
              <span>
                Selected shift: <span className="font-mono text-xs">{selectedShiftId}</span>
              </span>
              <span className="text-fg-subtle">-</span>
              <span>
                Device: <span className="font-mono text-xs">{selectedDeviceCode}</span>
              </span>
              <span className="text-fg-subtle">-</span>
              <span>
                Status: <span className="font-medium">{selectedShift.status}</span>
              </span>
            </span>
          ) : (
            "Select a shift to view cash movements."
          )
        }
      >
        {selectedShift ? (
          <div className="rounded-md border border-border-subtle bg-bg-sunken/15 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-foreground">Selected Shift Summary</div>
                <div className="text-xs text-fg-subtle">Cash values are in USD for quick reconciliation checks.</div>
              </div>
              <StatusChip value={selectedShift.status} />
            </div>
            <div className="mt-3 ui-metric-grid md:grid-cols-3">
              <div className="ui-metric">
                <div className="ui-metric-label">Device</div>
                <div className="ui-metric-value">{selectedDeviceCode}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Opened</div>
                <div className="ui-metric-value">{formatDateTime(selectedShift.opened_at)}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Closed</div>
                <div className="ui-metric-value">{formatDateOrDash(selectedShift.closed_at)}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Opening USD</div>
                <div className="ui-metric-value">{formatUsd(selectedShift.opening_cash_usd)}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Expected USD</div>
                <div className="ui-metric-value">{formatUsd(selectedShift.expected_cash_usd, { blankWhenNull: true })}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Close USD</div>
                <div className="ui-metric-value">{formatUsd(selectedShift.closing_cash_usd, { blankWhenNull: true })}</div>
              </div>
            </div>
          </div>
        ) : null}

        {recon ? (
          <div className="mt-3 rounded-md border border-border-subtle bg-bg-sunken/20 p-4">
            <div className="text-sm font-medium text-foreground">Cash Reconciliation</div>
            <div className="mt-1 text-xs text-fg-subtle">
              Formula: Expected = Opening + Cash Sales - Cash Refunds + Cash Movements (net)
            </div>
            <div className="mt-1 text-xs text-fg-subtle">
              Cash methods: <span className="font-mono">{(recon.cash_methods || []).length ? recon.cash_methods.join(", ") : "none"}</span>
            </div>
            <div className="mt-1 text-xs text-fg-subtle">
              Open shifts show live expected cash; Close and variance finalize only when the shift is closed.
            </div>
            <div className="mt-3 ui-metric-grid md:grid-cols-3">
              <div className="ui-metric">
                <div className="ui-metric-label">Opening</div>
                <div className="ui-metric-value">USD {formatUsd(recon.shift.opening_cash_usd)}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Cash Sales</div>
                <div className="ui-metric-value">USD {formatUsd(recon.sales_cash_usd)}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Cash Refunds</div>
                <div className="ui-metric-value">USD {formatUsd(recon.refunds_cash_usd)}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Cash Movements (net)</div>
                <div className="ui-metric-value">USD {formatUsdSigned(recon.cash_movements_net_usd)}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Expected (computed)</div>
                <div className="ui-metric-value">USD {formatUsd(recon.expected_computed_usd)}</div>
              </div>
              <div className="ui-metric">
                <div className="ui-metric-label">Closing (counted)</div>
                <div className="ui-metric-value">USD {formatUsd(recon.shift.closing_cash_usd, { blankWhenNull: true })}</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-3 rounded-md border border-border-subtle bg-bg-sunken/10 p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full space-y-1 md:w-56">
              <label className="text-xs font-medium text-fg-muted">Movements to load</label>
              <Input
                type="number"
                min={1}
                max={1000}
                inputMode="numeric"
                value={movementsLimit}
                onChange={(e) => setMovementsLimit(e.target.value.replace(/[^0-9]/g, ""))}
                onBlur={() => setMovementsLimit(normalizeMovementsLimit(movementsLimit))}
              />
              <div className="text-xs text-fg-subtle">Use smaller values for faster loading on busy shifts.</div>
            </div>

            <div className="flex items-center gap-2">
              {[100, 200, 500].map((n) => (
                <Button
                  key={n}
                  variant={movementsLimit === String(n) ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setMovementsLimit(String(n))}
                >
                  {n}
                </Button>
              ))}
              <Button variant="outline" onClick={() => loadMovements(selectedShiftId)} disabled={!selectedShiftId || loadingMovements}>
                {loadingMovements ? "Refreshing..." : "Refresh Movements"}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <DataTable<CashMovementRow>
            tableId="system.pos_shifts.cash_movements"
            rows={movements}
            columns={movementColumns}
            getRowId={(r) => r.id}
            isLoading={loadingMovements}
            emptyText={loadingMovements ? "Loading cash movements..." : selectedShiftId ? "No cash movements for this shift." : "Select a shift to view cash movements."}
            globalFilterPlaceholder="Search device / type / notes"
            initialSort={{ columnId: "created_at", dir: "desc" }}
          />
        </div>
      </Section>
    </Page>
  );
}
