"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  List,
  SelectInput,
  TextInput,
  useListContext,
} from "react-admin";
import { Box, Chip } from "@mui/material";
import type { GridColDef, GridColumnVisibilityModel, GridSortModel } from "@mui/x-data-grid";
import { DataGrid } from "@mui/x-data-grid";

const itemFilters = [
  <TextInput key="q" source="q" label="Search" alwaysOn />,
  <SelectInput
    key="is_active"
    source="is_active"
    choices={[
      { id: "true", name: "Active" },
      { id: "false", name: "Inactive" },
    ]}
  />,
];

const storageKey = "v2.items.columns";

function ItemDataGrid() {
  const { data, total, isPending, page, perPage, setPage, setPerPage, sort, setSort } = useListContext<any>();

  const [columnVisibilityModel, setColumnVisibilityModel] = useState<GridColumnVisibilityModel>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(columnVisibilityModel));
  }, [columnVisibilityModel]);

  const columns: GridColDef[] = useMemo(
    () => [
      { field: "sku", headerName: "SKU", minWidth: 140 },
      { field: "name", headerName: "Name", minWidth: 260, flex: 0.8 },
      { field: "barcode", headerName: "Barcode", minWidth: 160 },
      { field: "unit_of_measure", headerName: "UOM", minWidth: 110 },
      { field: "category_name", headerName: "Category", minWidth: 180, flex: 0.4 },
      { field: "reorder_point", headerName: "Reorder Pt", minWidth: 130, type: "number" },
      { field: "reorder_qty", headerName: "Reorder Qty", minWidth: 130, type: "number" },
      {
        field: "is_active",
        headerName: "Active",
        minWidth: 110,
        renderCell: (p) => <Chip size="small" label={p.value ? "Yes" : "No"} color={p.value ? "success" : "default"} />,
      },
    ],
    []
  );

  const sortModel: GridSortModel = useMemo(() => {
    const dir = (sort?.order || "ASC").toLowerCase() as "asc" | "desc";
    return sort?.field ? [{ field: sort.field, sort: dir }] : [];
  }, [sort]);

  return (
    <Box sx={{ height: "calc(100vh - 260px)", width: "100%" }}>
      <DataGrid
        rows={data || []}
        columns={columns}
        getRowId={(r) => r.id}
        loading={isPending}
        rowCount={total || 0}
        disableRowSelectionOnClick
        paginationMode="server"
        sortingMode="server"
        paginationModel={{ page: Math.max(0, (page || 1) - 1), pageSize: perPage || 50 }}
        onPaginationModelChange={(m) => {
          if (m.pageSize !== perPage) setPerPage(m.pageSize);
          if (m.page !== (page || 1) - 1) setPage(m.page + 1);
        }}
        sortModel={sortModel}
        onSortModelChange={(m) => {
          const next = m?.[0];
          if (!next?.field || !next.sort) return;
          setSort({ field: next.field, order: next.sort === "desc" ? "DESC" : "ASC" });
        }}
        columnVisibilityModel={columnVisibilityModel}
        onColumnVisibilityModelChange={setColumnVisibilityModel}
        pageSizeOptions={[25, 50, 100, 200]}
      />
    </Box>
  );
}

export function ItemList() {
  return (
    <List title="Items" filters={itemFilters} perPage={50} sort={{ field: "sku", order: "ASC" }}>
      <ItemDataGrid />
    </List>
  );
}
