"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type PaginationState,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTablePagination } from "./data-table-pagination";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Case-insensitive substring search across all column accessor values.
 * Replaces TanStack's default "auto" global filter which silently skips
 * columns whose first-row value isn't a string or number.
 */
const globalIncludesString: FilterFn<unknown> = (row, columnId, filterValue) => {
  const search = String(filterValue ?? "").toLowerCase();
  if (!search) return true;
  const cellValue = row.getValue(columnId);
  if (cellValue == null) return false;
  return String(cellValue).toLowerCase().includes(search);
};

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  searchKey?: string;
  searchPlaceholder?: string;
  onRowClick?: (row: TData) => void;
  pageSize?: number;
  /** Server-side pagination: total page count */
  pageCount?: number;
  /** Server-side pagination: total row count */
  totalRows?: number;
  /** Callback when pagination state changes (server-side) */
  onPaginationChange?: (pagination: PaginationState) => void;
  /** Enable server-side pagination (disables client sort/filter) */
  manualPagination?: boolean;
  /** Faceted filter definitions for the toolbar */
  filterableColumns?: {
    id: string;
    title: string;
    options: { label: string; value: string }[];
  }[];
  /** Extra action nodes rendered in the toolbar */
  toolbarActions?: React.ReactNode;
  /** Callback when the search input changes (for server-side search) */
  onSearchChange?: (value: string) => void;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading,
  searchPlaceholder = "Search...",
  onRowClick,
  pageSize = 25,
  pageCount,
  totalRows,
  onPaginationChange,
  manualPagination,
  filterableColumns,
  toolbarActions,
  onSearchChange,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const onSearchChangeRef = React.useRef(onSearchChange);
  onSearchChangeRef.current = onSearchChange;
  const handleGlobalFilterChange = React.useCallback((value: string) => {
    setGlobalFilter(value);
    // Reset to first page so filtered results are visible (not stuck on an
    // out-of-range page).
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
    onSearchChangeRef.current?.(value);
  }, []);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });

  // When onSearchChange is provided, the server handles filtering — disable
  // client-side global filter to prevent double-filtering (the server may match
  // on fields that aren't in column accessors, e.g. barcode or brand).
  const isServerSearch = !!onSearchChange;

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    pageCount: manualPagination ? pageCount : undefined,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: isServerSearch ? "" : globalFilter,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(pagination) : updater;
      setPagination(next);
      onPaginationChange?.(next);
    },
    globalFilterFn: globalIncludesString,
    // Always allow columns with an accessor to be globally filtered, regardless
    // of the first-row value type (the TanStack default skips non-string/number).
    getColumnCanGlobalFilter: (column) => !!column.accessorFn,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: manualPagination ? undefined : getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: manualPagination ? undefined : getSortedRowModel(),
    manualPagination,
  });

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        globalFilter={globalFilter}
        onGlobalFilterChange={handleGlobalFilterChange}
        searchPlaceholder={searchPlaceholder}
        filterableColumns={filterableColumns}
        actions={toolbarActions}
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="h-10">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((_, j) => (
                    <TableCell key={`skeleton-cell-${j}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className={onRowClick ? "cursor-pointer" : undefined}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} totalRows={totalRows} />
    </div>
  );
}
