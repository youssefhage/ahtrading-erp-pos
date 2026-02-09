"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CoaAccount = {
  id: string;
  account_code: string;
  name_en: string | null;
};

type DimensionRow = { id: string; code: string; name: string; is_active: boolean };

type LineDraft = {
  key: string;
  side: "debit" | "credit";
  account_code: string;
  account_id: string | null;
  memo: string;
  amount_usd: string;
  amount_lbp: string;
  cost_center_id: string;
  project_id: string;
};

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number, frac: number) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

export default function JournalTemplateNewPage() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [costCenters, setCostCenters] = useState<DimensionRow[]>([]);
  const [projects, setProjects] = useState<DimensionRow[]>([]);

  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [defaultRateType, setDefaultRateType] = useState("market");

  const [lines, setLines] = useState<LineDraft[]>([
    { key: "l1", side: "debit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "", cost_center_id: "", project_id: "" },
    { key: "l2", side: "credit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "", cost_center_id: "", project_id: "" }
  ]);

  const [saving, setSaving] = useState(false);

  const accountByCode = useMemo(() => {
    const m = new Map<string, CoaAccount>();
    for (const a of accounts) m.set(a.account_code, a);
    return m;
  }, [accounts]);

  const totals = useMemo(() => {
    let dUsd = 0;
    let cUsd = 0;
    let dLbp = 0;
    let cLbp = 0;
    for (const l of lines) {
      const usd = toNum(l.amount_usd);
      const lbp = toNum(l.amount_lbp);
      if (l.side === "debit") {
        dUsd += usd;
        dLbp += lbp;
      } else {
        cUsd += usd;
        cLbp += lbp;
      }
    }
    return { dUsd, cUsd, dLbp, cLbp, diffUsd: dUsd - cUsd, diffLbp: dLbp - cLbp };
  }, [lines]);

  const balanced = useMemo(() => Math.abs(totals.diffUsd) < 0.0001 && Math.abs(totals.diffLbp) < 0.01, [totals]);

  const load = useCallback(async () => {
    setStatus("Loading...");
    try {
      const [a, cc, pr] = await Promise.all([
        apiGet<{ accounts: CoaAccount[] }>("/coa/accounts"),
        apiGet<{ cost_centers: DimensionRow[] }>("/dimensions/cost-centers"),
        apiGet<{ projects: DimensionRow[] }>("/dimensions/projects")
      ]);
      setAccounts(a.accounts || []);
      setCostCenters(cc.cost_centers || []);
      setProjects(pr.projects || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function onAccountCodeChange(idx: number, code: string) {
    const normalized = (code || "").trim();
    const acc = accountByCode.get(normalized);
    updateLine(idx, { account_code: normalized, account_id: acc?.id || null });
  }

  function addLine(side: "debit" | "credit") {
    setLines((prev) => [
      ...prev,
      { key: `l-${Date.now()}-${prev.length + 1}`, side, account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "", cost_center_id: "", project_id: "" }
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setStatus("name is required");
    if (!balanced) return setStatus("template must be balanced (debits == credits)");

    setSaving(true);
    setStatus("Saving...");
    try {
      const payload = {
        name: name.trim(),
        memo: memo.trim() || null,
        is_active: isActive,
        default_rate_type: defaultRateType,
        lines: lines
          .filter((l) => l.account_id && (toNum(l.amount_usd) !== 0 || toNum(l.amount_lbp) !== 0))
          .map((l) => ({
            account_id: l.account_id,
            side: l.side,
            amount_usd: Number(l.amount_usd || 0),
            amount_lbp: Number(l.amount_lbp || 0),
            memo: l.memo.trim() || null,
            cost_center_id: l.cost_center_id || null,
            project_id: l.project_id || null
          }))
      };
      const res = await apiPost<{ id: string }>("/accounting/journal-templates", payload);
      router.push(`/accounting/journal-templates/${encodeURIComponent(res.id)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>New Journal Template</CardTitle>
          <CardDescription>Balanced template that can be instantiated into journals.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-fg-muted">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly rent accrual" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted">Default Rate Type</label>
                <select className="ui-select w-full" value={defaultRateType} onChange={(e) => setDefaultRateType(e.target.value)}>
                  <option value="market">market</option>
                  <option value="official">official</option>
                  <option value="internal">internal</option>
                </select>
              </div>
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-fg-muted">Memo</label>
                <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional memo..." />
              </div>
              <div className="flex items-center gap-2 md:col-span-3">
                <input
                  id="active"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <label htmlFor="active" className="text-xs text-fg-muted">
                  Active
                </label>
              </div>
            </div>

            <div className="rounded-md border border-border bg-bg-elevated p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">Lines</div>
                  <div className="text-xs text-fg-muted">Use account codes. Template must balance.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => addLine("debit")}>
                    + Debit
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => addLine("credit")}>
                    + Credit
                  </Button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {lines.map((l, idx) => (
                  <div key={l.key} className="grid grid-cols-1 gap-2 rounded-md border border-border-subtle bg-bg-sunken p-2 md:grid-cols-[110px_160px_1fr_160px_160px_150px_150px_40px]">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-fg-muted">Side</label>
                      <select
                        className="ui-select w-full"
                        value={l.side}
                        onChange={(e) => updateLine(idx, { side: e.target.value as any })}
                      >
                        <option value="debit">debit</option>
                        <option value="credit">credit</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-fg-muted">Account</label>
                      <Input value={l.account_code} onChange={(e) => onAccountCodeChange(idx, e.target.value)} placeholder="4010" />
                      {!l.account_id && l.account_code ? (
                        <div className="text-[11px] text-danger">Unknown code</div>
                      ) : null}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-fg-muted">Memo</label>
                      <Input value={l.memo} onChange={(e) => updateLine(idx, { memo: e.target.value })} placeholder="Optional..." />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-fg-muted">Amount USD</label>
                      <Input value={l.amount_usd} onChange={(e) => updateLine(idx, { amount_usd: e.target.value })} inputMode="decimal" />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-fg-muted">Amount LL</label>
                      <Input value={l.amount_lbp} onChange={(e) => updateLine(idx, { amount_lbp: e.target.value })} inputMode="decimal" />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-fg-muted">Cost Center</label>
                      <select className="ui-select w-full" value={l.cost_center_id} onChange={(e) => updateLine(idx, { cost_center_id: e.target.value })}>
                        <option value="">(none)</option>
                        {costCenters.filter((c) => c.is_active).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code} · {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-fg-muted">Project</label>
                      <select className="ui-select w-full" value={l.project_id} onChange={(e) => updateLine(idx, { project_id: e.target.value })}>
                        <option value="">(none)</option>
                        {projects.filter((p) => p.is_active).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} · {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-end justify-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(l.key)} title="Remove line">
                        ×
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-fg-muted">
                  Debits: <span className="data-mono">{fmt(totals.dUsd, 4)} USD</span> /{" "}
                  <span className="data-mono">{fmt(totals.dLbp, 2)} LL</span>
                  {"  "}Credits: <span className="data-mono">{fmt(totals.cUsd, 4)} USD</span> /{" "}
                  <span className="data-mono">{fmt(totals.cLbp, 2)} LL</span>
                </div>
                <div className={balanced ? "text-fg-muted" : "text-danger"}>
                  Diff: <span className="data-mono">{fmt(totals.diffUsd, 4)} USD</span> /{" "}
                  <span className="data-mono">{fmt(totals.diffLbp, 2)} LL</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.push("/accounting/journal-templates/list")}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Create Template"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

