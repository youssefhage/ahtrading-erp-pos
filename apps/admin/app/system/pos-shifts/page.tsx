"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, RefreshCw } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { KpiCard } from "@/components/business/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

type ShiftCloseResult = {
  shift: {
    id: string;
    status: string;
    closed_at: string;
    expected_cash_usd: string | number;
    expected_cash_lbp: string | number;
    variance_usd: string | number;
    variance_lbp: string | number;
  };
  cash_methods: string[];
  has_cash_method_mapping: boolean;
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

function toInputCash(value: unknown): string {
  if (value === null || value === undefined || value === "") return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

export default function PosShiftsPage() {
  const [status, setStatus] = useState("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [movements, setMovements] = useState<CashMovementRow[]>([]);
  const [recon, setRecon] = useState<CashRecon | null>(null);
  const [movementsLimit, setMovementsLimit] = useState("200");
  const [closingCashUsd, setClosingCashUsd] = useState("0");
  const [closingCashLbp, setClosingCashLbp] = useState("0");
  const [closingNotes, setClosingNotes] = useState("");
  const [closeFormShiftId, setCloseFormShiftId] = useState("");
  const [closingShift, setClosingShift] = useState(false);
  const loadingShifts = status === "Loading...";
  const loadingMovements = status === "Loading cash movements...";
  const statusIsBusy = loadingShifts || loadingMovements || closingShift;

  const deviceById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const selectedShift = useMemo(() => shifts.find((s) => s.id === selectedShiftId) || null, [shifts, selectedShiftId]);
  const selectedDeviceCode = selectedShift ? deviceById.get(selectedShift.device_id)?.device_code || selectedShift.device_id : "";
  const selectedShiftIsOpen = String(selectedShift?.status || "").toLowerCase() === "open";
  const openShiftCount = useMemo(() => shifts.filter((s) => String(s.status).toLowerCase() === "open").length, [shifts]);
  const closedShiftCount = Math.max(0, shifts.length - openShiftCount);

  const shiftColumns = useMemo<ColumnDef<ShiftRow>[]>(
    () => [
      {
        id: "opened_at",
        accessorFn: (s) => s.opened_at,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Opened" />,
        cell: ({ row }) => <span className="font-mono text-sm">{formatDateTime(row.original.opened_at)}</span>,
      },
      {
        id: "device",
        accessorFn: (s) => deviceById.get(s.device_id)?.device_code || s.device_id,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Device" />,
        cell: ({ row }) => <span className="font-mono text-sm">{deviceById.get(row.original.device_id)?.device_code || row.original.device_id}</span>,
      },
      {
        id: "status",
        accessorFn: (s) => s.status,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "closed_at",
        accessorFn: (s) => s.closed_at || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Closed" />,
        cell: ({ row }) => <span className="font-mono text-sm">{formatDateOrDash(row.original.closed_at)}</span>,
      },
      {
        id: "opening_cash_usd",
        accessorFn: (s) => toNumber(s.opening_cash_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Open USD" />,
        cell: ({ row }) => <span className="font-mono text-sm">{formatUsd(row.original.opening_cash_usd)}</span>,
      },
      {
        id: "expected_cash_usd",
        accessorFn: (s) => toNumber(s.expected_cash_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expected USD" />,
        cell: ({ row }) => <span className="font-mono text-sm">{formatUsd(row.original.expected_cash_usd, { blankWhenNull: true })}</span>,
      },
      {
        id: "variance_usd",
        accessorFn: (s) => toNumber(s.variance_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Var USD" />,
        cell: ({ row }) => {
          const raw = row.original.variance_usd;
          if (raw === null || raw === undefined || raw === "") return <span className="font-mono text-sm text-muted-foreground">-</span>;
          const v = toNumber(raw);
          const cls = v === 0 ? "text-muted-foreground" : v < 0 ? "text-destructive" : "text-emerald-600";
          return <span className={`font-mono text-sm ${cls}`}>{formatUsdSigned(v)}</span>;
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const active = selectedShiftId === row.original.id;
          return (
            <Button variant={active ? "secondary" : "outline"} size="sm" onClick={() => setSelectedShiftId(row.original.id)}>
              {active ? "Viewing" : "View"}
            </Button>
          );
        },
      },
    ],
    [deviceById, selectedShiftId],
  );

  const movementColumns = useMemo<ColumnDef<CashMovementRow>[]>(
    () => [
      {
        id: "created_at",
        accessorFn: (m) => m.created_at,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => <span className="font-mono text-sm">{formatDateTime(row.original.created_at)}</span>,
      },
      {
        id: "device_code",
        accessorFn: (m) => m.device_code,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Device" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.device_code}</span>,
      },
      {
        id: "movement_type",
        accessorFn: (m) => m.movement_type,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        cell: ({ row }) => <span className="text-sm">{humanizeMovementType(row.original.movement_type)}</span>,
      },
      {
        id: "amount_usd",
        accessorFn: (m) => toNumber(m.amount_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="USD" />,
        cell: ({ row }) => {
          const amount = toNumber(row.original.amount_usd);
          const cls = amount === 0 ? "text-muted-foreground" : amount < 0 ? "text-destructive" : "text-emerald-600";
          return <span className={`font-mono text-sm ${cls}`}>{formatUsdSigned(amount)}</span>;
        },
      },
      {
        id: "amount_lbp",
        accessorFn: (m) => toNumber(m.amount_lbp),
        header: ({ column }) => <DataTableColumnHeader column={column} title="LL" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{toNumber(row.original.amount_lbp).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
        ),
      },
      {
        id: "notes",
        accessorFn: (m) => m.notes || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Notes" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.notes || "-"}</span>,
      },
    ],
    [],
  );

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

  function loadExpectedIntoCloseForm() {
    if (!selectedShift) return;
    const expectedUsd = recon && recon.shift && recon.shift.id === selectedShift.id ? recon.expected_computed_usd : selectedShift.expected_cash_usd;
    const expectedLbp = recon && recon.shift && recon.shift.id === selectedShift.id ? recon.expected_computed_lbp : selectedShift.expected_cash_lbp;
    setClosingCashUsd(toInputCash(expectedUsd));
    setClosingCashLbp(toInputCash(expectedLbp));
    setCloseFormShiftId(selectedShift.id);
  }

  async function closeSelectedShift() {
    if (!selectedShift || !selectedShiftId) return;
    if (String(selectedShift.status || "").toLowerCase() !== "open") {
      setStatus("HTTP 400: only open shifts can be closed");
      return;
    }
    const usd = Number(closingCashUsd);
    const lbp = Number(closingCashLbp);
    if (!Number.isFinite(usd) || usd < 0) {
      setStatus("HTTP 422: closing cash USD must be >= 0");
      return;
    }
    if (!Number.isFinite(lbp) || lbp < 0) {
      setStatus("HTTP 422: closing cash LBP must be >= 0");
      return;
    }
    const confirmed = window.confirm(`Close shift ${selectedShiftId} for device ${selectedDeviceCode || selectedShift.device_id}?`);
    if (!confirmed) return;
    setClosingShift(true);
    setStatus("Closing shift...");
    try {
      await apiPost<ShiftCloseResult>(`/pos/shifts/${encodeURIComponent(selectedShiftId)}/close-admin`, {
        closing_cash_usd: usd,
        closing_cash_lbp: lbp,
        notes: closingNotes.trim() || undefined,
      });
      await load();
      await loadMovements(selectedShiftId);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setClosingShift(false);
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

  useEffect(() => {
    if (!selectedShift) {
      setClosingCashUsd("0");
      setClosingCashLbp("0");
      setClosingNotes("");
      setCloseFormShiftId("");
      return;
    }
    if (!selectedShiftIsOpen) {
      setCloseFormShiftId(selectedShift.id);
      return;
    }
    if (closeFormShiftId === selectedShift.id) return;
    const expectedUsd = recon && recon.shift && recon.shift.id === selectedShift.id ? recon.expected_computed_usd : selectedShift.expected_cash_usd;
    const expectedLbp = recon && recon.shift && recon.shift.id === selectedShift.id ? recon.expected_computed_lbp : selectedShift.expected_cash_lbp;
    setClosingCashUsd(toInputCash(expectedUsd));
    setClosingCashLbp(toInputCash(expectedLbp));
    setCloseFormShiftId(selectedShift.id);
    setClosingNotes("");
  }, [selectedShift, selectedShiftIsOpen, closeFormShiftId, recon]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="POS Shifts"
        description="Shift history, live expected cash, and cash movement drill-down for POS devices."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={statusIsBusy}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loadingShifts ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <KpiCard title="Open" value={openShiftCount} />
          <KpiCard title="Closed" value={closedShiftCount} />
          <KpiCard title="Total" value={shifts.length} />
        </div>
      </PageHeader>

      {status && !statusIsBusy && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Shifts Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Shifts
          </CardTitle>
          <CardDescription>Latest shifts first. Click any row to inspect its cash movements.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={shiftColumns}
            data={shifts}
            isLoading={loadingShifts}
            searchPlaceholder="Search device / status / id"
            onRowClick={(row) => setSelectedShiftId(row.id)}
          />
        </CardContent>
      </Card>

      {/* Cash Movements */}
      <Card>
        <CardHeader>
          <CardTitle>Cash Movements</CardTitle>
          <CardDescription>
            {selectedShift ? (
              <span className="flex flex-wrap items-center gap-2">
                <span>
                  Shift: <span className="font-mono text-sm">{selectedShiftId.slice(0, 8)}...</span>
                </span>
                <span className="text-muted-foreground">|</span>
                <span>
                  Device: <span className="font-mono text-sm">{selectedDeviceCode}</span>
                </span>
                <span className="text-muted-foreground">|</span>
                <StatusBadge status={selectedShift.status} />
              </span>
            ) : (
              "Select a shift to view cash movements."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Shift Summary */}
          {selectedShift && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">Selected Shift Summary</div>
                  <div className="text-xs text-muted-foreground">Cash values are in USD for quick reconciliation checks.</div>
                </div>
                <StatusBadge status={selectedShift.status} />
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Device</div>
                  <div className="font-mono text-sm font-medium">{selectedDeviceCode}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Opened</div>
                  <div className="font-mono text-sm font-medium">{formatDateTime(selectedShift.opened_at)}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Closed</div>
                  <div className="font-mono text-sm font-medium">{formatDateOrDash(selectedShift.closed_at)}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Opening USD</div>
                  <div className="font-mono text-sm font-medium">{formatUsd(selectedShift.opening_cash_usd)}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Expected USD</div>
                  <div className="font-mono text-sm font-medium">{formatUsd(selectedShift.expected_cash_usd, { blankWhenNull: true })}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Close USD</div>
                  <div className="font-mono text-sm font-medium">{formatUsd(selectedShift.closing_cash_usd, { blankWhenNull: true })}</div>
                </div>
              </div>
            </div>
          )}

          {/* Close Form */}
          {selectedShift && selectedShiftIsOpen && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">Close Selected Shift</div>
                  <div className="text-xs text-muted-foreground">Enter counted cash, then close this shift from web admin.</div>
                </div>
                <Button variant="ghost" size="sm" onClick={loadExpectedIntoCloseForm} disabled={closingShift}>
                  Use Expected Cash
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Closing Cash (USD)</label>
                  <Input type="number" min={0} step="0.01" inputMode="decimal" value={closingCashUsd} onChange={(e) => setClosingCashUsd(e.target.value)} disabled={closingShift} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Closing Cash (LBP)</label>
                  <Input type="number" min={0} step="1" inputMode="numeric" value={closingCashLbp} onChange={(e) => setClosingCashLbp(e.target.value)} disabled={closingShift} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
                <Textarea value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} disabled={closingShift} placeholder="Shift close notes" className="min-h-20" />
              </div>
              <div className="flex justify-end">
                <Button variant="destructive" onClick={closeSelectedShift} disabled={closingShift}>
                  {closingShift ? "Closing..." : "Close Shift"}
                </Button>
              </div>
            </div>
          )}

          {/* Reconciliation */}
          {recon && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="text-sm font-medium">Cash Reconciliation</div>
              <div className="text-xs text-muted-foreground">
                Formula: Expected = Opening + Cash Sales - Cash Refunds + Cash Movements (net)
              </div>
              <div className="text-xs text-muted-foreground">
                Cash methods: <span className="font-mono">{(recon.cash_methods || []).length ? recon.cash_methods.join(", ") : "none"}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Opening</div>
                  <div className="font-mono text-sm font-medium">USD {formatUsd(recon.shift.opening_cash_usd)}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Cash Sales</div>
                  <div className="font-mono text-sm font-medium">USD {formatUsd(recon.sales_cash_usd)}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Cash Refunds</div>
                  <div className="font-mono text-sm font-medium">USD {formatUsd(recon.refunds_cash_usd)}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Movements (net)</div>
                  <div className="font-mono text-sm font-medium">USD {formatUsdSigned(recon.cash_movements_net_usd)}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Expected (computed)</div>
                  <div className="font-mono text-sm font-medium">USD {formatUsd(recon.expected_computed_usd)}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Closing (counted)</div>
                  <div className="font-mono text-sm font-medium">USD {formatUsd(recon.shift.closing_cash_usd, { blankWhenNull: true })}</div>
                </div>
              </div>
            </div>
          )}

          {/* Movement Limit Controls */}
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="w-full space-y-1.5 md:w-56">
                <label className="text-xs font-medium text-muted-foreground">Movements to load</label>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  inputMode="numeric"
                  value={movementsLimit}
                  onChange={(e) => setMovementsLimit(e.target.value.replace(/[^0-9]/g, ""))}
                  onBlur={() => setMovementsLimit(normalizeMovementsLimit(movementsLimit))}
                />
                <div className="text-xs text-muted-foreground">Use smaller values for faster loading on busy shifts.</div>
              </div>
              <div className="flex items-center gap-2">
                {[100, 200, 500].map((n) => (
                  <Button key={n} variant={movementsLimit === String(n) ? "secondary" : "ghost"} size="sm" onClick={() => setMovementsLimit(String(n))}>
                    {n}
                  </Button>
                ))}
                <Button variant="outline" size="sm" onClick={() => loadMovements(selectedShiftId)} disabled={!selectedShiftId || loadingMovements}>
                  {loadingMovements ? "Refreshing..." : "Refresh Movements"}
                </Button>
              </div>
            </div>
          </div>

          {/* Movements Table */}
          <DataTable
            columns={movementColumns}
            data={movements}
            isLoading={loadingMovements}
            searchPlaceholder="Search device / type / notes"
          />
        </CardContent>
      </Card>
    </div>
  );
}
