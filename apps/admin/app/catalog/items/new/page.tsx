"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { apiGet, apiPost } from "@/lib/api";
import { ErrorBanner } from "@/components/error-banner";
import { SearchableSelect } from "@/components/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TaxCode = { id: string; name: string; rate: string | number };
type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };

export default function NewItemPage() {
  const router = useRouter();

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [uoms, setUoms] = useState<string[]>([]);

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [uom, setUom] = useState("EA");
  const [barcode, setBarcode] = useState("");
  const [taxCodeId, setTaxCodeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tc, cats, uo] = await Promise.all([
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes").catch(() => ({ tax_codes: [] as TaxCode[] })),
        apiGet<{ categories: Category[] }>("/item-categories").catch(() => ({ categories: [] as Category[] })),
        apiGet<{ uoms: string[] }>("/items/uoms?limit=200").catch(() => ({ uoms: [] as string[] })),
      ]);
      setTaxCodes(tc.tax_codes || []);
      setCategories(cats.categories || []);
      setUoms((uo.uoms || []).map((x) => String(x || "").trim()).filter(Boolean));
      setStatus("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim()) return setStatus("SKU is required.");
    if (!name.trim()) return setStatus("Name is required.");
    if (!uom.trim()) return setStatus("Unit of measure is required.");

    setCreating(true);
    setStatus("Creating...");
    try {
      const res = await apiPost<{ id: string }>("/items", {
        sku: sku.trim(),
        name: name.trim(),
        unit_of_measure: uom.trim(),
        barcode: barcode.trim() || null,
        tax_code_id: taxCodeId || null,
        category_id: categoryId || null,
        is_active: active,
      });
      setStatus("");
      router.push(`/catalog/items/${encodeURIComponent(res.id)}`);
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">New Item</h1>
          <p className="text-sm text-fg-muted">Create a catalog item.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")}>
            Back
          </Button>
        </div>
      </div>

      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Item</CardTitle>
          <CardDescription>SKU, naming, and tax/category defaults.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">SKU</label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-001" disabled={creating || loading} />
            </div>
            <div className="space-y-1 md:col-span-4">
              <label className="text-xs font-medium text-fg-muted">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" disabled={creating || loading} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">UOM</label>
              <SearchableSelect
                value={uom}
                onChange={setUom}
                disabled={creating || loading}
                placeholder="Select UOM..."
                searchPlaceholder="Search UOMs..."
                options={(uoms || []).map((x) => ({ value: x, label: x }))}
              />
              <div className="mt-1 text-xs text-fg-subtle">
                Missing a UOM? Add it in{" "}
                <Link href="/system/uoms" className="underline underline-offset-2 hover:text-foreground">
                  System &rarr; UOMs
                </Link>
                .
              </div>
            </div>
            <div className="space-y-1 md:col-span-4">
              <label className="text-xs font-medium text-fg-muted">Primary Barcode (optional)</label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="barcode" disabled={creating || loading} />
            </div>
            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-medium text-fg-muted">Tax Code</label>
              <SearchableSelect
                value={taxCodeId}
                onChange={setTaxCodeId}
                disabled={creating || loading}
                searchPlaceholder="Search tax codes..."
                options={[
                  { value: "", label: "(none)" },
                  ...taxCodes.map((t) => ({ value: t.id, label: t.name, keywords: String(t.rate ?? "") })),
                ]}
              />
            </div>
            <div className="space-y-1 md:col-span-3">
              <label className="text-xs font-medium text-fg-muted">Category</label>
              <SearchableSelect
                value={categoryId}
                onChange={setCategoryId}
                disabled={creating || loading}
                searchPlaceholder="Search categories..."
                options={[
                  { value: "", label: "(none)" },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
            <label className="md:col-span-6 flex items-center gap-2 text-xs text-fg-muted">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={creating || loading} /> Active
            </label>
            <div className="md:col-span-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.push("/catalog/items/list")} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || loading}>
                {creating ? "..." : "Create"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
