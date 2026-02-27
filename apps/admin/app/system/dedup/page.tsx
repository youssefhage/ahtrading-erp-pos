"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitMerge, RefreshCw, Users } from "lucide-react";

import { apiGet, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { CustomerTypeahead, type CustomerTypeaheadCustomer } from "@/components/customer-typeahead";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DupGroup<T> = { key: string; n: number; customers?: T[]; suppliers?: T[] };

export default function DedupPage() {
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [customerDupEmail, setCustomerDupEmail] = useState<Array<DupGroup<CustomerTypeaheadCustomer>>>([]);
  const [customerDupPhone, setCustomerDupPhone] = useState<Array<DupGroup<CustomerTypeaheadCustomer>>>([]);
  const [supplierDupEmail, setSupplierDupEmail] = useState<Array<DupGroup<SupplierTypeaheadSupplier>>>([]);
  const [supplierDupPhone, setSupplierDupPhone] = useState<Array<DupGroup<SupplierTypeaheadSupplier>>>([]);

  const [srcCustomer, setSrcCustomer] = useState<CustomerTypeaheadCustomer | null>(null);
  const [tgtCustomer, setTgtCustomer] = useState<CustomerTypeaheadCustomer | null>(null);
  const [customerReason, setCustomerReason] = useState("");
  const [customerPreview, setCustomerPreview] = useState<any>(null);
  const [customerBusy, setCustomerBusy] = useState(false);

  const [srcSupplier, setSrcSupplier] = useState<SupplierTypeaheadSupplier | null>(null);
  const [tgtSupplier, setTgtSupplier] = useState<SupplierTypeaheadSupplier | null>(null);
  const [supplierReason, setSupplierReason] = useState("");
  const [supplierPreview, setSupplierPreview] = useState<any>(null);
  const [supplierBusy, setSupplierBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    setStatus("");
    try {
      const [c, s] = await Promise.all([
        apiGet<{ by_email: any[]; by_phone: any[] }>("/customers/duplicates").catch(() => ({ by_email: [], by_phone: [] })),
        apiGet<{ by_email: any[]; by_phone: any[] }>("/suppliers/duplicates").catch(() => ({ by_email: [], by_phone: [] })),
      ]);
      setCustomerDupEmail((c.by_email || []) as any);
      setCustomerDupPhone((c.by_phone || []) as any);
      setSupplierDupEmail((s.by_email || []) as any);
      setSupplierDupPhone((s.by_phone || []) as any);
      setStatus("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const customerDupCount = useMemo(() => (customerDupEmail?.length || 0) + (customerDupPhone?.length || 0), [customerDupEmail, customerDupPhone]);
  const supplierDupCount = useMemo(() => (supplierDupEmail?.length || 0) + (supplierDupPhone?.length || 0), [supplierDupEmail, supplierDupPhone]);

  async function previewCustomerMerge() {
    if (!srcCustomer?.id || !tgtCustomer?.id) return setStatus("Pick source and target customers.");
    if (srcCustomer.id === tgtCustomer.id) return setStatus("Source and target must differ.");
    setCustomerBusy(true);
    setStatus("");
    try {
      const res = await apiPost<any>("/customers/merge/preview", {
        source_customer_id: srcCustomer.id,
        target_customer_id: tgtCustomer.id,
      });
      setCustomerPreview(res);
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomerBusy(false);
    }
  }

  async function executeCustomerMerge() {
    if (!srcCustomer?.id || !tgtCustomer?.id) return setStatus("Pick source and target customers.");
    if (srcCustomer.id === tgtCustomer.id) return setStatus("Source and target must differ.");
    if (!window.confirm(`Merge customer ${srcCustomer.name} into ${tgtCustomer.name}? This cannot be undone.`)) return;
    setCustomerBusy(true);
    setStatus("");
    try {
      await apiPost("/customers/merge", {
        source_customer_id: srcCustomer.id,
        target_customer_id: tgtCustomer.id,
        reason: customerReason.trim() || null,
      });
      setSrcCustomer(null);
      setTgtCustomer(null);
      setCustomerReason("");
      setCustomerPreview(null);
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomerBusy(false);
    }
  }

  async function previewSupplierMerge() {
    if (!srcSupplier?.id || !tgtSupplier?.id) return setStatus("Pick source and target suppliers.");
    if (srcSupplier.id === tgtSupplier.id) return setStatus("Source and target must differ.");
    setSupplierBusy(true);
    setStatus("");
    try {
      const res = await apiPost<any>("/suppliers/merge/preview", {
        source_supplier_id: srcSupplier.id,
        target_supplier_id: tgtSupplier.id,
      });
      setSupplierPreview(res);
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSupplierBusy(false);
    }
  }

  async function executeSupplierMerge() {
    if (!srcSupplier?.id || !tgtSupplier?.id) return setStatus("Pick source and target suppliers.");
    if (srcSupplier.id === tgtSupplier.id) return setStatus("Source and target must differ.");
    if (!window.confirm(`Merge supplier ${srcSupplier.name} into ${tgtSupplier.name}? This cannot be undone.`)) return;
    setSupplierBusy(true);
    setStatus("");
    try {
      await apiPost("/suppliers/merge", {
        source_supplier_id: srcSupplier.id,
        target_supplier_id: tgtSupplier.id,
        reason: supplierReason.trim() || null,
      });
      setSrcSupplier(null);
      setTgtSupplier(null);
      setSupplierReason("");
      setSupplierPreview(null);
      await load();
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSupplierBusy(false);
    }
  }

  function renderGroups<T extends { id: string; name: string }>(groups: Array<DupGroup<T>>, kind: "customers" | "suppliers") {
    if (!groups?.length) return <div className="text-xs text-muted-foreground">No duplicates found.</div>;
    return (
      <div className="space-y-2">
        {groups.slice(0, 30).map((g) => {
          const rows = (kind === "customers" ? (g.customers || []) : (g.suppliers || [])) as T[];
          return (
            <details key={`${kind}:${g.key}`} className="rounded-md border bg-muted/30 p-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                <span className="font-mono">{g.key}</span> <span className="text-muted-foreground">({g.n})</span>
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-1">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="truncate">
                      <span className="text-foreground">{r.name}</span>{" "}
                      <span className="font-mono text-muted-foreground">{r.id}</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Dedup / Merge"
        description="Merge duplicate customers and suppliers safely (with preview)."
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading || customerBusy || supplierBusy}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {status && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {err && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{err}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Customer section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Customer Duplicates
            </CardTitle>
            <CardDescription>{customerDupCount} duplicate groups (email/phone)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">By Email</div>
                {renderGroups(customerDupEmail as any, "customers")}
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">By Phone</div>
                {renderGroups(customerDupPhone as any, "customers")}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitMerge className="h-4 w-4" />
              Customer Merge Tool
            </CardTitle>
            <CardDescription>Pick the source to merge into the target.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Source Customer</div>
              <CustomerTypeahead
                disabled={customerBusy}
                placeholder="Search customer..."
                onSelect={(c) => setSrcCustomer(c)}
                onClear={() => setSrcCustomer(null)}
              />
              {srcCustomer ? <div className="text-xs text-muted-foreground font-mono">{srcCustomer.id}</div> : null}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Target Customer</div>
              <CustomerTypeahead
                disabled={customerBusy}
                placeholder="Search customer..."
                onSelect={(c) => setTgtCustomer(c)}
                onClear={() => setTgtCustomer(null)}
              />
              {tgtCustomer ? <div className="text-xs text-muted-foreground font-mono">{tgtCustomer.id}</div> : null}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Reason (optional)</div>
              <Input value={customerReason} onChange={(e) => setCustomerReason(e.target.value)} disabled={customerBusy} placeholder="e.g. duplicate import" />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={previewCustomerMerge} disabled={customerBusy}>
                Preview
              </Button>
              <Button onClick={executeCustomerMerge} disabled={customerBusy}>
                Merge
              </Button>
            </div>
            {customerPreview ? (
              <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                {JSON.stringify(customerPreview, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Supplier section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Supplier Duplicates
            </CardTitle>
            <CardDescription>{supplierDupCount} duplicate groups (email/phone)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">By Email</div>
                {renderGroups(supplierDupEmail as any, "suppliers")}
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">By Phone</div>
                {renderGroups(supplierDupPhone as any, "suppliers")}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitMerge className="h-4 w-4" />
              Supplier Merge Tool
            </CardTitle>
            <CardDescription>Pick the source to merge into the target.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Source Supplier</div>
              <SupplierTypeahead
                disabled={supplierBusy}
                placeholder="Search supplier..."
                onSelect={(s) => setSrcSupplier(s)}
                onClear={() => setSrcSupplier(null)}
              />
              {srcSupplier ? <div className="text-xs text-muted-foreground font-mono">{srcSupplier.id}</div> : null}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Target Supplier</div>
              <SupplierTypeahead
                disabled={supplierBusy}
                placeholder="Search supplier..."
                onSelect={(s) => setTgtSupplier(s)}
                onClear={() => setTgtSupplier(null)}
              />
              {tgtSupplier ? <div className="text-xs text-muted-foreground font-mono">{tgtSupplier.id}</div> : null}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Reason (optional)</div>
              <Input value={supplierReason} onChange={(e) => setSupplierReason(e.target.value)} disabled={supplierBusy} placeholder="e.g. same vendor, two records" />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={previewSupplierMerge} disabled={supplierBusy}>
                Preview
              </Button>
              <Button onClick={executeSupplierMerge} disabled={supplierBusy}>
                Merge
              </Button>
            </div>
            {supplierPreview ? (
              <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                {JSON.stringify(supplierPreview, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
