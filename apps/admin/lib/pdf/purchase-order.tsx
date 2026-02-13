import { Document, Page, Text, View } from "@react-pdf/renderer";

import { fmtLbp, fmtUsd } from "@/lib/money";
import { fmtIsoDate, generatedAtStamp } from "@/lib/pdf/format";
import { pdfStyles as s } from "@/lib/pdf/styles";

export type PurchaseOrderItem = { id: string; sku?: string | null; name?: string | null; unit_of_measure?: string | null };

type PurchaseOrderRow = {
  id: string;
  order_no: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  supplier_ref?: string | null;
  expected_delivery_date?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
};

type PurchaseOrderLine = {
  id: string;
  item_id: string;
  qty: string | number;
  received_qty?: string | number;
  invoiced_qty?: string | number;
  open_to_receive_qty?: string | number;
  open_to_invoice_qty?: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

export type PurchaseOrderDetail = { order: PurchaseOrderRow; lines: PurchaseOrderLine[] };

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export function PurchaseOrderPdf(props: { detail: PurchaseOrderDetail; itemsById?: Map<string, PurchaseOrderItem> }) {
  const order = props.detail.order;
  const lines = props.detail.lines || [];
  const itemsById = props.itemsById || new Map();

  const docNo = order.order_no || "(draft)";

  return (
    <Document title={`Purchase Order ${docNo}`}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Purchase Order</Text>
            <Text style={[s.muted, s.mono]}>{docNo} · {order.status}</Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Expected {fmtIsoDate(order.expected_delivery_date)}</Text>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Exchange {String(Math.round(toNum(order.exchange_rate)))}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Supplier</Text>
            <Text style={s.value}>{order.supplier_name || order.supplier_id || "-"}</Text>
            {order.supplier_ref ? <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Ref {order.supplier_ref}</Text> : null}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Warehouse</Text>
            <Text style={s.value}>{order.warehouse_name || order.warehouse_id || "-"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Totals</Text>
            <Text style={[s.value, s.mono]}>{fmtUsd(order.total_usd)}</Text>
            <Text style={[s.mono, { marginTop: 2 }]}>{fmtLbp(order.total_lbp)}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Items</Text>
          <View style={[s.table, { marginTop: 6 }]}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 4.2 }]}>Item</Text>
              <Text style={[s.th, s.right, { flex: 1.1 }]}>Ordered</Text>
              <Text style={[s.th, s.right, { flex: 1.1 }]}>Recv</Text>
              <Text style={[s.th, s.right, { flex: 1.1 }]}>Inv</Text>
              <Text style={[s.th, s.right, { flex: 1.7 }]}>Unit USD</Text>
              <Text style={[s.th, s.right, { flex: 1.8 }]}>Unit LL</Text>
              <Text style={[s.th, s.right, { flex: 1.8 }]}>Total USD</Text>
              <Text style={[s.th, s.right, { flex: 1.9 }]}>Total LL</Text>
            </View>
            {lines.map((l) => {
              const it = itemsById.get(l.item_id);
              return (
                <View key={l.id} style={s.tr} wrap={false}>
                  <View style={[s.td, { flex: 4.2 }]}>
                    <Text style={[s.mono, { fontSize: 8, color: "#444" }]}>{it?.sku || l.item_id}</Text>
                    <Text style={{ marginTop: 2 }}>{it?.name || "-"}</Text>
                    {it?.unit_of_measure ? <Text style={[s.muted, s.mono, { marginTop: 2, fontSize: 8 }]}>UOM {String(it.unit_of_measure)}</Text> : null}
                  </View>
                  <Text style={[s.td, s.right, s.mono, { flex: 1.1 }]}>{toNum(l.qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 1.1 }]}>{toNum(l.received_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 1.1 }]}>{toNum(l.invoiced_qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmtUsd(l.unit_cost_usd)}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 1.8 }]}>{fmtLbp(l.unit_cost_lbp)}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 1.8 }]}>{fmtUsd(l.line_total_usd)}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 1.9 }]}>{fmtLbp(l.line_total_lbp)}</Text>
                </View>
              );
            })}
            {lines.length === 0 ? (
              <View style={s.tr}>
                <Text style={[s.td, s.muted, { flex: 1 }]}>No items.</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>PO ID: {order.id}</Text>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
        </View>
      </Page>
    </Document>
  );
}
