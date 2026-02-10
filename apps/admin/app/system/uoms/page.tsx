"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type UomRow = {
  code: string;
  name: string;
  is_active: boolean;
  usage_count: number;
};

function normCode(raw: string) {
  return String(raw || "").trim().toUpperCase();
}

export default function UomsPage() {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<UomRow[]>([]);
  const [q, setQ] = useState("");

  const [newCode, setNewCode] = useState("EA");
  const [newName, setNewName] = useState("EA");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ uoms: UomRow[] }>("/items/uoms/manage");
      setRows(res.uoms || []);
      setStatus("");
    } catch (e) {
      setRows([]);
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = useCallback(
    async (code: string, next: boolean) => {
      setStatus("Saving...");
      try {
        await apiPatch(`/items/uoms/${encodeURIComponent(code)}`, { is_active: next });
        await load();
        setStatus("");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    },
    [load]
  );

  const rename = useCallback(
    async (code: string, name: string) => {
      const nm = String(name || "").trim();
      if (!nm) return;
      setStatus("Saving...");
      try {
        await apiPatch(`/items/uoms/${encodeURIComponent(code)}`, { name: nm });
        await load();
        setStatus("");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    },
    [load]
  );

  const columns = useMemo((): Array<DataTableColumn<UomRow>> => {
    return [
      { id: "code", header: "Code", accessor: (r) => r.code, mono: true, sortable: true, cell: (r) => <span className="text-xs">{r.code}</span> },
      {
        id: "name",
        header: "Name",
        accessor: (r) => r.name,
        sortable: true,
        cell: (r) => (
          <Input
            defaultValue={r.name}
            onBlur={(e) => rename(r.code, e.target.value)}
            className="h-9"
          />
        ),
      },
      { id: "usage", header: "Usage", accessor: (r) => Number(r.usage_count || 0), sortable: true, mono: true, cell: (r) => <span className="text-xs">{Number(r.usage_count || 0)}</span> },
      {
        id: "active",
        header: "Active",
        accessor: (r) => (r.is_active ? "active" : "inactive"),
        cell: (r) => (
          <Button
            type="button"
            size="sm"
            variant={r.is_active ? "default" : "outline"}
            onClick={() => toggleActive(r.code, !r.is_active)}
          >
            {r.is_active ? "Active" : "Inactive"}
          </Button>
        ),
      },
    ];
  }, [rename, toggleActive]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const code = normCode(newCode);
    if (!code) return setStatus("UOM code is required.");
    const name = String(newName || "").trim() || code;

    setCreating(true);
    setStatus("Saving...");
    try {
      await apiPost("/items/uoms", { code, name, is_active: true });
      setNewCode(code);
      setNewName(name);
      await load();
      setStatus("Saved.");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {status ? <ErrorBanner error={status} onRetry={load} /> : null}

      <div>
        <h1 className="text-xl font-semibold text-foreground">UOMs</h1>
        <p className="text-sm text-fg-muted">
          Unit of Measure is master data. Items must use a UOM from this list to prevent drift.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create / Update</CardTitle>
          <CardDescription>Codes should be short and stable (examples: EA, KG, L, BOX, PACK).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-medium text-fg-muted">Code</label>
              <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="EA" disabled={creating} />
            </div>
            <div className="space-y-1 md:col-span-4">
              <label className="text-xs font-medium text-fg-muted">Name</label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Each" disabled={creating} />
            </div>
            <div className="md:col-span-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={load} disabled={creating || loading}>
                Refresh
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "..." : "Save"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>List</CardTitle>
          <CardDescription>Deactivate instead of deleting (so historical items/invoices remain valid).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable<UomRow>
            tableId="system.uoms"
            rows={rows}
            columns={columns}
            isLoading={loading}
            emptyText={loading ? "Loading..." : "No UOMs found."}
            globalFilterPlaceholder="Search code or name..."
            globalFilterValue={q}
            onGlobalFilterValueChange={setQ}
            initialSort={{ columnId: "code", dir: "asc" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
