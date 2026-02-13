import { Document, Page, Text, View } from "@react-pdf/renderer";

import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { fmtIsoDate, generatedAtStamp } from "@/lib/pdf/format";
import { pdfStyles as s } from "@/lib/pdf/styles";

type InvoiceRow = {
  id: string;
  invoice_no: string;
  supplier_ref?: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  goods_receipt_id?: string | null;
  goods_receipt_no?: string | null;
  is_on_hold?: boolean;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
  tax_code_id?: string | null;
  invoice_date: string;
  due_date: string;
  created_at: string;
};

type InvoiceLine = {
  id: string;
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  supplier_item_code?: string | null;
  supplier_item_name?: string | null;
  qty: string | number;
  unit_cost_usd: string | number;
  unit_cost_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
  batch_no: string | null;
  expiry_date: string | null;
};

type SupplierPayment = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  reference?: string | null;
  created_at: string;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  tax_usd: string | number;
  tax_lbp: string | number;
};

export type SupplierInvoiceDetail = {
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: SupplierPayment[];
  tax_lines: TaxLine[];
};

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export function SupplierInvoicePdf(props: { detail: SupplierInvoiceDetail }) {
  const inv = props.detail.invoice;
  const lines = props.detail.lines || [];
  const payments = props.detail.payments || [];
  const taxLines = props.detail.tax_lines || [];

  const paidUsd = payments.reduce((a, p) => a + toNum(p.amount_usd), 0);
  const paidLbp = payments.reduce((a, p) => a + toNum(p.amount_lbp), 0);
  const balUsd = toNum(inv.total_usd) - paidUsd;
  const balLbp = toNum(inv.total_lbp) - paidLbp;

  const taxUsd = taxLines.reduce((a, t) => a + toNum(t.tax_usd), 0);
  const taxLbp = taxLines.reduce((a, t) => a + toNum(t.tax_lbp), 0);

  return (
    <Document title={`Supplier Invoice ${inv.invoice_no}`}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Supplier Invoice</Text>
            <Text style={[s.muted, s.mono]}>
              {inv.invoice_no} · {inv.status}
              {inv.is_on_hold ? " · HOLD" : ""}
            </Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Inv {fmtIsoDate(inv.invoice_date)}</Text>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Due {fmtIsoDate(inv.due_date)}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Supplier</Text>
            <Text style={s.value}>{inv.supplier_name || inv.supplier_id || "-"}</Text>
            {inv.supplier_ref ? <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Ref {inv.supplier_ref}</Text> : null}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Goods Receipt</Text>
            <Text style={s.value}>{inv.goods_receipt_no || inv.goods_receipt_id || "-"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Tax / Rate</Text>
            <Text style={[s.value, s.mono]}>{inv.tax_code_id || "-"}</Text>
            <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Exchange {String(inv.exchange_rate || "-")}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Items</Text>
          <View style={[s.table, { marginTop: 6 }]}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 4.2 }]}>Item</Text>
              <Text style={[s.th, { flex: 3.2 }]}>Supplier</Text>
              <Text style={[s.th, s.right, { flex: 1.1 }]}>Qty</Text>
              <Text style={[s.th, s.right, { flex: 2.0 }]}>Total USD</Text>
              <Text style={[s.th, s.right, { flex: 2.1 }]}>Total LL</Text>
            </View>
            {lines.map((l) => (
              <View key={l.id} style={s.tr} wrap={false}>
                <View style={[s.td, { flex: 4.2 }]}>
                  <Text style={[s.mono, { fontSize: 8, color: "#444" }]}>{l.item_sku || l.item_id}</Text>
                  <Text style={{ marginTop: 2 }}>{l.item_name || "-"}</Text>
                  {l.batch_no ? (
                    <Text style={[s.muted, s.mono, { marginTop: 2, fontSize: 8 }]}>
                      Batch {l.batch_no}
                      {l.expiry_date ? ` · Exp ${fmtIsoDate(l.expiry_date)}` : ""}
                    </Text>
                  ) : null}
                </View>
                <View style={[s.td, { flex: 3.2 }]}>
                  <Text style={[s.mono, { fontSize: 8, color: "#444" }]}>{l.supplier_item_code || "-"}</Text>
                  <Text style={{ marginTop: 2 }}>{l.supplier_item_name || "-"}</Text>
                </View>
                <Text style={[s.td, s.right, s.mono, { flex: 1.1 }]}>{toNum(l.qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.0 }]}>{fmtUsd(l.line_total_usd)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.1 }]}>{fmtLbp(l.line_total_lbp)}</Text>
              </View>
            ))}
            {lines.length === 0 ? (
              <View style={s.tr}>
                <Text style={[s.td, s.muted, { flex: 1 }]}>No items.</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[s.section, { flexDirection: "row", gap: 10 }]}>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.label}>Tax</Text>
            <Text style={[s.value, s.mono]}>
              {fmtUsdLbp(taxUsd, taxLbp)}
            </Text>
          </View>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.label}>Totals</Text>
            <Text style={[s.value, s.mono]}>
              {fmtUsdLbp(inv.total_usd, inv.total_lbp)}
            </Text>
            <Text style={[s.muted, s.mono, { marginTop: 3 }]}>
              Paid {fmtUsdLbp(paidUsd, paidLbp)}
            </Text>
            <Text style={[{ marginTop: 3 }, s.mono]}>
              Balance {fmtUsdLbp(balUsd, balLbp)}
            </Text>
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Invoice ID: {inv.id}</Text>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
        </View>
      </Page>
    </Document>
  );
}
