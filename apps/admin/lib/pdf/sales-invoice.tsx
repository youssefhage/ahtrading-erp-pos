import { Document, Page, Text, View } from "@react-pdf/renderer";

import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { fmtIsoDate, generatedAtStamp } from "@/lib/pdf/format";
import { pdfStyles as s } from "@/lib/pdf/styles";

const OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

type Company = {
  id: string;
  name: string;
  legal_name?: string | null;
  registration_no?: string | null;
  vat_no?: string | null;
};

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
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

export type SalesInvoiceDetail = {
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: SalesPayment[];
  tax_lines: TaxLine[];
};

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export function SalesInvoicePdf(props: { detail: SalesInvoiceDetail; company?: Company | null }) {
  const inv = props.detail.invoice;
  const lines = props.detail.lines || [];
  const payments = props.detail.payments || [];
  const taxLines = props.detail.tax_lines || [];
  const company = props.company || null;
  const showHeader = company?.id === OFFICIAL_COMPANY_ID;

  const paidUsd = payments.reduce((a, p) => a + toNum(p.amount_usd), 0);
  const paidLbp = payments.reduce((a, p) => a + toNum(p.amount_lbp), 0);
  const balUsd = toNum(inv.total_usd) - paidUsd;
  const balLbp = toNum(inv.total_lbp) - paidLbp;

  const taxUsd = taxLines.reduce((a, t) => a + toNum(t.tax_usd), 0);
  const taxLbp = taxLines.reduce((a, t) => a + toNum(t.tax_lbp), 0);

  const docNo = inv.invoice_no || "(draft)";

  return (
    <Document title={`Sales Invoice ${docNo}`}>
      <Page size="A4" style={s.page} wrap>
        {showHeader && company ? (
          <View style={{ marginBottom: 10 }}>
            <Text style={[s.muted, { fontSize: 9 }]}>{company.legal_name || company.name}</Text>
            {company.vat_no ? (
              <Text style={[s.muted, s.mono, { fontSize: 8 }]}>VAT No: {String(company.vat_no)}</Text>
            ) : null}
            {company.registration_no ? (
              <Text style={[s.muted, s.mono, { fontSize: 8 }]}>Reg No: {String(company.registration_no)}</Text>
            ) : null}
          </View>
        ) : null}

        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Sales Invoice</Text>
            <Text style={[s.muted, s.mono]}>{docNo} · {inv.status}</Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Inv {fmtIsoDate(inv.invoice_date)}</Text>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Due {fmtIsoDate(inv.due_date)}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Customer</Text>
            <Text style={s.value}>{inv.customer_id ? (inv.customer_name || inv.customer_id) : "Walk-in"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Warehouse</Text>
            <Text style={s.value}>{inv.warehouse_name || inv.warehouse_id || "-"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Currencies</Text>
            <Text style={s.value}>
              Pricing <Text style={s.mono}>{inv.pricing_currency}</Text> · Settlement{" "}
              <Text style={s.mono}>{inv.settlement_currency}</Text>
            </Text>
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
