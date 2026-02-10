import { Document, Page, Text, View } from "@react-pdf/renderer";

import { fmtLbp, fmtUsd } from "@/lib/money";
import { generatedAtStamp } from "@/lib/pdf/format";
import { pdfStyles as s } from "@/lib/pdf/styles";

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: string | number, frac = 2) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: frac });
}

export type VatRow = { tax_code_id: string; tax_name: string; period: string; base_lbp: string | number; tax_lbp: string | number };
export function VatReportPdf(props: { rows: VatRow[] }) {
  const rows = props.rows || [];
  return (
    <Document title="VAT Report">
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>VAT Report (LBP)</Text>
            <Text style={[s.muted]}>Monthly VAT aggregated from tax lines.</Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Rows {rows.length}</Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.table}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 2.2 }]}>Period</Text>
              <Text style={[s.th, { flex: 5.2 }]}>Tax</Text>
              <Text style={[s.th, s.right, { flex: 2.3 }]}>Base LBP</Text>
              <Text style={[s.th, s.right, { flex: 2.3 }]}>VAT LBP</Text>
            </View>
            {rows.map((r, idx) => (
              <View key={`${r.tax_code_id}:${r.period}:${idx}`} style={s.tr} wrap={false}>
                <Text style={[s.td, s.mono, { flex: 2.2 }]}>{r.period}</Text>
                <Text style={[s.td, { flex: 5.2 }]}>{r.tax_name}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.3 }]}>{fmt(r.base_lbp, 2)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.3 }]}>{fmt(r.tax_lbp, 2)}</Text>
              </View>
            ))}
            {rows.length === 0 ? (
              <View style={s.tr}>
                <Text style={[s.td, s.muted, { flex: 1 }]}>No rows.</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
          <Text style={s.mono}>Report: VAT</Text>
        </View>
      </Page>
    </Document>
  );
}

export type TrialRow = {
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
};
export function TrialBalancePdf(props: { rows: TrialRow[] }) {
  const rows = props.rows || [];
  const totals = rows.reduce(
    (a, r) => ({
      drUsd: a.drUsd + toNum(r.debit_usd),
      crUsd: a.crUsd + toNum(r.credit_usd),
      drLbp: a.drLbp + toNum(r.debit_lbp),
      crLbp: a.crLbp + toNum(r.credit_lbp)
    }),
    { drUsd: 0, crUsd: 0, drLbp: 0, crLbp: 0 }
  );

  return (
    <Document title="Trial Balance">
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Trial Balance</Text>
            <Text style={[s.muted]}>Aggregated from GL entries.</Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Accounts {rows.length}</Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.table}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 1.6 }]}>Code</Text>
              <Text style={[s.th, { flex: 5.2 }]}>Account</Text>
              <Text style={[s.th, s.right, { flex: 1.8 }]}>Dr USD</Text>
              <Text style={[s.th, s.right, { flex: 1.8 }]}>Cr USD</Text>
              <Text style={[s.th, s.right, { flex: 1.8 }]}>Dr LL</Text>
              <Text style={[s.th, s.right, { flex: 1.8 }]}>Cr LL</Text>
            </View>
            {rows.map((r) => (
              <View key={r.account_code} style={s.tr} wrap={false}>
                <Text style={[s.td, s.mono, { flex: 1.6 }]}>{r.account_code}</Text>
                <Text style={[s.td, { flex: 5.2 }]}>{r.name_en || ""}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.8 }]}>{fmt(r.debit_usd, 2)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.8 }]}>{fmt(r.credit_usd, 2)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.8 }]}>{fmt(r.debit_lbp, 0)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.8 }]}>{fmt(r.credit_lbp, 0)}</Text>
              </View>
            ))}
            <View style={[s.tr, { backgroundColor: "#f6f6f6" }]} wrap={false}>
              <Text style={[s.td, { flex: 1.6 }]} />
              <Text style={[s.td, { flex: 5.2, fontWeight: 700 }]}>Totals</Text>
              <Text style={[s.td, s.right, s.mono, { flex: 1.8, fontWeight: 700 }]}>{fmt(totals.drUsd, 2)}</Text>
              <Text style={[s.td, s.right, s.mono, { flex: 1.8, fontWeight: 700 }]}>{fmt(totals.crUsd, 2)}</Text>
              <Text style={[s.td, s.right, s.mono, { flex: 1.8, fontWeight: 700 }]}>{fmt(totals.drLbp, 0)}</Text>
              <Text style={[s.td, s.right, s.mono, { flex: 1.8, fontWeight: 700 }]}>{fmt(totals.crLbp, 0)}</Text>
            </View>
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
          <Text style={s.mono}>Report: Trial Balance</Text>
        </View>
      </Page>
    </Document>
  );
}

