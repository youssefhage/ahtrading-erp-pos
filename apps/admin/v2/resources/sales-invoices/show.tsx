"use client";

import * as React from "react";
import {
  ArrayField,
  ChipField,
  Datagrid,
  DateField,
  NumberField,
  Show,
  SimpleShowLayout,
  TabbedShowLayout,
  TextField,
} from "react-admin";

export function SalesInvoiceShow() {
  return (
    <Show>
      <TabbedShowLayout>
        <TabbedShowLayout.Tab label="Overview">
          <SimpleShowLayout>
            <TextField source="invoice_no" label="Invoice #" />
            <ChipField source="status" />
            <TextField source="customer_name" label="Customer" />
            <TextField source="warehouse_name" label="Warehouse" />
            <DateField source="invoice_date" />
            <DateField source="due_date" />
            <NumberField source="exchange_rate" />
            <TextField source="pricing_currency" />
            <TextField source="settlement_currency" />
            <NumberField source="total_usd" />
            <NumberField source="total_lbp" />
            <DateField source="created_at" showTime />
          </SimpleShowLayout>
        </TabbedShowLayout.Tab>

        <TabbedShowLayout.Tab label="Lines">
          <ArrayField source="lines">
            <Datagrid bulkActionButtons={false}>
              <TextField source="item_sku" label="SKU" />
              <TextField source="item_name" label="Item" />
              <NumberField source="qty" />
              <NumberField source="unit_price_usd" label="Unit USD" />
              <NumberField source="unit_price_lbp" label="Unit LBP" />
              <NumberField source="line_total_usd" label="Total USD" />
              <NumberField source="line_total_lbp" label="Total LBP" />
            </Datagrid>
          </ArrayField>
        </TabbedShowLayout.Tab>

        <TabbedShowLayout.Tab label="Payments">
          <ArrayField source="payments">
            <Datagrid bulkActionButtons={false}>
              <TextField source="method" />
              <NumberField source="amount_usd" />
              <NumberField source="amount_lbp" />
              <DateField source="created_at" showTime />
            </Datagrid>
          </ArrayField>
        </TabbedShowLayout.Tab>

        <TabbedShowLayout.Tab label="Taxes">
          <ArrayField source="tax_lines">
            <Datagrid bulkActionButtons={false}>
              <TextField source="tax_code_id" label="Tax Code" />
              <NumberField source="base_usd" />
              <NumberField source="base_lbp" />
              <NumberField source="tax_usd" />
              <NumberField source="tax_lbp" />
              <DateField source="tax_date" />
            </Datagrid>
          </ArrayField>
        </TabbedShowLayout.Tab>
      </TabbedShowLayout>
    </Show>
  );
}
