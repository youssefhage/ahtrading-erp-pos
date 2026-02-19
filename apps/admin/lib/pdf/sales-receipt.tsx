import { Document, Page, Text, View } from "@react-pdf/renderer";

import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { fmtIsoDate, generatedAtStamp } from "@/lib/pdf/format";
import { pdfStyles as s } from "@/lib/pdf/styles";

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  receipt_no?: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  subtotal_usd?: string | number;
  subtotal_lbp?: string | number;
  exchange_rate: string | number;
  pricing_currency: string;
  settlement_currency: string;
  invoice_date?: string;
  due_date?: string | null;
  created_at: string;
};

type InvoiceLine = {
  id: string;
  item_id: string;
  item_sku?: string | null;
  item_name?: string | null;
  qty: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type SalesPayment = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  created_at: string;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  tax_usd: string | number;
  tax_lbp: string | number;
};

export type SalesReceiptDetail = {
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: SalesPayment[];
  tax_lines: TaxLine[];
};

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export function SalesReceiptPdf(props: { detail: SalesReceiptDetail }) {
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

  const receiptNo = inv.receipt_no || inv.invoice_no || inv.id;

  return (
    <Document title={`Sales Receipt ${receiptNo}`}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Sales Receipt</Text>
            <Text style={[s.muted, s.mono]}>{receiptNo} · {inv.status}</Text>
            {inv.invoice_no ? <Text style={[s.muted, s.mono]}>Invoice {inv.invoice_no}</Text> : null}
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Date {fmtIsoDate(inv.invoice_date || inv.created_at)}</Text>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Settlement {String(inv.settlement_currency || "USD")}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Customer</Text>
            <Text style={s.value}>{inv.customer_id ? (inv.customer_name || inv.customer_id) : "Walk-in"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Subtotal</Text>
            <Text style={[s.value, s.mono]}>{fmtUsdLbp(inv.subtotal_usd ?? inv.total_usd, inv.subtotal_lbp ?? inv.total_lbp)}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Tax</Text>
            <Text style={[s.value, s.mono]}>{fmtUsdLbp(taxUsd, taxLbp)}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Items</Text>
          <View style={[s.table, { marginTop: 6 }]}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 6 }]}>Item</Text>
              <Text style={[s.th, s.right, { flex: 1.4 }]}>Qty</Text>
              <Text style={[s.th, s.right, { flex: 2.3 }]}>Total USD</Text>
              <Text style={[s.th, s.right, { flex: 2.3 }]}>Total LL</Text>
            </View>
            {lines.map((l) => (
              <View key={l.id} style={s.tr} wrap={false}>
                <View style={[s.td, { flex: 6 }]}> 
                  <Text style={[s.mono, { fontSize: 8, color: "#444" }]}>{l.item_sku || l.item_id}</Text>
                  <Text style={{ marginTop: 2 }}>{l.item_name || "-"}</Text>
                </View>
                <Text style={[s.td, s.right, s.mono, { flex: 1.4 }]}>{toNum(l.qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.3 }]}>{fmtUsd(l.line_total_usd)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.3 }]}>{fmtLbp(l.line_total_lbp)}</Text>
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
            <Text style={s.label}>Payments</Text>
            {payments.length ? (
              payments.map((p) => (
                <Text key={p.id} style={[s.value, s.mono, { marginTop: 2 }]}> 
                  {String(p.method || "-").toUpperCase()}: {fmtUsdLbp(p.amount_usd, p.amount_lbp)}
                </Text>
              ))
            ) : (
              <Text style={[s.value, s.mono]}>No payments</Text>
            )}
          </View>
          <View style={[s.box, { flex: 1 }]}> 
            <Text style={s.label}>Totals</Text>
            <Text style={[s.value, s.mono]}>Total {fmtUsdLbp(inv.total_usd, inv.total_lbp)}</Text>
            <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Paid {fmtUsdLbp(paidUsd, paidLbp)}</Text>
            <Text style={[s.mono, { marginTop: 3 }]}>Balance {fmtUsdLbp(balUsd, balLbp)}</Text>
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