export type PlRow = { account_code: string; name_en: string | null; kind: "revenue" | "expense"; amount_usd: string | number; amount_lbp: string | number };
export type PlRes = {
  start_date: string;
  end_date: string;
  revenue_usd: string | number;
  revenue_lbp: string | number;
  expense_usd: string | number;
  expense_lbp: string | number;
  net_profit_usd: string | number;
  net_profit_lbp: string | number;
  rows: PlRow[];
};
export function ProfitLossPdf(props: { data: PlRes }) {
  const data = props.data;
  const rows = data.rows || [];

  return (
    <Document title="Profit & Loss">
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Profit &amp; Loss</Text>
            <Text style={[s.muted]}>
              Period <Text style={s.mono}>{data.start_date} → {data.end_date}</Text>
            </Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Rows {rows.length}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Revenue</Text>
            <Text style={[s.value, s.mono]}>{fmtUsd(data.revenue_usd)}</Text>
            <Text style={[s.mono, { marginTop: 2 }]}>{fmtLbp(data.revenue_lbp)}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Expenses</Text>
            <Text style={[s.value, s.mono]}>{fmtUsd(data.expense_usd)}</Text>
            <Text style={[s.mono, { marginTop: 2 }]}>{fmtLbp(data.expense_lbp)}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Net Profit</Text>
            <Text style={[s.value, s.mono]}>{fmtUsd(data.net_profit_usd)}</Text>
            <Text style={[s.mono, { marginTop: 2 }]}>{fmtLbp(data.net_profit_lbp)}</Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.table}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 1.4 }]}>Kind</Text>
              <Text style={[s.th, { flex: 1.6 }]}>Code</Text>
              <Text style={[s.th, { flex: 5.0 }]}>Account</Text>
              <Text style={[s.th, s.right, { flex: 2.0 }]}>USD</Text>
              <Text style={[s.th, s.right, { flex: 2.0 }]}>LL</Text>
            </View>
            {rows.map((r) => (
              <View key={`${r.kind}-${r.account_code}`} style={s.tr} wrap={false}>
                <Text style={[s.td, { flex: 1.4 }]}>{r.kind}</Text>
                <Text style={[s.td, s.mono, { flex: 1.6 }]}>{r.account_code}</Text>
                <Text style={[s.td, { flex: 5.0 }]}>{r.name_en || "-"}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.0 }]}>{fmtUsd(r.amount_usd)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.0 }]}>{fmtLbp(r.amount_lbp)}</Text>
              </View>
            ))}
            {rows.length === 0 ? (
              <View style={s.tr}>
                <Text style={[s.td, s.muted, { flex: 1 }]}>No rows.</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
          <Text style={s.mono}>Report: Profit &amp; Loss</Text>
        </View>
      </Page>
    </Document>
  );
}

export type BsRow = { account_code: string; name_en: string | null; normal_balance: string; balance_usd: string | number; balance_lbp: string | number };
export type BsRes = { as_of: string; rows: BsRow[] };
export function BalanceSheetPdf(props: { data: BsRes }) {
  const data = props.data;
  const rows = data.rows || [];

  return (
    <Document title="Balance Sheet">
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Balance Sheet</Text>
            <Text style={[s.muted]}>
              As of <Text style={s.mono}>{data.as_of}</Text>
            </Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Accounts {rows.length}</Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.table}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 1.6 }]}>Code</Text>
              <Text style={[s.th, { flex: 5.6 }]}>Account</Text>
              <Text style={[s.th, { flex: 1.4 }]}>Normal</Text>
              <Text style={[s.th, s.right, { flex: 2.0 }]}>USD</Text>
              <Text style={[s.th, s.right, { flex: 2.0 }]}>LL</Text>
            </View>
            {rows.map((r) => (
              <View key={r.account_code} style={s.tr} wrap={false}>
                <Text style={[s.td, s.mono, { flex: 1.6 }]}>{r.account_code}</Text>
                <Text style={[s.td, { flex: 5.6 }]}>{r.name_en || "-"}</Text>
                <Text style={[s.td, { flex: 1.4 }]}>{r.normal_balance}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.0 }]}>{fmt(r.balance_usd, 2)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 2.0 }]}>{fmt(r.balance_lbp, 0)}</Text>
              </View>
            ))}
            {rows.length === 0 ? (
              <View style={s.tr}>
                <Text style={[s.td, s.muted, { flex: 1 }]}>No rows.</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
          <Text style={s.mono}>Report: Balance Sheet</Text>
        </View>
      </Page>
    </Document>
  );
}

