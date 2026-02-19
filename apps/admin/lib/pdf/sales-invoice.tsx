import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { fmtLbp, fmtUsd, fmtUsdLbp } from "@/lib/money";
import { fmtIsoDate, generatedAtStamp } from "@/lib/pdf/format";
import { pdfStyles as s } from "@/lib/pdf/styles";

const OFFICIAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const SALES_INVOICE_PDF_TEMPLATES = ["official_classic", "official_compact", "standard"] as const;
export type SalesInvoicePdfTemplate = (typeof SALES_INVOICE_PDF_TEMPLATES)[number];

type Company = {
  id: string;
  name: string;
  legal_name?: string | null;
  registration_no?: string | null;
  vat_no?: string | null;
};

type Customer = {
  id: string;
  code?: string | null;
  name?: string | null;
  legal_name?: string | null;
  tax_id?: string | null;
  vat_no?: string | null;
  phone?: string | null;
  email?: string | null;
};

type PartyAddress = {
  id: string;
  label?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  postal_code?: string | null;
  is_default?: boolean;
};

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  customer_id: string | null;
  customer_name?: string | null;
  status: string;
  subtotal_usd?: string | number;
  subtotal_lbp?: string | number;
  discount_total_usd?: string | number;
  discount_total_lbp?: string | number;
  total_usd: string | number;
  total_lbp: string | number;
  exchange_rate: string | number;
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  pricing_currency: string;
  settlement_currency: string;
  receipt_no?: string | null;
  receipt_meta?: unknown;
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
  uom?: string | null;
  qty_factor?: string | number | null;
  qty_entered?: string | number | null;
  unit_price_usd: string | number;
  unit_price_lbp: string | number;
  unit_price_entered_usd?: string | number | null;
  unit_price_entered_lbp?: string | number | null;
  discount_pct?: string | number | null;
  discount_amount_usd?: string | number | null;
  discount_amount_lbp?: string | number | null;
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
  print_policy?: {
    sales_invoice_pdf_template?: string | null;
  } | null;
};

function normalizePdfTemplate(value: unknown): SalesInvoicePdfTemplate | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if ((SALES_INVOICE_PDF_TEMPLATES as readonly string[]).includes(raw)) {
    return raw as SalesInvoicePdfTemplate;
  }
  return null;
}

