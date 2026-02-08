"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  List,
  SelectInput,
  TextField,
  TextInput,
  useListContext,
  useRedirect,
} from "react-admin";
import { Box, Chip } from "@mui/material";
import type { GridColDef, GridColumnVisibilityModel, GridSortModel } from "@mui/x-data-grid";
import { DataGrid } from "@mui/x-data-grid";

const invoiceFilters = [
  <TextInput key="q" source="q" label="Search" alwaysOn />,
  <SelectInput
    key="status"
    source="status"
    choices={[
      { id: "draft", name: "Draft" },
      { id: "posted", name: "Posted" },
      { id: "canceled", name: "Canceled" },
    ]}
  />,
];

const storageKey = "v2.salesInvoices.columns";

function money(v: any) {
  const n = Number(v || 0);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function dateTime(v: any) {
  if (!v) return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function SalesInvoiceDataGrid() {
  const { data, total, isPending, page, perPage, setPage, setPerPage, sort, setSort } =
    useListContext<any>();
  const redirect = useRedirect();

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

  const rows = data || [];

  const columns: GridColDef[] = useMemo(
    () => [
      { field: "invoice_no", headerName: "Invoice #", minWidth: 140, flex: 0.4 },
      {
        field: "status",
        headerName: "Status",
        minWidth: 120,
        renderCell: (p) => <Chip size="small" label={String(p.value || "")} />,
      },
      { field: "customer_name", headerName: "Customer", minWidth: 220, flex: 0.6 },
      { field: "warehouse_name", headerName: "Warehouse", minWidth: 200, flex: 0.5 },
      { field: "invoice_date", headerName: "Invoice Date", minWidth: 140 },
      { field: "due_date", headerName: "Due Date", minWidth: 140 },
      {
        field: "total_usd",
        headerName: "Total USD",
        minWidth: 140,
        valueFormatter: (value) => money(value),
      },
      {
        field: "total_lbp",
        headerName: "Total LBP",
        minWidth: 140,
        valueFormatter: (value) => money(value),
      },
      {
        field: "created_at",
        headerName: "Created",
        minWidth: 190,
        valueFormatter: (value) => dateTime(value),
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
        rows={rows}
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
        onRowDoubleClick={(p) => redirect("show", "sales-invoices", p.id)}
        onRowClick={(p) => redirect("show", "sales-invoices", p.id)}
        columnVisibilityModel={columnVisibilityModel}
        onColumnVisibilityModelChange={setColumnVisibilityModel}
        pageSizeOptions={[25, 50, 100, 200]}
      />
    </Box>
  );
}

export function SalesInvoiceList() {
  return (
    <List
      title="Sales Invoices"
      filters={invoiceFilters}
      perPage={50}
      sort={{ field: "created_at", order: "DESC" }}
    >
      <SalesInvoiceDataGrid />
    </List>
  );
}
