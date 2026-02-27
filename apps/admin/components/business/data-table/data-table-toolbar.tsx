"use client";

import * as React from "react";
import type { Table } from "@tanstack/react-table";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FilterableColumn {
  id: string;
  title: string;
  options: { label: string; value: string }[];
}

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  searchPlaceholder?: string;
  filterableColumns?: FilterableColumn[];
  actions?: React.ReactNode;
}

export function DataTableToolbar<TData>({
  table,
  globalFilter,
  onGlobalFilterChange,
  searchPlaceholder = "Search...",
  filterableColumns,
  actions,
}: DataTableToolbarProps<TData>) {
  const isFiltered =
    globalFilter.length > 0 || table.getState().columnFilters.length > 0;

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex flex-1 items-center gap-2">
        {/* Search input */}
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => onGlobalFilterChange(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Faceted filters */}
        {filterableColumns?.map((col) => {
          const column = table.getColumn(col.id);
          if (!column) return null;

          const filterValue = (column.getFilterValue() as string) ?? "";

          return (
            <Select
              key={col.id}
              value={filterValue}
              onValueChange={(value) =>
                column.setFilterValue(value === "all" ? undefined : value)
              }
            >
              <SelectTrigger
                className={cn(
                  "h-9 w-[150px]",
                  filterValue && "text-foreground",
                )}
              >
                <SelectValue placeholder={col.title} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {col.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}

        {/* Reset filters */}
        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onGlobalFilterChange("");
              table.resetColumnFilters();
            }}
          >
            Reset
            <X className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Custom toolbar actions */}
        {actions}

        {/* Column visibility */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[180px]">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter(
                (column) =>
                  typeof column.accessorFn !== "undefined" &&
                  column.getCanHide(),
              )
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
