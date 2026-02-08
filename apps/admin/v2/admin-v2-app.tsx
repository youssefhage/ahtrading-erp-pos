"use client";

import * as React from "react";
import {
  Admin,
  CustomRoutes,
  Resource,
  defaultTheme,
} from "react-admin";
import { createTheme } from "@mui/material/styles";
import { Route } from "react-router-dom";

import { authProvider } from "@/v2/authProvider";
import { dataProvider } from "@/v2/dataProvider";
import { AdminV2Layout } from "@/v2/layout";
import { LoginPage } from "@/v2/login";
import { Dashboard } from "@/v2/pages/dashboard";
import { OpsPortal } from "@/v2/pages/ops-portal";
import { SalesInvoiceList } from "@/v2/resources/sales-invoices/list";
import { SalesInvoiceShow } from "@/v2/resources/sales-invoices/show";
import { SalesInvoiceCreate } from "@/v2/resources/sales-invoices/create";
import { SalesInvoiceEdit } from "@/v2/resources/sales-invoices/edit";
import { ItemList } from "@/v2/resources/items/list";
import { CustomerList } from "@/v2/resources/customers/list";
import { WarehouseList } from "@/v2/resources/warehouses/list";

const lightTheme = createTheme({
  ...defaultTheme,
  palette: {
    mode: "light",
    primary: { main: "#f59e0b" }, // amber-500
  },
});

const darkTheme = createTheme({
  ...defaultTheme,
  palette: {
    mode: "dark",
    primary: { main: "#f59e0b" },
  },
});

export function AdminV2App() {
  return (
    <Admin
      // React-Admin defaults to a hash router when not already inside a router context.
      // In Next.js `/v2`, we keep the base path handled by Next and let RA manage the hash part.
      // This avoids "URL '/' does not start with the basename '/v2'" warnings on first load.
      basename=""
      authProvider={authProvider}
      dataProvider={dataProvider}
      layout={AdminV2Layout}
      loginPage={LoginPage}
      dashboard={Dashboard}
      theme={lightTheme}
      darkTheme={darkTheme}
      disableTelemetry
    >
      <CustomRoutes>
        <Route path="/ops" element={<OpsPortal />} />
      </CustomRoutes>

      <Resource
        name="sales-invoices"
        list={SalesInvoiceList}
        show={SalesInvoiceShow}
        create={SalesInvoiceCreate}
        edit={SalesInvoiceEdit}
        recordRepresentation={(r) => r.invoice_no || r.id}
      />
      <Resource
        name="items"
        list={ItemList}
        recordRepresentation={(r) => r.sku || r.id}
      />
      <Resource
        name="customers"
        list={CustomerList}
        recordRepresentation={(r) => r.name || r.id}
      />
      <Resource
        name="warehouses"
        list={WarehouseList}
        recordRepresentation={(r) => r.name || r.id}
      />
    </Admin>
  );
}
