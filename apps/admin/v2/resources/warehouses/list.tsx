"use client";

import * as React from "react";
import { Datagrid, List, TextField } from "react-admin";

export function WarehouseList() {
  return (
    <List title="Warehouses" perPage={100} sort={{ field: "name", order: "ASC" }}>
      <Datagrid>
        <TextField source="name" />
        <TextField source="location" />
      </Datagrid>
    </List>
  );
}
