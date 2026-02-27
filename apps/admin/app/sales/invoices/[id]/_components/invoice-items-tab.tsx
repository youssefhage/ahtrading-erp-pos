"use client";

import { DataTable, type DataTableColumn } from "@/components/data-table";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type InvoiceLine = {
  id: string;
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  qty: string | number;
  uom?: string | null;
  qty_factor?: string | number | null;
  qty_entered?: string | number | null;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

export interface InvoiceItemsTabProps {
  lines: InvoiceLine[];
  columns: Array<DataTableColumn<InvoiceLine>>;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function InvoiceItemsTab({ lines, columns }: InvoiceItemsTabProps) {
  return (
    <DataTable<InvoiceLine>
      tableId="sales.invoice.lines"
      rows={lines}
      columns={columns}
      getRowId={(l) => l.id}
      emptyText="No lines."
      enableGlobalFilter={false}
      initialSort={{ columnId: "item", dir: "asc" }}
    />
  );
}