function toNum(v: unknown) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtPlainMoney(amount: unknown) {
  return toNum(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(qty: unknown) {
  return toNum(qty).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function fmtUsDate(iso?: string | null) {
  const raw = String(iso || "").trim();
  if (!raw) return "-";
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear());
    return `${mm}/${dd}/${yy}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw.slice(5, 7)}/${raw.slice(8, 10)}/${raw.slice(0, 4)}`;
  }
  return raw;
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function metaString(meta: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const v = meta[key];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function pickDefaultAddress(addresses: PartyAddress[] | undefined): PartyAddress | null {
  const list = addresses || [];
  if (!list.length) return null;
  return list.find((a) => a.is_default) || list[0] || null;
}

function addressLines(a: PartyAddress | null): string[] {
  if (!a) return [];
  const lines: string[] = [];
  const line1 = String(a.line1 || "").trim();
  const line2 = String(a.line2 || "").trim();
  const city = String(a.city || "").trim();
  const region = String(a.region || "").trim();
  const country = String(a.country || "").trim();
  const postal = String(a.postal_code || "").trim();

  if (line1) lines.push(line1);
  if (line2) lines.push(line2);

  const place = [city, region, postal].filter(Boolean).join(", ");
  if (place) lines.push(place);
  if (country) lines.push(country);
  return lines;
}

function deliveryAddressLines(meta: Record<string, unknown>, fallback: PartyAddress | null): string[] {
  const candidate = meta.delivery_address || meta.deliveryAddress || meta.ship_to || null;
  if (typeof candidate === "string") {
    return candidate
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (candidate && typeof candidate === "object") {
    const obj = candidate as Record<string, unknown>;
    const line1 = String(obj.line1 || obj.address1 || "").trim();
    const line2 = String(obj.line2 || obj.address2 || "").trim();
    const city = String(obj.city || "").trim();
    const region = String(obj.region || obj.state || "").trim();
    const country = String(obj.country || "").trim();
    const postal = String(obj.postal_code || obj.postal || "").trim();
    const out: string[] = [];
    if (line1) out.push(line1);
    if (line2) out.push(line2);
    const place = [city, region, postal].filter(Boolean).join(", ");
    if (place) out.push(place);
    if (country) out.push(country);
    if (out.length) return out;
  }
  return addressLines(fallback);
}

function lineQty(line: InvoiceLine) {
  return toNum(line.qty_entered ?? line.qty);
}

function lineUnitPrice(line: InvoiceLine) {
  return toNum(line.unit_price_entered_usd ?? line.unit_price_usd);
}

function lineDiscountAmount(line: InvoiceLine) {
  return toNum(line.discount_amount_usd);
}

function lineDiscountPct(line: InvoiceLine) {
  const raw = toNum(line.discount_pct);
  const pct = raw <= 1 ? raw * 100 : raw;
  if (pct === 0) return "0%";
  const hasFraction = Math.abs(pct % 1) > 0.000001;
  return `${pct.toLocaleString("en-US", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}%`;
}

function customerLabel(inv: InvoiceRow, customer?: Customer | null) {
  if (!inv.customer_id) return "Walk-in";
  return String(customer?.legal_name || customer?.name || inv.customer_name || inv.customer_id);
}

function paymentTerms(inv: InvoiceRow) {
  const invDate = String(inv.invoice_date || "").slice(0, 10);
  const due = String(inv.due_date || "").slice(0, 10);
  if (!due || !invDate) return "Pay immediately";
  const invTs = Date.parse(`${invDate}T00:00:00Z`);
  const dueTs = Date.parse(`${due}T00:00:00Z`);
  if (Number.isNaN(invTs) || Number.isNaN(dueTs)) return "Pay immediately";
  const diff = Math.round((dueTs - invTs) / 86400000);
  if (diff <= 0) return "Pay immediately";
  return `Net ${diff} day${diff === 1 ? "" : "s"}`;
}

const SMALL = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function integerToWords(n: number): string {
  if (n < 20) return SMALL[n] || "zero";
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r ? `${TENS[t]} ${SMALL[r]}` : TENS[t];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return r ? `${SMALL[h]} hundred ${integerToWords(r)}` : `${SMALL[h]} hundred`;
  }
  const units: Array<[number, string]> = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  for (const [u, name] of units) {
    if (n >= u) {
      const head = Math.floor(n / u);
      const rest = n % u;
      return rest ? `${integerToWords(head)} ${name} ${integerToWords(rest)}` : `${integerToWords(head)} ${name}`;
    }
  }
  return "zero";
}

function amountInWordsUsd(amount: unknown) {
  const n = Math.max(0, toNum(amount));
  const dollars = Math.floor(n);
  const cents = Math.round((n - dollars) * 100);
  const words = integerToWords(dollars);
  const cap = words.charAt(0).toUpperCase() + words.slice(1);
  return `Only ${cap} and ${String(cents).padStart(2, "0")}/100 USD`;
}

const official = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 22,
    paddingHorizontal: 22,
    fontSize: 9,
    color: "#111",
    lineHeight: 1.28,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  companyBlock: {
    width: "56%",
  },
  companyName: {
    fontSize: 25,
    fontWeight: 700,
    marginBottom: 10,
  },
  companyMetaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  companyMetaLabel: {
    width: 112,
    color: "#333",
  },
  companyMetaValue: {
    flexGrow: 1,
    textAlign: "left",
    fontFamily: "Courier",
    color: "#222",
  },
  titleWrap: {
    width: "38%",
    alignItems: "center",
    marginTop: 4,
  },
  titleText: {
    fontSize: 22,
    fontWeight: 700,
  },
  invoiceNo: {
    marginTop: 7,
    fontSize: 19,
    fontFamily: "Courier",
    fontWeight: 700,
  },

  splitRow: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  col: {
    width: "48%",
  },
  kvRow: {
    flexDirection: "row",
    marginBottom: 4,
    alignItems: "flex-start",
  },
  kvLabel: {
    width: 92,
    fontWeight: 700,
  },
  kvValue: {
    flexGrow: 1,
    fontFamily: "Courier",
  },
  blockTitle: {
    fontSize: 10,
    fontWeight: 700,
    textDecoration: "underline",
    marginTop: 8,
    marginBottom: 6,
  },
  bodyLine: {
    marginBottom: 3,
  },
  bodyMono: {
    marginBottom: 3,
    fontFamily: "Courier",
  },

  tableWrap: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#8c8c8c",
  },
  headRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#8c8c8c",
    backgroundColor: "#efefef",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#c5c5c5",
  },
  cell: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderRightColor: "#c5c5c5",
    justifyContent: "center",
  },
  cellHead: {
    fontSize: 8.3,
    fontWeight: 700,
  },
  left: {
    textAlign: "left",
  },
  center: {
    textAlign: "center",
  },
  right: {
    textAlign: "right",
    fontFamily: "Courier",
  },

  afterTable: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  leftFoot: {
    width: "58%",
  },
  qtyLine: {
    marginTop: 2,
    marginBottom: 6,
    fontWeight: 700,
  },
  wordsLine: {
    fontStyle: "italic",
    marginBottom: 8,
  },
  noteLine: {
    marginTop: 8,
    fontSize: 8,
  },
  totalsBox: {
    width: "39%",
    borderWidth: 1,
    borderColor: "#8c8c8c",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#bdbdbd",
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  totalLabel: {
    fontWeight: 700,
  },
  totalValue: {
    fontFamily: "Courier",
    fontWeight: 700,
  },
  grandRow: {
    backgroundColor: "#efefef",
  },
  grandLabel: {
    fontSize: 10,
    fontWeight: 700,
  },
  grandValue: {
    fontSize: 10,
    fontFamily: "Courier",
    fontWeight: 700,
  },
  signRow: {
    marginTop: 34,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sign: {
    width: "42%",
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#c4c4c4",
    textAlign: "center",
    fontWeight: 700,
  },
  trace: {
    marginTop: 12,
    fontSize: 7,
    color: "#777",
    textAlign: "right",
    fontFamily: "Courier",
  },
});

