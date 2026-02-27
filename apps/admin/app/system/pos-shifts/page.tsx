"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, RefreshCw } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { KpiCard } from "@/components/business/kpi-card";
import { MasterDetailLayout } from "@/components/business/master-detail-layout";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ShiftDetailPanel } from "./_components/shift-detail-panel";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatUsd(value: unknown, { blankWhenNull = false } = {}) {
  if (blankWhenNull && (value === null || value === undefined || value === "")) return "-";
  return toNumber(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatUsdSigned(value: unknown) {
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

function toInputCash(value: unknown): string {
  if (value === null || value === undefined || value === "") return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(n);
}

/* -------------------------------------------------------------------------- */
/*  Main page                                                                 */
/* -------------------------------------------------------------------------- */

export default function PosShiftsPage() {
  /* ---- List state ---- */
  const [status, setStatus] = useState("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  /* ---- Detail panel state ---- */
  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [sheetOpen, setSheetOpen] = useState(false);
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

  /* ---- Derived ---- */
  const deviceById = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const selectedShift = useMemo(() => shifts.find((s) => s.id === selectedShiftId) || null, [shifts, selectedShiftId]);
  const selectedDeviceCode = selectedShift ? deviceById.get(selectedShift.device_id)?.device_code || selectedShift.device_id : "";
  const selectedShiftIsOpen = String(selectedShift?.status || "").toLowerCase() === "open";
  const openShiftCount = useMemo(() => shifts.filter((s) => String(s.status).toLowerCase() === "open").length, [shifts]);
  const closedShiftCount = Math.max(0, shifts.length - openShiftCount);

  /* ---- Table columns ---- */
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
    ],
    [deviceById],
  );

  /* ---- Data loading ---- */
  const load = useCallback(async () => {
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
  }, []);

  const loadMovements = useCallback(async (shiftId: string, limit?: string) => {
    if (!shiftId) {
      setMovements([]);
      setRecon(null);
      return;
    }
    setStatus("Loading cash movements...");
    try {
      const qs = new URLSearchParams();
      qs.set("shift_id", shiftId);
      qs.set("limit", limit || movementsLimit);
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
  }, [movementsLimit]);

  /* ---- Close form helpers ---- */
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

  /* ---- Row click → open sheet ---- */
  function handleRowClick(row: ShiftRow) {
    setSelectedShiftId(row.id);
    setSheetOpen(true);
  }

  /* ---- Effects ---- */
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selectedShiftId) {
      loadMovements(selectedShiftId);
    } else {
      setMovements([]);
      setRecon(null);
    }
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

  /* ---- Sheet close handler ---- */
  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      // Keep selection so user can reopen, but don't clear data
    }
  }

  /* ---- Error display ---- */
  const isError = status && !statusIsBusy;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
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

      {isError && (
        <Banner
          variant="danger"
          title="Error"
          description={status}
          actions={
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          }
        />
      )}

      {/* Master-Detail: Shifts table + Side panel */}
      <MasterDetailLayout
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        title={selectedShift ? `Shift — ${selectedDeviceCode}` : "Shift Details"}
        description={
          selectedShift
            ? `Opened ${formatDateTime(selectedShift.opened_at)} · ${selectedShift.status}`
            : undefined
        }
        sheetClassName="sm:max-w-2xl"
        detail={
          selectedShift ? (
            <ShiftDetailPanel
              shift={selectedShift}
              deviceCode={selectedDeviceCode}
              recon={recon}
              movements={movements}
              loadingMovements={loadingMovements}
              closingShift={closingShift}
              closingCashUsd={closingCashUsd}
              closingCashLbp={closingCashLbp}
              closingNotes={closingNotes}
              onClosingCashUsdChange={setClosingCashUsd}
              onClosingCashLbpChange={setClosingCashLbp}
              onClosingNotesChange={setClosingNotes}
              onLoadExpected={loadExpectedIntoCloseForm}
              onCloseShift={closeSelectedShift}
              movementsLimit={movementsLimit}
              onMovementsLimitChange={setMovementsLimit}
              onRefreshMovements={() => loadMovements(selectedShiftId)}
            />
          ) : null
        }
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Shifts
            </CardTitle>
            <CardDescription>Click any row to inspect details, movements, and reconciliation.</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={shiftColumns}
              data={shifts}
              isLoading={loadingShifts}
              searchPlaceholder="Search device / status / id"
              onRowClick={handleRowClick}
            />
          </CardContent>
        </Card>
      </MasterDetailLayout>
    </div>
  );
}
