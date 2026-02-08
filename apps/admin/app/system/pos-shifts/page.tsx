"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-fg-muted">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Shifts</CardTitle>
            <CardDescription>{shifts.length} shifts (latest first)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Opened</th>
                    <th className="px-3 py-2">Device</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Open USD</th>
                    <th className="px-3 py-2 text-right">Expected USD</th>
                    <th className="px-3 py-2 text-right">Close USD</th>
                    <th className="px-3 py-2 text-right">Var USD</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((s) => {
                    const d = deviceById.get(s.device_id);
                    const active = selectedShiftId === s.id;
                    return (
                      <tr key={s.id} className="ui-tr-hover">
                        <td className="px-3 py-2 font-mono text-xs">{s.opened_at}</td>
                        <td className="px-3 py-2 font-mono text-xs">{d?.device_code || s.device_id}</td>
                        <td className="px-3 py-2 font-mono text-xs">{s.status}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{Number(s.opening_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{Number(s.expected_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{Number(s.closing_cash_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{Number(s.variance_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 text-right">
                          <Button variant={active ? "secondary" : "outline"} size="sm" onClick={() => setSelectedShiftId(s.id)}>
                            Cash Movements
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {shifts.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={8}>
                        No shifts.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cash Movements</CardTitle>
            <CardDescription>
              {selectedShiftId ? (
                <span>
                  Shift: <span className="font-mono text-xs">{selectedShiftId}</span>
                </span>
              ) : (
                "Select a shift to view cash movements."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recon ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cash Reconciliation</CardTitle>
                  <CardDescription>
                    Cash methods:{" "}
                    <span className="font-mono text-xs">
                      {(recon.cash_methods || []).length ? recon.cash_methods.join(", ") : "none"}
                    </span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                </CardContent>
              </Card>
            ) : null}

            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="w-full md:w-56">
                <label className="text-xs font-medium text-fg-muted">Limit</label>
                <Input value={movementsLimit} onChange={(e) => setMovementsLimit(e.target.value)} />
              </div>
              <Button variant="outline" onClick={() => loadMovements(selectedShiftId)} disabled={!selectedShiftId}>
                Refresh Movements
              </Button>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Device</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">USD</th>
                    <th className="px-3 py-2 text-right">LL</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-t border-border-subtle align-top">
                      <td className="px-3 py-2 font-mono text-xs">{m.created_at}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.device_code}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.movement_type}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(m.amount_usd || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{Number(m.amount_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{m.notes || "-"}</td>
                    </tr>
                  ))}
                  {movements.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-fg-subtle" colSpan={6}>
                        No cash movements.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}