function OfficialInvoiceTemplate(props: {
  detail: SalesInvoiceDetail;
  company?: Company | null;
  customer?: Customer | null;
  addresses?: PartyAddress[];
}) {
  const inv = props.detail.invoice;
  const lines = props.detail.lines || [];
  const taxLines = props.detail.tax_lines || [];
  const company = props.company || null;
  const customer = props.customer || null;
  const addresses = props.addresses || [];

  const meta = parseMeta(inv.receipt_meta);
  const defaultAddress = pickDefaultAddress(addresses);

  const docNo = inv.invoice_no || inv.receipt_no || inv.id.slice(0, 8);
  const customerNo = customer?.code || inv.customer_id || "-";
  const customerName = customerLabel(inv, customer);
  const customerPhone = String(customer?.phone || "").trim() || "-";

  const deliveryLines = deliveryAddressLines(meta, defaultAddress);
  const primaryLines = addressLines(defaultAddress);

  const taxUsd = taxLines.reduce((a, t) => a + toNum(t.tax_usd), 0);
  const totalUsd = toNum(inv.total_usd);
  const beforeVatUsd = totalUsd - taxUsd;
  const totalQty = lines.reduce((a, l) => a + lineQty(l), 0);

  const subtotalFromInvoice = toNum(inv.subtotal_usd);
  const discountFromInvoice = toNum(inv.discount_total_usd);
  const computedBeforeVat = subtotalFromInvoice - discountFromInvoice;
  const beforeVat = Math.abs(beforeVatUsd) > 0.009 ? beforeVatUsd : computedBeforeVat;

  const vatPct = beforeVat > 0 ? (taxUsd / beforeVat) * 100 : 0;
  const vatPctLabel = vatPct > 0 ? `${vatPct.toFixed(vatPct % 1 === 0 ? 0 : 2)}%` : "";

  return (
    <Document title={`Sales Invoice ${docNo}`}>
      <Page size="A4" style={official.page} wrap>
        <View style={official.topRow}>
          <View style={official.companyBlock}>
            <Text style={official.companyName}>{company?.legal_name || company?.name || "Company"}</Text>
            <View style={official.companyMetaRow}>
              <Text style={official.companyMetaLabel}>P.O. Box</Text>
              <Text style={official.companyMetaValue}>-</Text>
            </View>
            <View style={official.companyMetaRow}>
              <Text style={official.companyMetaLabel}>Tel</Text>
              <Text style={official.companyMetaValue}>-</Text>
            </View>
            <View style={official.companyMetaRow}>
              <Text style={official.companyMetaLabel}>Fax</Text>
              <Text style={official.companyMetaValue}>-</Text>
            </View>
            <View style={official.companyMetaRow}>
              <Text style={official.companyMetaLabel}>R.C</Text>
              <Text style={official.companyMetaValue}>{String(company?.registration_no || "-")}</Text>
            </View>
            <View style={official.companyMetaRow}>
              <Text style={official.companyMetaLabel}>VAT Registration No.</Text>
              <Text style={official.companyMetaValue}>{String(company?.vat_no || "-")}</Text>
            </View>
          </View>

          <View style={official.titleWrap}>
            <Text style={official.titleText}>Invoice</Text>
            <Text style={official.invoiceNo}>{docNo}</Text>
          </View>
        </View>

        <View style={official.splitRow}>
          <View style={official.col}>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Sales order No.</Text>
              <Text style={official.kvValue}>{inv.receipt_no || docNo}</Text>
            </View>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Sales Person</Text>
              <Text style={official.kvValue}>{metaString(meta, "sales_person", "salesperson") || "-"}</Text>
            </View>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Route</Text>
              <Text style={official.kvValue}>{metaString(meta, "route", "route_name") || "-"}</Text>
            </View>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Reference</Text>
              <Text style={official.kvValue}>{metaString(meta, "reference", "po_no") || inv.id.slice(0, 12)}</Text>
            </View>

            <Text style={official.blockTitle}>Primary Address</Text>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Customer No.</Text>
              <Text style={official.kvValue}>{customerNo}</Text>
            </View>
            <Text style={official.bodyLine}>{customerName}</Text>
            {primaryLines.map((ln, idx) => (
              <Text key={`primary-${idx}`} style={official.bodyLine}>
                {ln}
              </Text>
            ))}
            <View style={[official.kvRow, { marginTop: 2 }]}> 
              <Text style={official.kvLabel}>Tel</Text>
              <Text style={official.kvValue}>{customerPhone}</Text>
            </View>
          </View>

          <View style={official.col}>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Document Date</Text>
              <Text style={official.kvValue}>{fmtUsDate(inv.invoice_date)}</Text>
            </View>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Due Date</Text>
              <Text style={official.kvValue}>{fmtUsDate(inv.due_date)}</Text>
            </View>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Payment Terms</Text>
              <Text style={official.kvValue}>{paymentTerms(inv)}</Text>
            </View>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Currency</Text>
              <Text style={official.kvValue}>{inv.settlement_currency || inv.pricing_currency || "USD"}</Text>
            </View>

            <Text style={official.blockTitle}>Delivery Address</Text>
            <View style={official.kvRow}>
              <Text style={official.kvLabel}>Customer No.</Text>
              <Text style={official.kvValue}>{customerNo}</Text>
            </View>
            <Text style={official.bodyLine}>{customerName}</Text>
            {deliveryLines.map((ln, idx) => (
              <Text key={`delivery-${idx}`} style={official.bodyLine}>
                {ln}
              </Text>
            ))}
            <View style={[official.kvRow, { marginTop: 2 }]}> 
              <Text style={official.kvLabel}>Tel</Text>
              <Text style={official.kvValue}>{customerPhone}</Text>
            </View>
          </View>
        </View>

        <View style={official.tableWrap}>
          <View style={official.headRow} fixed>
            <View style={[official.cell, { flex: 1.25 }]}> 
              <Text style={[official.cellHead, official.left]}>Item</Text>
            </View>
            <View style={[official.cell, { flex: 3.2 }]}> 
              <Text style={[official.cellHead, official.left]}>Description</Text>
            </View>
            <View style={[official.cell, { flex: 1.05 }]}> 
              <Text style={[official.cellHead, official.right]}>Quantity</Text>
            </View>
            <View style={[official.cell, { flex: 0.85 }]}> 
              <Text style={[official.cellHead, official.center]}>UOM</Text>
            </View>
            <View style={[official.cell, { flex: 1.3 }]}> 
              <Text style={[official.cellHead, official.right]}>Unit price</Text>
            </View>
            <View style={[official.cell, { flex: 1.2 }]}> 
              <Text style={[official.cellHead, official.center]}>Discount %</Text>
            </View>
            <View style={[official.cell, { flex: 1.35 }]}> 
              <Text style={[official.cellHead, official.right]}>Discount Amount</Text>
            </View>
            <View style={[official.cell, { flex: 1.3, borderRightWidth: 0 }]}> 
              <Text style={[official.cellHead, official.right]}>Amount</Text>
            </View>
          </View>

          {lines.map((l) => (
            <View key={l.id} style={official.row} wrap={false}>
              <View style={[official.cell, { flex: 1.25 }]}> 
                <Text style={[official.left, { fontFamily: "Courier", fontSize: 8.3 }]}>{l.item_sku || String(l.item_id).slice(0, 12)}</Text>
              </View>
              <View style={[official.cell, { flex: 3.2 }]}> 
                <Text style={[official.left, { fontSize: 8.5 }]}>{l.item_name || "-"}</Text>
              </View>
              <View style={[official.cell, { flex: 1.05 }]}> 
                <Text style={official.right}>{fmtQty(lineQty(l))}</Text>
              </View>
              <View style={[official.cell, { flex: 0.85 }]}> 
                <Text style={[official.center, { fontSize: 8.3 }]}>{String(l.uom || "").trim() || "-"}</Text>
              </View>
              <View style={[official.cell, { flex: 1.3 }]}> 
                <Text style={official.right}>{fmtPlainMoney(lineUnitPrice(l))}</Text>
              </View>
              <View style={[official.cell, { flex: 1.2 }]}> 
                <Text style={[official.center, { fontFamily: "Courier" }]}>{lineDiscountPct(l)}</Text>
              </View>
              <View style={[official.cell, { flex: 1.35 }]}> 
                <Text style={official.right}>{fmtPlainMoney(lineDiscountAmount(l))}</Text>
              </View>
              <View style={[official.cell, { flex: 1.3, borderRightWidth: 0 }]}> 
                <Text style={official.right}>{fmtPlainMoney(l.line_total_usd)}</Text>
              </View>
            </View>
          ))}

          {lines.length === 0 ? (
            <View style={official.row}>
              <View style={[official.cell, { flex: 1, borderRightWidth: 0, paddingVertical: 8 }]}> 
                <Text style={[official.center, { color: "#666" }]}>No items.</Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={official.afterTable}>
          <View style={official.leftFoot}>
            <Text style={official.qtyLine}>Total Qty HL   {fmtQty(totalQty)}</Text>
            <Text style={official.wordsLine}>{amountInWordsUsd(totalUsd)}</Text>
            <Text style={official.noteLine}>Amount to be Cashed in USD Notes and VAT to be paid in LBP at Sayrafa rate.</Text>
          </View>

          <View style={official.totalsBox}>
            <View style={official.totalRow}>
              <Text style={official.totalLabel}>Total Amount Before VAT</Text>
              <Text style={official.totalValue}>{fmtPlainMoney(beforeVat)}</Text>
            </View>
            <View style={official.totalRow}>
              <Text style={official.totalLabel}>{`VAT ${vatPctLabel}`.trim()}</Text>
              <Text style={official.totalValue}>{fmtPlainMoney(taxUsd)}</Text>
            </View>
            <View style={[official.totalRow, official.grandRow, { borderBottomWidth: 0 }]}> 
              <Text style={official.grandLabel}>Total Amount Incl. VAT</Text>
              <Text style={official.grandValue}>{fmtPlainMoney(totalUsd)}</Text>
            </View>
          </View>
        </View>

        <View style={official.signRow}>
          <Text style={official.sign}>Receiver&apos;s Name & Signature</Text>
          <Text style={official.sign}>Stamp Duty Paid</Text>
        </View>

        <Text style={official.trace}>Ref {inv.id} · Generated {generatedAtStamp()}</Text>
      </Page>
    </Document>
  );
}

function OfficialCompactInvoiceTemplate(props: {
  detail: SalesInvoiceDetail;
  company?: Company | null;
  customer?: Customer | null;
}) {
  const inv = props.detail.invoice;
  const lines = props.detail.lines || [];
  const taxLines = props.detail.tax_lines || [];
  const company = props.company || null;
  const customer = props.customer || null;

  const docNo = inv.invoice_no || inv.receipt_no || inv.id.slice(0, 8);
  const customerNo = customer?.code || inv.customer_id || "-";
  const customerName = customerLabel(inv, customer);
  const customerPhone = String(customer?.phone || "").trim() || "-";
  const totalQty = lines.reduce((a, l) => a + lineQty(l), 0);

  const taxUsd = taxLines.reduce((a, t) => a + toNum(t.tax_usd), 0);
  const totalUsd = toNum(inv.total_usd);
  const computedBeforeVat = toNum(inv.subtotal_usd) - toNum(inv.discount_total_usd);
  const beforeVat = Math.abs(totalUsd - taxUsd) > 0.009 ? totalUsd - taxUsd : computedBeforeVat;
  const vatPct = beforeVat > 0 ? (taxUsd / beforeVat) * 100 : 0;
  const vatPctLabel = vatPct > 0 ? `${vatPct.toFixed(vatPct % 1 === 0 ? 0 : 2)}%` : "";

  return (
    <Document title={`Sales Invoice ${docNo}`}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow}>
          <View style={{ maxWidth: "64%" }}>
            <Text style={s.h1}>{company?.legal_name || company?.name || "Company"}</Text>
            {company?.registration_no ? (
              <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Reg No: {String(company.registration_no)}</Text>
            ) : null}
            {company?.vat_no ? <Text style={[s.muted, s.mono]}>VAT No: {String(company.vat_no)}</Text> : null}
          </View>
          <View>
            <Text style={[s.h2, { textAlign: "right" }]}>Invoice</Text>
            <Text style={[s.mono, { marginTop: 2, textAlign: "right" }]}>{docNo}</Text>
            <Text style={[s.muted, s.mono, { marginTop: 3, textAlign: "right" }]}>Inv {fmtUsDate(inv.invoice_date)}</Text>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Due {fmtUsDate(inv.due_date)}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Customer</Text>
            <Text style={s.value}>{customerName}</Text>
            <Text style={[s.muted, s.mono, { marginTop: 3 }]}>No. {customerNo}</Text>
            <Text style={[s.muted, s.mono]}>Tel {customerPhone}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Reference</Text>
            <Text style={[s.value, s.mono]}>{inv.receipt_no || docNo}</Text>
            <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Status {inv.status}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Currencies</Text>
            <Text style={s.value}>
              Pricing <Text style={s.mono}>{inv.pricing_currency}</Text>
            </Text>
            <Text style={s.value}>
              Settlement <Text style={s.mono}>{inv.settlement_currency}</Text>
            </Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.h2}>Items</Text>
          <View style={[s.table, { marginTop: 6 }]}>
            <View style={s.thead} fixed>
              <Text style={[s.th, { flex: 2.2 }]}>Item</Text>
              <Text style={[s.th, { flex: 4.4 }]}>Description</Text>
              <Text style={[s.th, s.right, { flex: 1.2 }]}>Qty</Text>
              <Text style={[s.th, { flex: 1.1 }]}>UOM</Text>
              <Text style={[s.th, s.right, { flex: 1.7 }]}>Unit USD</Text>
              <Text style={[s.th, s.right, { flex: 1.8 }]}>Amount USD</Text>
            </View>
            {lines.map((l) => (
              <View key={l.id} style={s.tr} wrap={false}>
                <Text style={[s.td, s.mono, { flex: 2.2 }]}>{l.item_sku || String(l.item_id).slice(0, 12)}</Text>
                <Text style={[s.td, { flex: 4.4 }]}>{l.item_name || "-"}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.2 }]}>{fmtQty(lineQty(l))}</Text>
                <Text style={[s.td, { flex: 1.1 }]}>{String(l.uom || "").trim() || "-"}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.7 }]}>{fmtPlainMoney(lineUnitPrice(l))}</Text>
                <Text style={[s.td, s.right, s.mono, { flex: 1.8 }]}>{fmtPlainMoney(l.line_total_usd)}</Text>
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
            <Text style={s.label}>Total Qty</Text>
            <Text style={[s.value, s.mono]}>{fmtQty(totalQty)}</Text>
          </View>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.label}>Before VAT</Text>
            <Text style={[s.value, s.mono]}>{fmtUsd(beforeVat)}</Text>
          </View>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.label}>{`VAT ${vatPctLabel}`.trim()}</Text>
            <Text style={[s.value, s.mono]}>{fmtUsd(taxUsd)}</Text>
          </View>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.label}>Total Incl. VAT</Text>
            <Text style={[s.value, s.mono]}>{fmtUsd(totalUsd)}</Text>
          </View>
        </View>

        <View style={s.foot}>
          <Text style={s.mono}>Ref {inv.id}</Text>
          <Text style={s.mono}>Generated {generatedAtStamp()}</Text>
        </View>
      </Page>
    </Document>
  );
}

