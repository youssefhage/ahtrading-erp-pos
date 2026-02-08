"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type TaxCode = { id: string; name: string; rate: string | number; tax_type: string; reporting_currency: string };
type ExchangeRateRow = { id: string; rate_date: string; rate_type: string; usd_to_lbp: string | number };
type AccountRole = { code: string; description: string };
type CoaAccount = { id: string; account_code: string; name_en: string; is_postable: boolean };
type AccountDefaultRow = { role_code: string; account_code: string; name_en: string };
type PaymentMethodRow = { method: string; role_code: string; created_at: string };

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ConfigPage() {
  const [status, setStatus] = useState("");

  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [rates, setRates] = useState<ExchangeRateRow[]>([]);
  const [roles, setRoles] = useState<AccountRole[]>([]);
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [defaults, setDefaults] = useState<AccountDefaultRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);

  // Tax code form
  const [taxName, setTaxName] = useState("");
  const [taxRate, setTaxRate] = useState("11");
  const [taxType, setTaxType] = useState("vat");
  const [taxCurrency, setTaxCurrency] = useState("LBP");
  const [taxOpen, setTaxOpen] = useState(false);
  const [savingTax, setSavingTax] = useState(false);

  // Exchange rate form
  const [rateDate, setRateDate] = useState(todayISO());
  const [rateType, setRateType] = useState("market");
  const [usdToLbp, setUsdToLbp] = useState("90000");
  const [rateOpen, setRateOpen] = useState(false);
  const [savingRate, setSavingRate] = useState(false);

  // Account defaults form
  const [defaultRole, setDefaultRole] = useState("");
  const [defaultAccountCode, setDefaultAccountCode] = useState("");
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);

  // Payment method mapping form
  const [methodName, setMethodName] = useState("cash");
  const [methodRole, setMethodRole] = useState("");
  const [methodOpen, setMethodOpen] = useState(false);
  const [savingMethod, setSavingMethod] = useState(false);

  const accountByCode = useMemo(() => new Map(accounts.map((a) => [a.account_code, a])), [accounts]);
  const defaultByRole = useMemo(() => new Map(defaults.map((d) => [d.role_code, d])), [defaults]);

  async function load() {
    setStatus("Loading...");
    try {
      const [tc, er, ar, ca, ad, pm] = await Promise.all([
        apiGet<{ tax_codes: TaxCode[] }>("/config/tax-codes"),
        apiGet<{ rates: ExchangeRateRow[] }>("/config/exchange-rates"),
        apiGet<{ roles: AccountRole[] }>("/config/account-roles"),
        apiGet<{ accounts: CoaAccount[] }>("/coa/accounts"),
        apiGet<{ defaults: AccountDefaultRow[] }>("/config/account-defaults"),
        apiGet<{ methods: PaymentMethodRow[] }>("/config/payment-methods")
      ]);
      setTaxCodes(tc.tax_codes || []);
      setRates(er.rates || []);
      setRoles(ar.roles || []);
      setAccounts(ca.accounts || []);
      setDefaults(ad.defaults || []);
      setMethods(pm.methods || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!defaultRole && roles.length) setDefaultRole(roles[0]?.code || "");
    if (!methodRole && roles.length) setMethodRole(roles[0]?.code || "");
  }, [roles, defaultRole, methodRole]);

  async function createTaxCode(e: React.FormEvent) {
    e.preventDefault();
    if (!taxName.trim()) {
      setStatus("tax code name is required");
      return;
    }
    setSavingTax(true);
    setStatus("Saving tax code...");
    try {
      await apiPost("/config/tax-codes", {
        name: taxName.trim(),
        rate: Number(taxRate || 0),
        tax_type: taxType || "vat",
        reporting_currency: taxCurrency || "LBP"
      });
      setTaxName("");
      setTaxOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingTax(false);
    }
  }

  async function upsertRate(e: React.FormEvent) {
    e.preventDefault();
    if (!rateDate) {
      setStatus("rate_date is required");
      return;
    }
    setSavingRate(true);
    setStatus("Saving exchange rate...");
    try {
      await apiPost("/config/exchange-rates", {
        rate_date: rateDate,
        rate_type: rateType || "market",
        usd_to_lbp: Number(usdToLbp || 0)
      });
      setRateOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingRate(false);
    }
  }

  async function setDefault(e: React.FormEvent) {
    e.preventDefault();
    if (!defaultRole) {
      setStatus("role_code is required");
      return;
    }
    if (!defaultAccountCode) {
      setStatus("account_code is required");
      return;
    }
    setSavingDefault(true);
    setStatus("Saving account default...");
    try {
      await apiPost("/config/account-defaults", {
        role_code: defaultRole,
        account_code: defaultAccountCode
      });
      setDefaultAccountCode("");
      setDefaultOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingDefault(false);
    }
  }

  async function upsertMethod(e: React.FormEvent) {
    e.preventDefault();
    if (!methodName.trim()) {
      setStatus("method is required");
      return;
    }
    if (!methodRole) {
      setStatus("role_code is required");
      return;
    }
    setSavingMethod(true);
    setStatus("Saving payment method mapping...");
    try {
      await apiPost("/config/payment-methods", {
        method: methodName.trim(),
        role_code: methodRole
      });
      setMethodOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSavingMethod(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>API errors will show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Account Defaults</CardTitle>
            <CardDescription>
              These mappings are required for automatic GL posting (POS sales, goods receipts, supplier invoices, payments).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-end">
              <Dialog open={defaultOpen} onOpenChange={setDefaultOpen}>
                <DialogTrigger asChild>
                  <Button>Set Default</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Set Account Default</DialogTitle>
                    <DialogDescription>
                      Maps an account role (AR, SALES, VAT_PAYABLE, etc.) to a company COA account.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={setDefault} className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-700">Role</label>
                      <select
                        className="ui-select"
                        value={defaultRole}
                        onChange={(e) => setDefaultRole(e.target.value)}
                      >
                        <option value="">Select role...</option>
                        {roles.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.code} · {r.description}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Account</label>
                      <select
                        className="ui-select"
                        value={defaultAccountCode}
                        onChange={(e) => setDefaultAccountCode(e.target.value)}
                      >
                        <option value="">Select account...</option>
                        {accounts.map((a) => (
                          <option key={a.account_code} value={a.account_code}>
                            {a.account_code} · {a.name_en}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-3 flex justify-end">
                      <Button type="submit" disabled={savingDefault}>
                        {savingDefault ? "..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => {
                    const d = defaultByRole.get(r.code);
                    const a = d?.account_code ? accountByCode.get(d.account_code) : undefined;
                    return (
                      <tr key={r.code} className="ui-tr-hover">
                        <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                        <td className="px-3 py-2 font-mono text-xs">{d?.account_code || "-"}</td>
                        <td className="px-3 py-2 text-xs text-slate-700">{a?.name_en || d?.name_en || "-"}</td>
                      </tr>
                    );
                  })}
                  {roles.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                        No roles found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Method Mappings</CardTitle>
            <CardDescription>
              Map UI/payment method strings (cash, bank, card, transfer) to an account role, then configure the role’s account default above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-end">
              <Dialog open={methodOpen} onOpenChange={setMethodOpen}>
                <DialogTrigger asChild>
                  <Button>Upsert Mapping</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Upsert Payment Method Mapping</DialogTitle>
                    <DialogDescription>
                      Example methods: cash, bank, card, transfer. This decides which GL cash/bank account gets debited.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={upsertMethod} className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-700">Method</label>
                      <Input value={methodName} onChange={(e) => setMethodName(e.target.value)} placeholder="cash / bank / card / transfer" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Role</label>
                      <select
                        className="ui-select"
                        value={methodRole}
                        onChange={(e) => setMethodRole(e.target.value)}
                      >
                        <option value="">Select role...</option>
                        {roles.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.code} · {r.description}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-3 flex justify-end">
                      <Button type="submit" disabled={savingMethod}>
                        {savingMethod ? "..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Method</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map((m) => (
                    <tr key={m.method} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{m.method}</td>
                      <td className="px-3 py-2 font-mono text-xs">{m.role_code}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{m.created_at}</td>
                    </tr>
                  ))}
                  {methods.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                        No payment method mappings yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tax Codes (VAT)</CardTitle>
            <CardDescription>Create and list tax codes used in invoices and reports.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-end">
              <Dialog open={taxOpen} onOpenChange={setTaxOpen}>
                <DialogTrigger asChild>
                  <Button>Create Tax Code</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Create Tax Code</DialogTitle>
                    <DialogDescription>Used on sales/purchase invoices and VAT reporting.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createTaxCode} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Name</label>
                      <Input value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder="VAT 11%" />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-700">Rate (%)</label>
                      <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-700">Reporting Currency</label>
                      <select
                        className="ui-select"
                        value={taxCurrency}
                        onChange={(e) => setTaxCurrency(e.target.value)}
                      >
                        <option value="LBP">LBP</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Tax Type</label>
                      <Input value={taxType} onChange={(e) => setTaxType(e.target.value)} placeholder="vat" />
                    </div>
                    <div className="md:col-span-2 flex items-end justify-end">
                      <Button type="submit" disabled={savingTax}>
                        {savingTax ? "..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {taxCodes.map((t) => (
                    <tr key={t.id} className="ui-tr-hover">
                      <td className="px-3 py-2">{t.name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(t.rate || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}%
                      </td>
                      <td className="px-3 py-2">{t.tax_type}</td>
                      <td className="px-3 py-2">{t.reporting_currency}</td>
                    </tr>
                  ))}
                  {taxCodes.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                        No tax codes yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Exchange Rates</CardTitle>
            <CardDescription>USD to LBP daily rates used for dual-currency reporting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-end">
              <Dialog open={rateOpen} onOpenChange={setRateOpen}>
                <DialogTrigger asChild>
                  <Button>Upsert Rate</Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Upsert Exchange Rate</DialogTitle>
                    <DialogDescription>
                      Used for dual-currency reporting and for documents that need a locked USD→LBP rate.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={upsertRate} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-700">Date</label>
                      <Input value={rateDate} onChange={(e) => setRateDate(e.target.value)} placeholder="YYYY-MM-DD" />
                    </div>
                    <div className="space-y-1 md:col-span-1">
                      <label className="text-xs font-medium text-slate-700">Type</label>
                      <Input value={rateType} onChange={(e) => setRateType(e.target.value)} placeholder="market" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">USD→LBP</label>
                      <Input value={usdToLbp} onChange={(e) => setUsdToLbp(e.target.value)} />
                    </div>
                    <div className="md:col-span-4 flex justify-end">
                      <Button type="submit" disabled={savingRate}>
                        {savingRate ? "..." : "Save"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">USD→LBP</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{r.rate_date}</td>
                      <td className="px-3 py-2">{r.rate_type}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {Number(r.usd_to_lbp || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  {rates.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                        No exchange rates yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>);
}