export type GlRow = {
  journal_date: string;
  journal_no: string;
  account_code: string;
  name_en: string | null;
  debit_usd: string | number;
  credit_usd: string | number;
  debit_lbp: string | number;
  credit_lbp: string | number;
  memo: string | null;
};
export function GeneralLedgerPdf(props: { rows: GlRow[]; startDate?: string; endDate?: string }) {
  const rows = props.rows || [];
  const label = props.startDate || props.endDate ? `${props.startDate || "…"} → ${props.endDate || "…"}`
    : "All dates";

  return (
    <Document title="General Ledger">
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>General Ledger</Text>
            <Text style={[s.muted]}>
              Period <Text style={s.mono}>{label}</Text>
            </Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Rows {rows.length}</Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.table}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 1.4 }]}>Date</Text>
              <Text style={[s.th, { flex: 1.7 }]}>Journal</Text>
              <Text style={[s.th, { flex: 3.8 }]}>Account</Text>
              <Text style={[s.th, s.right, { flex: 1.4 }]}>Dr USD</Text>
              <Text style={[s.th, s.right, { flex: 1.4 }]}>Cr USD</Text>
              <Text style={[s.th, s.right, { flex: 1.4 }]}>Dr LL</Text>
              <Text style={[s.th, s.right, { flex: 1.4 }]}>Cr LL</Text>
              <Text style={[s.th, { flex: 3.0 }]}>Memo</Text>
            </View>
            {rows.map((r, idx) => (
              <View key={`${r.journal_no}:${r.account_code}:${idx}`} style={s.tr} wrap={false}>
                <Text style={[s.td, s.mono, { flex: 1.4 }]}>{String(r.journal_date).slice(0, 10)}</Text>
                <Text style={[s.td, s.mono, { flex: 1.7 }]}>{r.journal_no}</Text>
                <View style={[s.td, { flex: 3.8 }]}>
                  <Text style={[s.mono, { fontSize: 8, color: "#444" }]}>{r.account_code}</Text>
                  <Text style={{ marginTop: 2 }}>{r.name_en || ""}</Text>
                </View>
                <Text style={[s.td, s.right, s.mono, { flex: 1.4 }]}>{fmt(r.debit_usd, 2)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.4 }]}>{fmt(r.credit_usd, 2)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.4 }]}>{fmt(r.debit_lbp, 0)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.4 }]}>{fmt(r.credit_lbp, 0)}</Text>
                <Text style={[s.td, { flex: 3.0 }]}>{r.memo || ""}</Text>
              </View>
            ))}
            {rows.length === 0 ? (
              <View style={s.tr}>
                <Text style={[s.td, s.muted, { flex: 1 }]}>No rows.</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
          <Text style={s.mono}>Report: General Ledger</Text>
        </View>
      </Page>
    </Document>
  );
}

export type SoaParty = { id: string; code?: string | null; name: string };
export type SoaRow = {
  tx_date: string;
  kind: string;
  ref?: string | null;
  memo?: string | null;
  delta_usd: string | number;
  delta_lbp: string | number;
  balance_usd: string | number;
  balance_lbp: string | number;
};

function soaKindLabel(kind: string) {
  const k = String(kind || "").toLowerCase();
  if (k === "invoice") return "Invoice";
  if (k === "payment") return "Payment";
  if (k === "return") return "Return";
  if (k === "refund") return "Refund";
  if (k === "credit_note") return "Credit Note";
  return kind || "-";
}