function StandardInvoiceTemplate(props: { detail: SalesInvoiceDetail; company?: Company | null }) {
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
            {company.vat_no ? <Text style={[s.muted, s.mono, { fontSize: 8 }]}>VAT No: {String(company.vat_no)}</Text> : null}
            {company.registration_no ? <Text style={[s.muted, s.mono, { fontSize: 8 }]}>Reg No: {String(company.registration_no)}</Text> : null}
          </View>
        ) : null}

        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>Sales Invoice</Text>
            <Text style={[s.muted, s.mono]}>
              {docNo} · {inv.status}
            </Text>
          </View>
          <View>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Inv {fmtIsoDate(inv.invoice_date)}</Text>
            <Text style={[s.muted, s.mono, { textAlign: "right" }]}>Due {fmtIsoDate(inv.due_date)}</Text>
          </View>
        </View>

        <View style={[s.section, s.grid3]}>
          <View style={s.box}>
            <Text style={s.label}>Customer</Text>
            <Text style={s.value}>{inv.customer_id ? inv.customer_name || inv.customer_id : "Walk-in"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Warehouse</Text>
            <Text style={s.value}>{inv.warehouse_name || inv.warehouse_id || "-"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Currencies</Text>
            <Text style={s.value}>
              Pricing <Text style={s.mono}>{inv.pricing_currency}</Text> · Settlement <Text style={s.mono}>{inv.settlement_currency}</Text>
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
            <Text style={[s.value, s.mono]}>{fmtUsdLbp(taxUsd, taxLbp)}</Text>
          </View>
          <View style={[s.box, { flex: 1 }]}> 
            <Text style={s.label}>Totals</Text>
            <Text style={[s.value, s.mono]}>{fmtUsdLbp(inv.total_usd, inv.total_lbp)}</Text>
            <Text style={[s.muted, s.mono, { marginTop: 3 }]}>Paid {fmtUsdLbp(paidUsd, paidLbp)}</Text>
            <Text style={[{ marginTop: 3 }, s.mono]}>Balance {fmtUsdLbp(balUsd, balLbp)}</Text>
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

export function SalesInvoicePdf(props: {
  detail: SalesInvoiceDetail;
  company?: Company | null;
  customer?: Customer | null;
  addresses?: PartyAddress[];
  template?: SalesInvoicePdfTemplate | string;
}) {
  const company = props.company || null;
  const selected = normalizePdfTemplate(props.template);
  const isOfficial = company?.id === OFFICIAL_COMPANY_ID;

  if (selected === "official_compact") {
    return <OfficialCompactInvoiceTemplate detail={props.detail} company={props.company} customer={props.customer} />;
  }
  if (selected === "official_classic") {
    return <OfficialInvoiceTemplate detail={props.detail} company={props.company} customer={props.customer} addresses={props.addresses} />;
  }
  if (selected === "standard") {
    return <StandardInvoiceTemplate detail={props.detail} company={props.company} />;
  }

  if (isOfficial) {
    return <OfficialInvoiceTemplate detail={props.detail} company={props.company} customer={props.customer} addresses={props.addresses} />;
  }
  return <StandardInvoiceTemplate detail={props.detail} company={props.company} />;
}
