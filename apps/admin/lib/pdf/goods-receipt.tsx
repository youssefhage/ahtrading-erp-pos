import { Document, Page, Text, View } from "@react-pdf/renderer";

import { fmtLbp, fmtUsd } from "@/lib/money";
import { fmtIsoDate, generatedAtStamp } from "@/lib/pdf/format";
import { pdfStyles as s } from "@/lib/pdf/styles";

export type SimpleParty = { id: string; name?: string | null };
export type SimpleItem = { id: string; sku?: string | null; name?: string | null };
export type SimpleWarehouse = { id: string; name?: string | null };

type ReceiptRow = {
  id: string;
  receipt_no: string | null;
  supplier_id: string | null;
  supplier_ref?: string | null;
  warehouse_id: string | null;
  purchase_order_id?: string | null;
  purchase_order_no?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  received_at?: string | null;
  exchange_rate: string | number;
};

type ReceiptLine = {
  id: string;
  item_id: string;
  qty: string | number;
  batch_no: string | null;
  expiry_date: string | null;
};

export type GoodsReceiptDetail = { receipt: ReceiptRow; lines: ReceiptLine[] };

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export function GoodsReceiptPdf(props: {
  detail: GoodsReceiptDetail;
  supplierName?: string;
  warehouseName?: string;
  itemsById?: Map<string, SimpleItem>;
}) {
  const receipt = props.detail.receipt;
  const lines = props.detail.lines || [];
  const itemsById = props.itemsById || new Map();

  const docNo = receipt.receipt_no || "(draft)";
  const supplierLabel = props.supplierName || (receipt.supplier_id || "-");
  const whLabel = props.warehouseName || (receipt.warehouse_id || "-");

  return (
    <Document title={`Goods Receipt ${docNo}`}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Goods Receipt</Text>
            <Text style={[s.muted, s.mono]}>{docNo} · {receipt.status}</Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Received {fmtIsoDate(receipt.received_at)}</Text>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Exchange {String(Math.round(toNum(receipt.exchange_rate)))}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Supplier</Text>
            <Text style={s.value}>{supplierLabel}</Text>
            {receipt.supplier_ref ? <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Ref {receipt.supplier_ref}</Text> : null}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Warehouse</Text>
            <Text style={s.value}>{whLabel}</Text>
            {receipt.purchase_order_id ? (
              <Text style={[s.muted, s.mono, { marginTop: 3 }]}>PO {receipt.purchase_order_no || receipt.purchase_order_id}</Text>
            ) : null}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Totals</Text>
            <Text style={[s.value, s.mono]}>{fmtUsd(receipt.total_usd)}</Text>
            <Text style={[s.mono, { marginTop: 2 }]}>{fmtLbp(receipt.total_lbp)}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Lines</Text>
          <View style={[s.table, { marginTop: 6 }]}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 6 }]}>Item</Text>
              <Text style={[s.th, s.right, { flex: 1.5 }]}>Qty</Text>
              <Text style={[s.th, { flex: 2.3 }]}>Batch</Text>
              <Text style={[s.th, { flex: 2.2 }]}>Expiry</Text>
            </View>
            {lines.map((l) => {
              const it = itemsById.get(l.item_id);
              return (
                <View key={l.id} style={s.tr} wrap={false}>
                  <View style={[s.td, { flex: 6 }]}>
                    <Text style={[s.muted, s.mono, { fontSize: 8 }]}>{it?.sku || l.item_id}</Text>
                    <Text style={{ marginTop: 2 }}>{it?.name || "-"}</Text>
                  </View>
                  <Text style={[s.td, s.right, s.mono, { flex: 1.5 }]}>{toNum(l.qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</Text>
                  <Text style={[s.td, s.mono, { flex: 2.3 }]}>{l.batch_no || "-"}</Text>
                  <Text style={[s.td, s.mono, { flex: 2.2 }]}>{fmtIsoDate(l.expiry_date)}</Text>
                </View>
              );
            })}
            {lines.length === 0 ? (
              <View style={s.tr}>
                <Text style={[s.td, s.muted, { flex: 1 }]}>No lines.</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>GR ID: {receipt.id}</Text>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
        </View>
      </Page>
    </Document>
  );
}

