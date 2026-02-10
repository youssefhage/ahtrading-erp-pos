"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { scoreFuzzyQuery } from "@/lib/fuzzy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type SortDir = "asc" | "desc";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  accessor?: keyof T | ((row: T) => unknown);
  cell?: (row: T) => ReactNode;
  cellClassName?: string | ((row: T) => string | undefined);
  headerClassName?: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  mono?: boolean;
  globalSearch?: boolean; // default: true
  defaultHidden?: boolean;
};

type ColumnVisibility = Record<string, boolean>;

export type DataTableProps<T> = {
  tableId: string; // used for persisting preferences
  rows: T[];
  columns: Array<DataTableColumn<T>>;
  getRowId?: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  className?: string;
  initialSort?: { columnId: string; dir: SortDir } | null;

  // Toolbar
  enableGlobalFilter?: boolean;
  globalFilterPlaceholder?: string;
  toolbarLeft?: ReactNode; // rendered next to the global filter
  actions?: ReactNode; // rendered on the right

  // Pagination (client-side)
  enablePagination?: boolean; // default: true
  pageSizeOptions?: number[]; // default: [25, 50, 100, 200]
  defaultPageSize?: number; // default: 50
};

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getCellValue<T>(row: T, col: DataTableColumn<T>): unknown {
  if (col.accessor) {
    if (typeof col.accessor === "function") return col.accessor(row);
    return (row as any)[col.accessor];
  }
  return (row as any)[col.id];
}

