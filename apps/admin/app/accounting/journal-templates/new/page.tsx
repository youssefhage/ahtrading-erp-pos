"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, X, Trash2 } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type CoaAccount = { id: string; account_code: string; name_en: string | null };
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function toNum(v: string) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(val: number, frac: number) {
  return Number(val || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function JournalTemplateNewPage() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [costCenters, setCostCenters] = useState<DimensionRow[]>([]);
  const [projects, setProjects] = useState<DimensionRow[]>([]);

  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [defaultRateType, setDefaultRateType] = useState("market");

  const [lines, setLines] = useState<LineDraft[]>([
    { key: "l1", side: "debit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "", cost_center_id: "", project_id: "" },
    { key: "l2", side: "credit", account_code: "", account_id: null, memo: "", amount_usd: "", amount_lbp: "", cost_center_id: "", project_id: "" },
  ]);

  const [saving, setSaving] = useState(false);
  const statusIsBusy = /^Saving\b/i.test(status);

  const accountByCode = useMemo(() => {
    const m = new Map<string, CoaAccount>();
    for (const a of accounts) m.set(a.account_code, a);
    return m;
  }, [accounts]);

  const totals = useMemo(() => {
    let dUsd = 0, cUsd = 0, dLbp = 0, cLbp = 0;
    for (const l of lines) {
      const usd = toNum(l.amount_usd);
      const lbp = toNum(l.amount_lbp);
      if (l.side === "debit") { dUsd += usd; dLbp += lbp; }
      else { cUsd += usd; cLbp += lbp; }
    }
    return { dUsd, cUsd, dLbp, cLbp, diffUsd: dUsd - cUsd, diffLbp: dLbp - cLbp };
  }, [lines]);

  const balanced = useMemo(
    () => Math.abs(totals.diffUsd) < 0.0001 && Math.abs(totals.diffLbp) < 0.01,
    [totals],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const [a, cc, pr] = await Promise.all([
        apiGet<{ accounts: CoaAccount[] }>("/coa/accounts"),
        apiGet<{ cost_centers: DimensionRow[] }>("/dimensions/cost-centers"),
        apiGet<{ projects: DimensionRow[] }>("/dimensions/projects"),
      ]);
      setAccounts(a.accounts || []);
      setCostCenters(cc.cost_centers || []);
      setProjects(pr.projects || []);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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
      {
        key: `l-${Date.now()}-${prev.length + 1}`,
        side,
        account_code: "",
        account_id: null,
        memo: "",
        amount_usd: "",
        amount_lbp: "",
        cost_center_id: "",
        project_id: "",
      },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setStatus("Name is required");
    if (!balanced) return setStatus("Template must be balanced (debits == credits)");

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
            project_id: l.project_id || null,
          })),
      };
      const res = await apiPost<{ id: string }>("/accounting/journal-templates", payload);
      router.push(`/accounting/journal-templates/${encodeURIComponent(res.id)}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="New Journal Template"
        description="Balanced template that can be instantiated into journals."
        backHref="/accounting/journal-templates/list"
      />

      {status && !statusIsBusy && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      )}

      <form onSubmit={save} className="space-y-6">
        {/* Header fields */}
        <Card>
          <CardHeader>
            <CardTitle>Template Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly rent accrual" />
              </div>
              <div className="space-y-2">
                <Label>Default Rate Type</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={defaultRateType}
                  onChange={(e) => setDefaultRateType(e.target.value)}
                >
                  <option value="market">market</option>
                  <option value="official">official</option>
                  <option value="internal">internal</option>
                </select>
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label>Memo</Label>
                <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional memo..." />
              </div>
              <div className="flex items-center gap-2 sm:col-span-3">
                <Checkbox
                  id="active"
                  checked={isActive}
                  onCheckedChange={(checked) => setIsActive(Boolean(checked))}
                />
                <Label htmlFor="active" className="text-sm">Active</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lines */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Lines</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Use account codes. Template must balance.</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={balanced ? "success" : "destructive"}>
                  {balanced ? "Balanced" : "Unbalanced"}
                </Badge>
                <Button type="button" variant="outline" size="sm" onClick={() => addLine("debit")}>
                  <Plus className="mr-1 h-3 w-3" />
                  Debit
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addLine("credit")}>
                  <Plus className="mr-1 h-3 w-3" />
                  Credit
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {lines.map((l, idx) => (
              <div
                key={l.key}
                className="grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-[110px_160px_1fr_140px_140px_140px_140px_40px]"
              >
                <div className="space-y-1">
                  <Label className="text-xs">Side</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={l.side}
                    onChange={(e) => updateLine(idx, { side: e.target.value as "debit" | "credit" })}
                  >
                    <option value="debit">debit</option>
                    <option value="credit">credit</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Account</Label>
                  <Input
                    className="h-9"
                    value={l.account_code}
                    onChange={(e) => onAccountCodeChange(idx, e.target.value)}
                    placeholder="4010"
                  />
                  {!l.account_id && l.account_code && (
                    <p className="text-xs text-destructive">Unknown code</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Memo</Label>
                  <Input className="h-9" value={l.memo} onChange={(e) => updateLine(idx, { memo: e.target.value })} placeholder="Optional..." />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Amount USD</Label>
                  <Input
                    className="h-9 font-mono"
                    value={l.amount_usd}
                    onChange={(e) => updateLine(idx, { amount_usd: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Amount LBP</Label>
                  <Input
                    className="h-9 font-mono"
                    value={l.amount_lbp}
                    onChange={(e) => updateLine(idx, { amount_lbp: e.target.value })}
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cost Center</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={l.cost_center_id}
                    onChange={(e) => updateLine(idx, { cost_center_id: e.target.value })}
                  >
                    <option value="">(none)</option>
                    {costCenters
                      .filter((c) => c.is_active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} - {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Project</Label>
                  <select
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={l.project_id}
                    onChange={(e) => updateLine(idx, { project_id: e.target.value })}
                  >
                    <option value="">(none)</option>
                    {projects
                      .filter((p) => p.is_active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} - {p.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex items-end justify-end">
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(l.key)} title="Remove line">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 px-4 py-3 text-xs">
              <div className="text-muted-foreground">
                Debits: <span className="font-mono">{fmt(totals.dUsd, 4)} USD</span> /{" "}
                <span className="font-mono">{fmt(totals.dLbp, 2)} LBP</span>
                {"  "}Credits: <span className="font-mono">{fmt(totals.cUsd, 4)} USD</span> /{" "}
                <span className="font-mono">{fmt(totals.cLbp, 2)} LBP</span>
              </div>
              <div className={balanced ? "text-muted-foreground" : "text-destructive"}>
                Diff: <span className="font-mono">{fmt(totals.diffUsd, 4)} USD</span> /{" "}
                <span className="font-mono">{fmt(totals.diffLbp, 2)} LBP</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.push("/accounting/journal-templates/list")}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button type="submit" disabled={saving || loading}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : "Create Template"}
          </Button>
        </div>
      </form>
    </div>
  );
}
