"use client";

import * as React from "react";
import {
  ArrayInput,
  AutocompleteInput,
  DateInput,
  Edit,
  FormTab,
  NumberInput,
  ReferenceInput,
  required,
  SelectInput,
  SimpleFormIterator,
  TabbedForm,
  TextInput,
} from "react-admin";

const currencyChoices = [
  { id: "USD", name: "USD" },
  { id: "LBP", name: "LBP" },
];

export function SalesInvoiceEdit() {
  return (
    <Edit title="Edit Sales Invoice (Draft)" redirect="show">
      <TabbedForm>
        <FormTab label="Header">
          <ReferenceInput source="warehouse_id" reference="warehouses" perPage={200}>
            <AutocompleteInput optionText="name" validate={required()} />
          </ReferenceInput>

          <ReferenceInput source="customer_id" reference="customers" perPage={25}>
            <AutocompleteInput
              optionText={(r) => (r ? `${r.name}` : "")}
              filterToQuery={(searchText) => ({ q: searchText })}
            />
          </ReferenceInput>

          <TextInput source="invoice_no" label="Invoice #" fullWidth />
          <DateInput source="invoice_date" />
          <DateInput source="due_date" />

          <NumberInput source="exchange_rate" />
          <SelectInput source="pricing_currency" choices={currencyChoices} />
          <SelectInput source="settlement_currency" choices={currencyChoices} />
        </FormTab>

        <FormTab label="Lines">
          <ArrayInput source="lines">
            <SimpleFormIterator inline>
              <ReferenceInput source="item_id" reference="items" perPage={25}>
                <AutocompleteInput
                  optionText={(r) => (r ? `${r.sku} — ${r.name}` : "")}
                  filterToQuery={(searchText) => ({ q: searchText })}
                  sx={{ minWidth: 420 }}
                  validate={required()}
                />
              </ReferenceInput>
              <NumberInput source="qty" validate={required()} />
              <NumberInput source="unit_price_usd" label="Unit USD" />
              <NumberInput source="unit_price_lbp" label="Unit LBP" />
            </SimpleFormIterator>
          </ArrayInput>
        </FormTab>
      </TabbedForm>
    </Edit>
  );
}

