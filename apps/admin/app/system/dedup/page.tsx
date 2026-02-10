"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { CustomerTypeahead, type CustomerTypeaheadCustomer } from "@/components/customer-typeahead";
import { SupplierTypeahead, type SupplierTypeaheadSupplier } from "@/components/supplier-typeahead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DupGroup<T> = { key: string; n: number; customers?: T[]; suppliers?: T[] };

export default function DedupPage() {
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<unknown>(null);

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
    setErr(null);
    setStatus("Loading...");
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
      setErr(e);
      setStatus("");
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
    setStatus("Previewing customer merge...");
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
    setStatus("Merging customer...");
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
    setStatus("Previewing supplier merge...");
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
    setStatus("Merging supplier...");
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
    if (!groups?.length) return <div className="text-xs text-fg-subtle">No duplicates found.</div>;
    return (
      <div className="space-y-2">
        {groups.slice(0, 30).map((g) => {
          const rows = (kind === "customers" ? (g.customers || []) : (g.suppliers || [])) as T[];
          return (
            <details key={`${kind}:${g.key}`} className="rounded-md border border-border-subtle bg-bg-elevated/30 p-2">
              <summary className="cursor-pointer text-xs text-fg-muted">
                <span className="font-mono">{g.key}</span> <span className="text-fg-subtle">({g.n})</span>
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-1">
                {rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="truncate">
                      <span className="text-foreground">{r.name}</span>{" "}
                      <span className="font-mono text-fg-subtle">{r.id}</span>
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
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dedup / Merge</h1>
          <p className="text-sm text-fg-muted">Merge duplicate customers and suppliers safely (with preview).</p>
        </div>
        <Button variant="outline" onClick={load}>
          Refresh
        </Button>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}
      {err ? <ErrorBanner error={err} onRetry={load} /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer Duplicates</CardTitle>
            <CardDescription>{customerDupCount} duplicate groups (email/phone)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs font-medium text-fg-muted">By Email</div>
                {renderGroups(customerDupEmail as any, "customers")}
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-fg-muted">By Phone</div>
                {renderGroups(customerDupPhone as any, "customers")}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer Merge Tool</CardTitle>
            <CardDescription>Pick the source to merge into the target.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-fg-muted">Source Customer</div>
              <CustomerTypeahead
                disabled={customerBusy}
                placeholder="Search customer..."
                onSelect={(c) => setSrcCustomer(c)}
                onClear={() => setSrcCustomer(null)}
              />
              {srcCustomer ? <div className="text-xs text-fg-subtle font-mono">{srcCustomer.id}</div> : null}
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-fg-muted">Target Customer</div>
              <CustomerTypeahead
                disabled={customerBusy}
                placeholder="Search customer..."
                onSelect={(c) => setTgtCustomer(c)}
                onClear={() => setTgtCustomer(null)}
              />
              {tgtCustomer ? <div className="text-xs text-fg-subtle font-mono">{tgtCustomer.id}</div> : null}
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-fg-muted">Reason (optional)</div>
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
              <pre className="max-h-80 overflow-auto rounded-md border border-border-subtle bg-bg-sunken p-3 text-[11px] text-fg-muted">
                {JSON.stringify(customerPreview, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Supplier Duplicates</CardTitle>
            <CardDescription>{supplierDupCount} duplicate groups (email/phone)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs font-medium text-fg-muted">By Email</div>
                {renderGroups(supplierDupEmail as any, "suppliers")}
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-fg-muted">By Phone</div>
                {renderGroups(supplierDupPhone as any, "suppliers")}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Supplier Merge Tool</CardTitle>
            <CardDescription>Pick the source to merge into the target.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-fg-muted">Source Supplier</div>
              <SupplierTypeahead
                disabled={supplierBusy}
                placeholder="Search supplier..."
                onSelect={(s) => setSrcSupplier(s)}
                onClear={() => setSrcSupplier(null)}
              />
              {srcSupplier ? <div className="text-xs text-fg-subtle font-mono">{srcSupplier.id}</div> : null}
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-fg-muted">Target Supplier</div>
              <SupplierTypeahead
                disabled={supplierBusy}
                placeholder="Search supplier..."
                onSelect={(s) => setTgtSupplier(s)}
                onClear={() => setTgtSupplier(null)}
              />
              {tgtSupplier ? <div className="text-xs text-fg-subtle font-mono">{tgtSupplier.id}</div> : null}
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-fg-muted">Reason (optional)</div>
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
              <pre className="max-h-80 overflow-auto rounded-md border border-border-subtle bg-bg-sunken p-3 text-[11px] text-fg-muted">
                {JSON.stringify(supplierPreview, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

