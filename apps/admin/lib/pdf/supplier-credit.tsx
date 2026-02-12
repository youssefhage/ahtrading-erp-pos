import { Document, Page, Text, View } from "@react-pdf/renderer";

import { fmtLbp, fmtLbpMaybe, fmtUsd, fmtUsdLbp, fmtUsdMaybe } from "@/lib/money";
import { fmtIsoDate, generatedAtStamp } from "@/lib/pdf/format";
import { pdfStyles as s } from "@/lib/pdf/styles";

type CreditDoc = {
  id: string;
  credit_no: string;
  status: "draft" | "posted" | "canceled";
  supplier_id: string;
  supplier_name: string | null;
  kind: "expense" | "receipt";
  goods_receipt_id: string | null;
  goods_receipt_no?: string | null;
  credit_date: string;
  rate_type: string;
  exchange_rate: string | number;
  memo: string | null;
  total_usd: string | number;
  total_lbp: string | number;
  cancel_reason?: string | null;
};

type LineRow = { id: string; line_no: number | string; description: string | null; amount_usd: string | number; amount_lbp: string | number };
type AppRow = { id: string; supplier_invoice_id: string; invoice_no: string; invoice_date: string; amount_usd: string | number; amount_lbp: string | number };
type AllocRow = { id: string; goods_receipt_line_id: string; batch_id: string | null; amount_usd: string | number; amount_lbp: string | number };

export type SupplierCreditDetail = { credit: CreditDoc; lines: LineRow[]; applications: AppRow[]; allocations: AllocRow[] };

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export function SupplierCreditPdf(props: { detail: SupplierCreditDetail }) {
  const credit = props.detail.credit;
  const lines = props.detail.lines || [];
  const apps = props.detail.applications || [];
  const allocs = props.detail.allocations || [];

  const appliedUsd = apps.reduce((a, r) => a + toNum(r.amount_usd), 0);
  const appliedLbp = apps.reduce((a, r) => a + toNum(r.amount_lbp), 0);
  const remainingUsd = toNum(credit.total_usd) - appliedUsd;
  const remainingLbp = toNum(credit.total_lbp) - appliedLbp;

  return (
    <Document title={`Supplier Credit ${credit.credit_no}`}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Supplier Credit</Text>
            <Text style={[s.muted, s.mono]}>
              {credit.credit_no} · {credit.status} · {credit.kind}
            </Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Date {fmtIsoDate(credit.credit_date)}</Text>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>
              Rate {credit.rate_type} @ {String(credit.exchange_rate ?? "")}
            </Text>
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Supplier</Text>
            <Text style={s.value}>{credit.supplier_name || credit.supplier_id}</Text>
            {credit.goods_receipt_id ? (
              <Text style={[s.muted, s.mono, { marginTop: 3 }]}>
                Receipt {credit.goods_receipt_no || credit.goods_receipt_id}
              </Text>
            ) : null}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Totals</Text>
            <Text style={[s.value, s.mono]}>{fmtUsdMaybe(credit.total_usd)}</Text>
            <Text style={[s.mono, { marginTop: 2 }]}>
              {fmtLbpMaybe(credit.total_lbp, { dashIfZero: toNum(credit.total_usd) !== 0 })}
            </Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Applied / Remaining</Text>
            <Text style={[s.muted, s.mono, { marginTop: 4 }]}>
              Applied {fmtUsdLbp(appliedUsd, appliedLbp)}
            </Text>
            <Text style={[s.value, s.mono, { marginTop: 4 }]}>
              Remaining {fmtUsdLbp(remainingUsd, remainingLbp)}
            </Text>
          </View>
        </View>

        {credit.memo ? (
          <View style={s.section}>
            <Text style={s.h2}>Memo</Text>
            <View style={[s.box, { marginTop: 6 }]}>
              <Text>{credit.memo}</Text>
            </View>
          </View>
        ) : null}

        <View style={s.section}>
          <Text style={s.h2}>Credit Lines</Text>
          <View style={[s.table, { marginTop: 6 }]}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 1.0 }]}>Line</Text>
              <Text style={[s.th, { flex: 6.2 }]}>Description</Text>
              <Text style={[s.th, s.right, { flex: 2.4 }]}>USD</Text>
              <Text style={[s.th, s.right, { flex: 2.4 }]}>LL</Text>
            </View>
            {lines.map((l) => (
              <View key={l.id} style={s.tr} wrap={false}>
                <Text style={[s.td, s.mono, { flex: 1.0 }]}>{String(l.line_no)}</Text>
                <Text style={[s.td, { flex: 6.2 }]}>{l.description || "-"}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.4 }]}>{fmtUsd(l.amount_usd)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.4 }]}>{fmtLbp(l.amount_lbp)}</Text>
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
          <View style={[{ flex: 1 }]}>
            <Text style={s.h2}>Applications</Text>
            <View style={[s.table, { marginTop: 6 }]}>
              <View style={s.thead} fixed>
                <Text style={[s.th, { flex: 4.0 }]}>Invoice</Text>
                <Text style={[s.th, { flex: 2.0 }]}>Date</Text>
                <Text style={[s.th, s.right, { flex: 2.2 }]}>USD</Text>
                <Text style={[s.th, s.right, { flex: 2.2 }]}>LL</Text>
              </View>
              {apps.map((a) => (
                <View key={a.id} style={s.tr} wrap={false}>
                  <View style={[s.td, { flex: 4.0 }]}>
                    <Text style={[s.mono, { fontSize: 8, color: "#444" }]}>{a.invoice_no}</Text>
                    <Text style={[s.muted, s.mono, { fontSize: 7, marginTop: 2 }]}>{a.supplier_invoice_id}</Text>
                  </View>
                  <Text style={[s.td, s.mono, { flex: 2.0 }]}>{fmtIsoDate(a.invoice_date)}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 2.2 }]}>{fmtUsd(a.amount_usd)}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 2.2 }]}>{fmtLbp(a.amount_lbp)}</Text>
                </View>
              ))}
              {apps.length === 0 ? (
                <View style={s.tr}>
                  <Text style={[s.td, s.muted, { flex: 1 }]}>No applications.</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={[{ flex: 1 }]}>
            <Text style={s.h2}>Allocations</Text>
            <View style={[s.table, { marginTop: 6 }]}>
              <View style={s.thead} fixed>
                <Text style={[s.th, { flex: 3.5 }]}>GR Line</Text>
                <Text style={[s.th, { flex: 2.5 }]}>Batch</Text>
                <Text style={[s.th, s.right, { flex: 2.0 }]}>USD</Text>
                <Text style={[s.th, s.right, { flex: 2.0 }]}>LL</Text>
              </View>
              {allocs.map((a) => (
                <View key={a.id} style={s.tr} wrap={false}>
                  <Text style={[s.td, s.mono, { flex: 3.5 }]}>{a.goods_receipt_line_id}</Text>
                  <Text style={[s.td, s.mono, { flex: 2.5 }]}>{a.batch_id || "-"}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 2.0 }]}>{fmtUsd(a.amount_usd)}</Text>
                  <Text style={[s.td, s.right, s.mono, { flex: 2.0 }]}>{fmtLbp(a.amount_lbp)}</Text>
                </View>
              ))}
              {allocs.length === 0 ? (
                <View style={s.tr}>
                  <Text style={[s.td, s.muted, { flex: 1 }]}>No allocations.</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Credit ID: {credit.id}</Text>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
        </View>
      </Page>
    </Document>
  );
}