export function SoaPdf(props: {
  title: string;
  partyLabel: string;
  party: SoaParty;
  startDate: string;
  endDate: string;
  openingUsd: string | number;
  openingLbp: string | number;
  closingUsd: string | number;
  closingLbp: string | number;
  rows: SoaRow[];
}) {
  const rows = props.rows || [];
  const subtitle = `${props.partyLabel}: ${props.party?.name || props.party?.id || ""}${
    props.party?.code ? ` (${props.party.code})` : ""
  }`;
  return (
    <Document title={props.title}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>{props.title}</Text>
            <Text style={[s.muted]}>{subtitle}</Text>
            <Text style={[s.muted, s.mono]}>
              {props.startDate} to {props.endDate}
            </Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Rows {rows.length}</Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.table}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 1.4 }]}>Date</Text>
              <Text style={[s.th, { flex: 1.6 }]}>Type</Text>
              <Text style={[s.th, { flex: 1.7 }]}>Ref</Text>
              <Text style={[s.th, { flex: 2.6 }]}>Memo</Text>
              <Text style={[s.th, s.right, { flex: 1.7 }]}>Delta USD</Text>
              <Text style={[s.th, s.right, { flex: 1.7 }]}>Delta LL</Text>
              <Text style={[s.th, s.right, { flex: 1.7 }]}>Balance USD</Text>
              <Text style={[s.th, s.right, { flex: 1.7 }]}>Balance LL</Text>
            </View>

            {/* Opening row (informational). */}
            <View style={[s.tr, { backgroundColor: "#f6f6f6" }]} wrap={false}>
              <Text style={[s.td, s.mono, { flex: 1.4 }]}>{props.startDate}</Text>
              <Text style={[s.td, { flex: 1.6 }]}>Opening</Text>
              <Text style={[s.td, s.mono, { flex: 1.7 }]} />
              <Text style={[s.td, { flex: 2.6 }]} />
              <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmt(props.openingUsd, 2)}</Text>
              <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmt(props.openingLbp, 0)}</Text>
              <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmt(props.openingUsd, 2)}</Text>
              <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmt(props.openingLbp, 0)}</Text>
            </View>

            {rows.map((r, idx) => (
              <View key={`${r.tx_date}:${r.kind}:${idx}`} style={s.tr} wrap={false}>
                <Text style={[s.td, s.mono, { flex: 1.4 }]}>{r.tx_date}</Text>
                <Text style={[s.td, { flex: 1.6 }]}>{soaKindLabel(r.kind)}</Text>
                <Text style={[s.td, s.mono, { flex: 1.7 }]}>{r.ref || ""}</Text>
                <Text style={[s.td, { flex: 2.6 }]}>{r.memo || ""}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmt(r.delta_usd, 2)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmt(r.delta_lbp, 0)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmt(r.balance_usd, 2)}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmt(r.balance_lbp, 0)}</Text>
              </View>
            ))}
            {rows.length === 0 ? (
              <View style={s.tr}>
                <Text style={[s.td, s.muted, { flex: 1 }]}>No transactions in range.</Text>
              </View>
            ) : null}

            {/* Closing summary */}
            <View style={[s.tr, { backgroundColor: "#f6f6f6" }]} wrap={false}>
              <Text style={[s.td, { flex: 1.4 }]} />
              <Text style={[s.td, { flex: 1.6, fontWeight: 700 }]}>Closing</Text>
              <Text style={[s.td, { flex: 1.7 }]} />
              <Text style={[s.td, { flex: 2.6 }]} />
              <Text style={[s.td, { flex: 1.7 }]} />
              <Text style={[s.td, { flex: 1.7 }]} />
              <Text style={[s.td, s.right, s.mono, { flex: 1.7, fontWeight: 700 }]}>{fmt(props.closingUsd, 2)}</Text>
              <Text style={[s.td, s.right, s.mono, { flex: 1.7, fontWeight: 700 }]}>{fmt(props.closingLbp, 0)}</Text>
            </View>
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Generated: {generatedAtStamp()}</Text>
          <Text style={s.mono}>Report: SOA</Text>
        </View>
      </Page>
    </Document>
  );
}
