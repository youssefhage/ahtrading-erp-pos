"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Item = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit_of_measure: string;
  tax_code_id: string | null;
  reorder_point: string | number | null;
  reorder_qty: string | number | null;
};

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<string>("");

  const [q, setQ] = useState("");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [uom, setUom] = useState("EA");
  const [barcode, setBarcode] = useState("");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => {
      return (
        i.sku.toLowerCase().includes(needle) ||
        i.name.toLowerCase().includes(needle) ||
        (i.barcode || "").toLowerCase().includes(needle)
      );
    });
  }, [items, q]);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ items: Item[] }>("/items");
      setItems(res.items || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createItem(e: React.FormEvent) {
    e.preventDefault();
    if (!sku.trim() || !name.trim() || !uom.trim()) {
      setStatus("sku, name, and unit_of_measure are required");
      return;
    }
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/items", {
        sku: sku.trim(),
        name: name.trim(),
        unit_of_measure: uom.trim(),
        barcode: barcode.trim() || null
      });
      setSku("");
      setName("");
      setBarcode("");
      setStatus("Created.");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Items">
      <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Create Item</CardTitle>
            <CardDescription>Minimal v1 item creation (SKU, name, UOM, barcode).</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createItem} className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">SKU</label>
                <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-001" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">UOM</label>
                <Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="EA" />
              </div>
              <div className="space-y-1 md:col-span-3">
                <label className="text-xs font-medium text-slate-700">Barcode (optional)</label>
                <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="629..." />
              </div>
              <div className="flex items-end md:col-span-1">
                <Button type="submit" disabled={creating} className="w-full">
                  {creating ? "..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Catalog</CardTitle>
            <CardDescription>{items.length} items</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-80">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sku/name/barcode..." />
              </div>
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2">UOM</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs">{i.sku}</td>
                      <td className="px-3 py-2">{i.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{i.barcode || "-"}</td>
                      <td className="px-3 py-2">{i.unit_of_measure}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                        No items found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

