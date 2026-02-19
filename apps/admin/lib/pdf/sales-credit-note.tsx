import { Document, Page, Text, View } from "@react-pdf/renderer";

import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { fmtIsoDate, generatedAtStamp } from "@/lib/pdf/format";
import { pdfStyles as s } from "@/lib/pdf/styles";

type ReturnRow = {
  id: string;
  return_no: string | null;
  invoice_id: string | null;
  refund_method: string | null;
  status: string;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
  restocking_fee_usd?: string | number;
  restocking_fee_lbp?: string | number;
  created_at: string;
};

type ReturnLine = {
  id: string;
  item_id: string;
  qty: string | number;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  line_total_usd: string | number;
  line_total_lbp: string | number;
};

type TaxLine = {
  id: string;
  tax_code_id: string;
  tax_usd: string | number;
  tax_lbp: string | number;
};

type RefundRow = {
  id: string;
  method: string;
  amount_usd: string | number;
  amount_lbp: string | number;
  created_at: string;
};

type LinkedInvoice = {
  id: string;
  invoice_no: string | null;
  customer_name?: string | null;
  customer_id?: string | null;
};

export type SalesCreditNoteDetail = {
  return: ReturnRow;
  lines: ReturnLine[];
  tax_lines: TaxLine[];
  refunds: RefundRow[];
};

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export function SalesCreditNotePdf(props: { detail: SalesCreditNoteDetail; invoice?: LinkedInvoice | null }) {
  const ret = props.detail.return;
  const lines = props.detail.lines || [];
  const taxLines = props.detail.tax_lines || [];
  const refunds = props.detail.refunds || [];
  const inv = props.invoice || null;

  const restockUsd = toNum(ret.restocking_fee_usd);
  const restockLbp = toNum(ret.restocking_fee_lbp);
  const netUsd = toNum(ret.total_usd) - restockUsd;
  const netLbp = toNum(ret.total_lbp) - restockLbp;
  const refundMethods = Array.from(new Set(refunds.map((r) => String(r.method || "").trim()).filter(Boolean)));
  const methodLabel = String(ret.refund_method || "").trim() || (refundMethods.length ? refundMethods.join(", ") : "credit");

  const taxUsd = taxLines.reduce((a, t) => a + toNum(t.tax_usd), 0);
  const taxLbp = taxLines.reduce((a, t) => a + toNum(t.tax_lbp), 0);

  const creditNo = ret.return_no || ret.id;

  return (
    <Document title={`Sales Credit Note ${creditNo}`}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Sales Credit Note</Text>
            <Text style={[s.muted, s.mono]}>{creditNo} · {ret.status}</Text>
            <Text style={[s.muted, s.mono]}>Method {methodLabel}</Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Date {fmtIsoDate(ret.created_at)}</Text>
            {inv?.invoice_no ? <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Invoice {inv.invoice_no}</Text> : null}
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Customer</Text>
            <Text style={s.value}>{inv?.customer_name || inv?.customer_id || "-"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Credit Amount</Text>
            <Text style={[s.value, s.mono]}>{fmtUsdLbp(netUsd, netLbp)}</Text>
            {(restockUsd !== 0 || restockLbp !== 0) ? (
              <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Restocking {fmtUsdLbp(restockUsd, restockLbp)}</Text>
            ) : null}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Tax Impact</Text>
            <Text style={[s.value, s.mono]}>{fmtUsdLbp(taxUsd, taxLbp)}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Items</Text>
          <View style={[s.table, { marginTop: 6 }]}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 4 }]}>Item</Text>
              <Text style={[s.th, s.right, { flex: 1.4 }]}>Qty</Text>
              <Text style={[s.th, s.right, { flex: 2.2 }]}>Unit USD</Text>
              <Text style={[s.th, s.right, { flex: 2.2 }]}>Total USD</Text>
              <Text style={[s.th, s.right, { flex: 2.2 }]}>Total LL</Text>
            </View>
            {lines.map((l) => (
              <View key={l.id} style={s.tr} wrap={false}>
                <Text style={[s.td, s.mono, { flex: 4 }]}>{l.item_id}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.4 }]}>{toNum(l.qty).toLocaleString("en-US", { maximumFractionDigits: 3 })}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.2 }]}>{fmtUsd(l.unit_price_usd)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.2 }]}>{fmtUsd(l.line_total_usd)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.2 }]}>{fmtLbp(l.line_total_lbp)}</Text>
              </View>
            ))}
            {lines.length === 0 ? (
              <View style={s.tr}>
                <Text style={[s.td, s.muted, { flex: 1 }]}>No lines.</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[s.section, { flexDirection: "row", gap: 10 }]}> 
          <View style={[s.box, { flex: 1 }]}> 
            <Text style={s.label}>Refund Entries</Text>
            {refunds.length ? (
              refunds.map((r) => (
                <Text key={r.id} style={[s.value, s.mono, { marginTop: 2 }]}>{String(r.method || "-").toUpperCase()}: {fmtUsdLbp(r.amount_usd, r.amount_lbp)}</Text>
              ))
            ) : (
              <Text style={[s.value, s.mono]}>No refund entries</Text>
            )}
          </View>
          <View style={[s.box, { flex: 1 }]}> 
            <Text style={s.label}>Totals</Text>
            <Text style={[s.value, s.mono]}>Gross {fmtUsdLbp(ret.total_usd, ret.total_lbp)}</Text>
            <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Net Credit {fmtUsdLbp(netUsd, netLbp)}</Text>
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Return ID: {ret.id}</Text>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
        </View>
      </Page>
    </Document>
  );
}
