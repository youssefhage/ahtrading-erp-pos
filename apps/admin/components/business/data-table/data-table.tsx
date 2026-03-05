"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
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
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTablePagination } from "./data-table-pagination";
import { DraggableHeader } from "./data-table-draggable-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Case-insensitive substring search across all column accessor values.
 * Replaces TanStack's default "auto" global filter which silently skips
 * columns whose first-row value isn't a string or number.
 */
const globalIncludesString: FilterFn<any> = (row, columnId, filterValue) => {
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
  /** Unique ID for persisting column order to localStorage */
  tableId?: string;
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
  tableId,
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

  // ---------- Column order (drag-and-drop) ----------
  const storageKey = tableId ? `dt-col-order:${tableId}` : null;

  const defaultColumnIds = React.useMemo(
    () => columns.map((c) => {
      if ("accessorKey" in c && c.accessorKey) return String(c.accessorKey);
      return (c as any).id ?? "";
    }),
    [columns],
  );

  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>(() => {
    if (!storageKey) return [];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        // Merge: keep saved order for columns that still exist, append new ones
        const validSaved = parsed.filter((id) => defaultColumnIds.includes(id));
        const newCols = defaultColumnIds.filter((id) => !parsed.includes(id));
        return [...validSaved, ...newCols];
      }
    } catch { /* ignore */ }
    return [];
  });

  // Persist column order to localStorage
  React.useEffect(() => {
    if (storageKey && columnOrder.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(columnOrder));
    }
  }, [storageKey, columnOrder]);

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setColumnOrder((prev) => {
      const currentOrder = prev.length > 0 ? prev : defaultColumnIds;
      const oldIndex = currentOrder.indexOf(String(active.id));
      const newIndex = currentOrder.indexOf(String(over.id));
      return arrayMove(currentOrder, oldIndex, newIndex);
    });
  }

  // When onSearchChange is provided, the server handles filtering — disable
  // client-side global filter to prevent double-filtering (the server may match
  // on fields that aren't in column accessors, e.g. barcode or brand).
  const isServerSearch = !!onSearchChange;

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<TData>({
    data,
    columns,
    pageCount: manualPagination ? pageCount : undefined,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      columnOrder,
      globalFilter: isServerSearch ? "" : globalFilter,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onColumnOrderChange: setColumnOrder,
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

  const columnIds = React.useMemo(
    () => table.getHeaderGroups()[0]?.headers.map((h) => h.column.id) ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.getState().columnOrder, table.getState().columnVisibility],
  );

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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  <SortableContext
                    items={columnIds}
                    strategy={horizontalListSortingStrategy}
                  >
                    {headerGroup.headers.map((header) => (
                      <DraggableHeader key={header.id} header={header} />
                    ))}
                  </SortableContext>
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
      </DndContext>

      <DataTablePagination table={table} totalRows={totalRows} />
    </div>
  );
}
