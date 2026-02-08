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

const customerFilters = [
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

const storageKey = "v2.customers.columns";

function money(v: any) {
  const n = Number(v || 0);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function CustomerDataGrid() {
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
      { field: "code", headerName: "Code", minWidth: 120 },
      { field: "name", headerName: "Name", minWidth: 260, flex: 0.8 },
      { field: "phone", headerName: "Phone", minWidth: 170 },
      { field: "email", headerName: "Email", minWidth: 240, flex: 0.6 },
      { field: "loyalty_points", headerName: "Points", minWidth: 120, type: "number" },
      { field: "credit_balance_usd", headerName: "Credit USD", minWidth: 140, valueFormatter: (v) => money(v) },
      { field: "credit_balance_lbp", headerName: "Credit LBP", minWidth: 150, valueFormatter: (v) => money(v) },
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

export function CustomerList() {
  return (
    <List title="Customers" filters={customerFilters} perPage={50} sort={{ field: "name", order: "ASC" }}>
      <CustomerDataGrid />
    </List>
  );
}