function toSearchText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function compareUnknown(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const an = typeof a === "number" ? a : Number.NaN;
  const bn = typeof b === "number" ? b : Number.NaN;
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    tableId,
    rows,
    columns,
    getRowId,
    onRowClick,
    emptyText = "No rows.",
    className,
    initialSort = null,
    enableGlobalFilter = true,
    globalFilterPlaceholder = "Search...",
    toolbarLeft,
    actions,
    enablePagination = true,
    pageSizeOptions = [25, 50, 100, 200],
    defaultPageSize = 50,
  } = props;

  const storageKey = `admin.tablePrefs.${tableId}.v3`;

  const defaultVisibility = useMemo(() => {
    const vis: ColumnVisibility = {};
    for (const c of columns) vis[c.id] = c.defaultHidden ? false : true;
    return vis;
  }, [columns]);

  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(defaultVisibility);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sort, setSort] = useState<{ columnId: string; dir: SortDir } | null>(initialSort);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [page, setPage] = useState<number>(0);

  // Load persisted prefs once.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(storageKey);
    } catch {
      raw = null;
    }
    const saved = safeJsonParse<{
      columnVisibility?: ColumnVisibility;
      globalFilter?: string;
      sort?: { columnId: string; dir: SortDir } | null;
      pageSize?: number;
    }>(raw);

    if (saved?.columnVisibility) {
      const next: ColumnVisibility = { ...defaultVisibility };
      for (const c of columns) {
        const v = saved.columnVisibility[c.id];
        if (typeof v === "boolean") next[c.id] = v;
      }
      setColumnVisibility(next);
    }

    if (typeof saved?.globalFilter === "string") setGlobalFilter(saved.globalFilter);
    if (saved && Object.prototype.hasOwnProperty.call(saved, "sort")) setSort(saved.sort ?? null);
    if (typeof saved?.pageSize === "number" && saved.pageSize > 0) setPageSize(saved.pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist prefs.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ columnVisibility, globalFilter, sort, pageSize }));
    } catch {
      // ignore
    }
  }, [columnVisibility, globalFilter, sort, pageSize, storageKey]);

  // If columns change, merge visibility with defaults (keeps persisted where possible).
  useEffect(() => {
    setColumnVisibility((prev) => {
      const next: ColumnVisibility = { ...defaultVisibility };
      for (const c of columns) {
        const v = prev[c.id];
        if (typeof v === "boolean") next[c.id] = v;
      }
      return next;
    });
  }, [columns, defaultVisibility]);

  const visibleColumns = useMemo(() => {
    return columns.filter((c) => columnVisibility[c.id] !== false);
  }, [columns, columnVisibility]);

  const filteredRows = useMemo(() => {
    if (!enableGlobalFilter) return rows;
    const needle = globalFilter.trim();
    if (!needle) return rows;

    const searchCols = columns.filter((c) => c.globalSearch !== false);
    const out: T[] = [];
    for (const r of rows) {
      const hay = searchCols.map((c) => toSearchText(getCellValue(r, c))).join(" ");
      if (scoreFuzzyQuery(needle, hay) != null) out.push(r);
    }
    return out;
  }, [rows, columns, globalFilter, enableGlobalFilter]);

  const sortedRows = useMemo(() => {
    const needle = enableGlobalFilter ? globalFilter.trim() : "";
    const searchCols = columns.filter((c) => c.globalSearch !== false);

    const col = sort ? columns.find((c) => c.id === sort.columnId) : null;
    const dir = sort?.dir === "asc" ? 1 : -1;

    const scored = filteredRows.map((row, idx) => {
      if (!needle) return { row, idx, score: 0 };
      const hay = searchCols.map((c) => toSearchText(getCellValue(row, c))).join(" ");
      return { row, idx, score: scoreFuzzyQuery(needle, hay) ?? 0 };
    });

    scored.sort((a, b) => {
      // While searching, show the closest suggestions first.
      if (needle) {
        const ds = b.score - a.score;
        if (ds) return ds;
      }
      if (col) {
        const dv = dir * compareUnknown(getCellValue(a.row, col), getCellValue(b.row, col));
        if (dv) return dv;
      }
      return a.idx - b.idx;
    });

    return scored.map((x) => x.row);
  }, [filteredRows, sort, columns, enableGlobalFilter, globalFilter]);

  // Reset to the first page whenever the view changes.
  useEffect(() => {
    setPage(0);
  }, [globalFilter, sort, pageSize, enableGlobalFilter]);

  // Clamp current page if data shrinks.
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(sortedRows.length / Math.max(1, pageSize)) - 1);
    setPage((p) => Math.min(p, maxPage));
  }, [sortedRows.length, pageSize]);

  const pageCount = useMemo(() => {
    if (!enablePagination) return 1;
    return Math.max(1, Math.ceil(sortedRows.length / Math.max(1, pageSize)));
  }, [sortedRows.length, pageSize, enablePagination]);

  const pageRows = useMemo(() => {
    if (!enablePagination) return sortedRows;
    const start = page * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, enablePagination, page, pageSize]);

  const sortIcon = (columnId: string) => {
    if (!sort || sort.columnId !== columnId) return <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />;
    return sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5 opacity-80" /> : <ArrowDown className="h-3.5 w-3.5 opacity-80" />;
  };

  const toggleSort = (col: DataTableColumn<T>) => {
    if (!col.sortable) return;
    setSort((prev) => {
      if (!prev || prev.columnId !== col.id) return { columnId: col.id, dir: "asc" };
      if (prev.dir === "asc") return { columnId: col.id, dir: "desc" };
      return null;
    });
  };

  const visibleCount = Object.values(columnVisibility).filter(Boolean).length;

  const startRow = enablePagination && sortedRows.length ? page * pageSize + 1 : sortedRows.length ? 1 : 0;
  const endRow = enablePagination ? Math.min(sortedRows.length, page * pageSize + pageRows.length) : sortedRows.length;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {enableGlobalFilter ? (
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <div className="w-full md:w-96">
              <Input value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder={globalFilterPlaceholder} />
            </div>
            {toolbarLeft}
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">{toolbarLeft}</div>
        )}

        <div className="flex items-center gap-2">
          {actions}

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <span className="inline-flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Columns
                </span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Customize Columns</DialogTitle>
                <DialogDescription>Hide or show columns. Saved for this device.</DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setColumnVisibility(Object.fromEntries(columns.map((c) => [c.id, true])) as ColumnVisibility)}
                  >
                    Show all
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setColumnVisibility(Object.fromEntries(columns.map((c) => [c.id, c.defaultHidden ? false : true])) as ColumnVisibility)
                    }
                  >
                    Reset
                  </Button>
                </div>

                <div className="max-h-[50vh] space-y-2 overflow-auto rounded-md border border-border-subtle bg-bg-sunken/20 p-3">
                  {columns.map((c) => {
                    const checked = columnVisibility[c.id] !== false;
                    const disableUncheck = checked && visibleCount <= 1;
                    return (
                      <label key={c.id} className={cn("flex items-center justify-between gap-3 text-sm", disableUncheck && "opacity-70")}>
                        <span className="text-foreground">{c.header}</span>
                        <input
                          className="ui-checkbox"
                          type="checkbox"
                          checked={checked}
                          disabled={disableUncheck}
                          onChange={(e) => setColumnVisibility((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead className="ui-thead">
            <tr>
              {visibleColumns.map((c) => (
                <th
                  key={c.id}
                  className={cn(
                    "select-none",
                    c.sortable && "cursor-pointer hover:text-foreground",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.headerClassName
                  )}
                  onClick={() => toggleSort(c)}
                >
                  <span className={cn("inline-flex items-center gap-1.5", c.align === "right" && "w-full justify-end")}>
                    {c.header}
                    {c.sortable ? sortIcon(c.id) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, idx) => {
              const key = getRowId ? getRowId(r, idx) : String(idx);
              return (
                <tr
                  key={key}
                  className={cn("ui-tr ui-tr-hover", onRowClick && "cursor-pointer")}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? "button" : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick(r);
                          }
                        }
                      : undefined
                  }
                >
                  {visibleColumns.map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                        c.mono && "data-mono",
                        typeof c.cellClassName === "function" ? c.cellClassName(r) : c.cellClassName
                      )}
                    >
                      {c.cell ? c.cell(r) : (getCellValue(r, c) as any) ?? ""}
                    </td>
                  ))}
                </tr>
              );
            })}

            {pageRows.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-fg-subtle" colSpan={Math.max(visibleColumns.length, 1)}>
                  {emptyText}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {enablePagination ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-fg-muted">
            {sortedRows.length ? (
              <>
                Showing <span className="data-mono">{startRow.toLocaleString("en-US")}</span>–<span className="data-mono">{endRow.toLocaleString("en-US")}</span>{" "}
                of <span className="data-mono">{sortedRows.length.toLocaleString("en-US")}</span>
                <span className="text-fg-subtle"> · </span>
                Page <span className="data-mono">{page + 1}</span>/<span className="data-mono">{pageCount}</span>
              </>
            ) : (
              <span>No results.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select className="ui-select h-9 text-xs" value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value || defaultPageSize))}>
              {pageSizeOptions.map((n) => (
                <option key={n} value={String(n)}>
                  {n} / page
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page <= 0}>
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

