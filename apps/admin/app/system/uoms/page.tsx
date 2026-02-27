"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw, Ruler } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { PageHeader } from "@/components/business/page-header";
import { DataTable } from "@/components/business/data-table";
import { DataTableColumnHeader } from "@/components/business/data-table/data-table-column-header";
import { ConfirmDialog } from "@/components/business/confirm-dialog";
import { StatusBadge } from "@/components/business/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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

  const [newCode, setNewCode] = useState("EA");
  const [newName, setNewName] = useState("EA");
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const statusIsBusy = /^\s*(Saving|Deleting)\.\.\.\s*$/i.test(status);

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
    [load],
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
    [load],
  );

  const remove = useCallback(
    async (code: string) => {
      setStatus("Deleting...");
      try {
        await apiDelete(`/items/uoms/${encodeURIComponent(code)}`);
        await load();
        setStatus("");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    },
    [load],
  );

  const columns = useMemo<ColumnDef<UomRow>[]>(
    () => [
      {
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
      },
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <Input
            defaultValue={row.original.name}
            onBlur={(e) => rename(row.original.code, e.target.value)}
            className="h-9"
            disabled={loading || creating || statusIsBusy}
          />
        ),
      },
      {
        id: "usage",
        accessorFn: (r) => Number(r.usage_count || 0),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Usage" />,
        cell: ({ row }) => <span className="font-mono text-sm">{Number(row.original.usage_count || 0)}</span>,
      },
      {
        id: "active",
        accessorFn: (r) => (r.is_active ? "active" : "inactive"),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />,
        cell: ({ row }) => (
          <Button
            type="button"
            size="sm"
            variant={row.original.is_active ? "default" : "outline"}
            onClick={() => toggleActive(row.original.code, !row.original.is_active)}
            disabled={loading || creating || statusIsBusy}
          >
            {row.original.is_active ? "Active" : "Inactive"}
          </Button>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex justify-end">
            <ConfirmDialog
              title={`Delete UOM "${row.original.code}"?`}
              description="Delete is only allowed when this UOM has zero references."
              confirmLabel="Delete"
              variant="destructive"
              onConfirm={() => remove(row.original.code)}
              trigger={
                <Button variant="outline" size="sm" disabled={loading || creating || statusIsBusy}>
                  Delete
                </Button>
              }
            />
          </div>
        ),
      },
    ],
    [creating, loading, remove, rename, statusIsBusy, toggleActive],
  );

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
      setCreateOpen(false);
      setStatus("");
    } catch (e2) {
      setStatus(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="UOMs"
        description="Unit of Measure is master data. Items must use a UOM from this list to prevent drift."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={creating || loading || statusIsBusy}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  New UOM
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create UOM</DialogTitle>
                  <DialogDescription>Codes should be short and stable (examples: EA, KG, L, BOX, PACK).</DialogDescription>
                </DialogHeader>
                <form onSubmit={create} className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Code</label>
                    <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="EA" disabled={creating} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Name</label>
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Each" disabled={creating} />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={creating}>
                      {creating ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {status && !statusIsBusy && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 py-3">
            <p className="text-sm text-destructive">{status}</p>
            <Button variant="outline" size="sm" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ruler className="h-4 w-4" />
            Units of Measure
          </CardTitle>
          <CardDescription>Delete is allowed only when unused; otherwise deactivate. Historical document lines keep their stored UOM text.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={rows} isLoading={loading} searchPlaceholder="Search code or name..." />
        </CardContent>
      </Card>
    </div>
  );
}
