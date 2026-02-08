"use client";

import * as React from "react";
import {
  Datagrid,
  DateField,
  List,
  NumberField,
  SelectInput,
  TextField,
  TextInput,
} from "react-admin";

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

export function SalesInvoiceList() {
  return (
    <List
      title="Sales Invoices"
      filters={invoiceFilters}
      perPage={50}
      sort={{ field: "created_at", order: "DESC" }}
    >
      <Datagrid rowClick="show">
        <TextField source="invoice_no" label="Invoice #" />
        <TextField source="status" />
        <TextField source="customer_name" label="Customer" />
        <TextField source="warehouse_name" label="Warehouse" />
        <DateField source="invoice_date" />
        <DateField source="due_date" />
        <NumberField source="total_usd" label="Total USD" />
        <NumberField source="total_lbp" label="Total LBP" />
        <DateField source="created_at" showTime />
      </Datagrid>
    </List>
  );
}

