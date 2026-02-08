"use client";

import * as React from "react";
import {
  BooleanField,
  Datagrid,
  List,
  NumberField,
  SelectInput,
  TextField,
  TextInput,
} from "react-admin";

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

export function CustomerList() {
  return (
    <List title="Customers" filters={customerFilters} perPage={50} sort={{ field: "name", order: "ASC" }}>
      <Datagrid>
        <TextField source="code" />
        <TextField source="name" />
        <TextField source="phone" />
        <TextField source="email" />
        <NumberField source="loyalty_points" />
        <NumberField source="credit_balance_usd" />
        <NumberField source="credit_balance_lbp" />
        <BooleanField source="is_active" />
      </Datagrid>
    </List>
  );
}

