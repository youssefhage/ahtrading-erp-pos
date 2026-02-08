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

export function ItemList() {
  return (
    <List title="Items" filters={itemFilters} perPage={50} sort={{ field: "sku", order: "ASC" }}>
      <Datagrid>
        <TextField source="sku" />
        <TextField source="name" />
        <TextField source="barcode" />
        <TextField source="unit_of_measure" label="UOM" />
        <TextField source="category_name" label="Category" />
        <NumberField source="reorder_point" />
        <NumberField source="reorder_qty" />
        <BooleanField source="is_active" />
      </Datagrid>
    </List>
  );
}

