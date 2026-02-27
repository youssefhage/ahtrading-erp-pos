"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";

import { formatDateTime } from "@/lib/datetime";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { StatusBadge } from "@/components/business/status-badge";
import { ConfirmDialog } from "@/components/business/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

/* -------------------------------------------------------------------------- */
/*  Small sub-component: stat cell                                            */
/* -------------------------------------------------------------------------- */

function StatCell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-medium ${className || ""}`}>{value}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Props                                                                     */
/* -------------------------------------------------------------------------- */

export interface ShiftDetailPanelProps {
  shift: ShiftRow;
  deviceCode: string;
  recon: CashRecon | null;
  movements: CashMovementRow[];
  loadingMovements: boolean;
  closingShift: boolean;

  /* Close form state */
  closingCashUsd: string;
  closingCashLbp: string;
  closingNotes: string;
  onClosingCashUsdChange: (v: string) => void;
  onClosingCashLbpChange: (v: string) => void;
  onClosingNotesChange: (v: string) => void;
  onLoadExpected: () => void;
  onCloseShift: () => Promise<void>;

  /* Movement controls */
  movementsLimit: string;
  onMovementsLimitChange: (v: string) => void;
  onRefreshMovements: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function ShiftDetailPanel({
  shift,
  deviceCode,
  recon,
  movements,
  loadingMovements,
  closingShift,
  closingCashUsd,
  closingCashLbp,
  closingNotes,
  onClosingCashUsdChange,
  onClosingCashLbpChange,
  onClosingNotesChange,
  onLoadExpected,
  onCloseShift,
  movementsLimit,
  onMovementsLimitChange,
  onRefreshMovements,
}: ShiftDetailPanelProps) {
  const isOpen = String(shift.status || "").toLowerCase() === "open";

  /* ---- Movement columns ---- */
  const movementColumns = useMemo<ColumnDef<CashMovementRow>[]>(
    () => [
      {
        id: "created_at",
        accessorFn: (m) => m.created_at,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />,
        cell: ({ row }) => <span className="font-mono text-xs">{formatDateTime(row.original.created_at)}</span>,
      },
      {
        id: "device_code",
        accessorFn: (m) => m.device_code,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Device" />,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.device_code}</span>,
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
          const cls = amount === 0 ? "text-muted-foreground" : amount < 0 ? "text-destructive" : "text-success";
          return <span className={`font-mono text-xs ${cls}`}>{formatUsdSigned(amount)}</span>;
        },
      },
      {
        id: "amount_lbp",
        accessorFn: (m) => toNumber(m.amount_lbp),
        header: ({ column }) => <DataTableColumnHeader column={column} title="LL" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{toNumber(row.original.amount_lbp).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
        ),
      },
      {
        id: "notes",
        accessorFn: (m) => m.notes || "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Notes" />,
        cell: ({ row }) => <span className="text-xs text-muted-foreground truncate max-w-[200px] block">{row.original.notes || "-"}</span>,
      },
    ],
    [],
  );

  /* ---- Determine default tab ---- */
  const defaultTab = isOpen ? "summary" : "summary";

  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="summary">Summary</TabsTrigger>
        {isOpen && <TabsTrigger value="close">Close Shift</TabsTrigger>}
        <TabsTrigger value="movements">
          Movements
          {movements.length > 0 && (
            <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 py-0.5 text-[10px] font-medium">
              {movements.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      {/* ── Summary Tab ── */}
      <TabsContent value="summary" className="space-y-4">
        {/* Shift Info Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Shift Details</h4>
            <StatusBadge status={shift.status} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCell label="Device" value={deviceCode} />
            <StatCell label="Opened" value={formatDateTime(shift.opened_at)} />
            <StatCell label="Closed" value={formatDateOrDash(shift.closed_at)} />
            <StatCell label="Opening USD" value={formatUsd(shift.opening_cash_usd)} />
            <StatCell label="Expected USD" value={formatUsd(shift.expected_cash_usd, { blankWhenNull: true })} />
            <StatCell label="Closing USD" value={formatUsd(shift.closing_cash_usd, { blankWhenNull: true })} />
          </div>
        </div>

        {/* Variance highlight */}
        {shift.variance_usd !== null && shift.variance_usd !== undefined && shift.variance_usd !== "" && (
          <Card className={toNumber(shift.variance_usd) === 0 ? "border-muted" : toNumber(shift.variance_usd) < 0 ? "border-destructive/40 bg-destructive/5" : "border-success/40 bg-success/5"}>
            <CardContent className="flex items-center justify-between py-3">
              <span className="text-sm font-medium">Variance (USD)</span>
              <span className={`font-mono text-lg font-semibold ${toNumber(shift.variance_usd) === 0 ? "text-muted-foreground" : toNumber(shift.variance_usd) < 0 ? "text-destructive" : "text-success"}`}>
                {formatUsdSigned(shift.variance_usd)}
              </span>
            </CardContent>
          </Card>
        )}

        {/* Reconciliation */}
        {recon && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Cash Reconciliation</h4>
            <p className="text-xs text-muted-foreground">
              Expected = Opening + Cash Sales &minus; Cash Refunds + Movements (net)
            </p>
            {(recon.cash_methods || []).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Cash methods: <span className="font-mono">{recon.cash_methods.join(", ")}</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <StatCell label="Opening" value={`USD ${formatUsd(recon.shift.opening_cash_usd)}`} />
              <StatCell label="Cash Sales" value={`USD ${formatUsd(recon.sales_cash_usd)}`} />
              <StatCell label="Cash Refunds" value={`USD ${formatUsd(recon.refunds_cash_usd)}`} />
              <StatCell label="Movements (net)" value={`USD ${formatUsdSigned(recon.cash_movements_net_usd)}`} />
              <StatCell label="Expected (computed)" value={`USD ${formatUsd(recon.expected_computed_usd)}`} className="font-semibold" />
              <StatCell label="Closing (counted)" value={`USD ${formatUsd(recon.shift.closing_cash_usd, { blankWhenNull: true })}`} />
            </div>
          </div>
        )}
      </TabsContent>

      {/* ── Close Shift Tab ── */}
      {isOpen && (
        <TabsContent value="close" className="space-y-4">
          <div className="space-y-1">
            <h4 className="text-sm font-medium">Close This Shift</h4>
            <p className="text-xs text-muted-foreground">Enter counted cash amounts, then close the shift from web admin.</p>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onLoadExpected} disabled={closingShift}>
              Use Expected Cash
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Closing Cash (USD)</label>
              <Input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={closingCashUsd}
                onChange={(e) => onClosingCashUsdChange(e.target.value)}
                disabled={closingShift}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Closing Cash (LBP)</label>
              <Input
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                value={closingCashLbp}
                onChange={(e) => onClosingCashLbpChange(e.target.value)}
                disabled={closingShift}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <Textarea
              value={closingNotes}
              onChange={(e) => onClosingNotesChange(e.target.value)}
              disabled={closingShift}
              placeholder="Shift close notes"
              className="min-h-20"
            />
          </div>

          <div className="flex justify-end">
            <ConfirmDialog
              title="Close Shift"
              description={`Close shift for device ${deviceCode || shift.device_id}? This action cannot be undone.`}
              confirmLabel={closingShift ? "Closing..." : "Close Shift"}
              variant="destructive"
              onConfirm={onCloseShift}
              trigger={
                <Button variant="destructive" disabled={closingShift}>
                  {closingShift ? "Closing..." : "Close Shift"}
                </Button>
              }
            />
          </div>
        </TabsContent>
      )}

      {/* ── Movements Tab ── */}
      <TabsContent value="movements" className="space-y-4">
        {/* Limit controls */}
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full space-y-1.5 sm:w-44">
              <label className="text-xs font-medium text-muted-foreground">Rows to load</label>
              <Input
                type="number"
                min={1}
                max={1000}
                inputMode="numeric"
                value={movementsLimit}
                onChange={(e) => onMovementsLimitChange(e.target.value.replace(/[^0-9]/g, ""))}
                onBlur={() => onMovementsLimitChange(normalizeMovementsLimit(movementsLimit))}
              />
            </div>
            <div className="flex items-center gap-2">
              {[100, 200, 500].map((n) => (
                <Button
                  key={n}
                  variant={movementsLimit === String(n) ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onMovementsLimitChange(String(n))}
                >
                  {n}
                </Button>
              ))}
              <Button variant="outline" size="sm" onClick={onRefreshMovements} disabled={loadingMovements} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${loadingMovements ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Movements DataTable */}
        <DataTable
          columns={movementColumns}
          data={movements}
          isLoading={loadingMovements}
          searchPlaceholder="Search device / type / notes"
        />
      </TabsContent>
    </Tabs>
  );
}
