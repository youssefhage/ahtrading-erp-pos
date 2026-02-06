"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  credit_limit_usd: string | number;
  credit_limit_lbp: string | number;
  credit_balance_usd: string | number;
  credit_balance_lbp: string | number;
  loyalty_points: string | number;
};

function fmt(n: string | number) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [creditLimitUsd, setCreditLimitUsd] = useState("0");
  const [creditLimitLbp, setCreditLimitLbp] = useState("0");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((c) => {
      return (
        c.name.toLowerCase().includes(needle) ||
        (c.phone || "").toLowerCase().includes(needle) ||
        (c.email || "").toLowerCase().includes(needle) ||
        c.id.toLowerCase().includes(needle)
      );
    });
  }, [customers, q]);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ customers: Customer[] }>("/customers");
      setCustomers(res.customers || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setStatus("name is required");
      return;
    }
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/customers", {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        credit_limit_usd: Number(creditLimitUsd || 0),
        credit_limit_lbp: Number(creditLimitLbp || 0)
      });
      setName("");
      setPhone("");
      setEmail("");
      setCreditLimitUsd("0");
      setCreditLimitLbp("0");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Customers">
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

        <Card>
          <CardHeader>
            <CardTitle>Create Customer</CardTitle>
            <CardDescription>Minimal v1 customer + credit limits + loyalty.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createCustomer} className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Phone</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+961..." />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-slate-700">Email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@email.com" />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Limit USD</label>
                <Input value={creditLimitUsd} onChange={(e) => setCreditLimitUsd(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-1">
                <label className="text-xs font-medium text-slate-700">Limit LBP</label>
                <Input value={creditLimitLbp} onChange={(e) => setCreditLimitLbp(e.target.value)} />
              </div>
              <div className="md:col-span-6">
                <Button type="submit" disabled={creating}>
                  {creating ? "..." : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customers</CardTitle>
            <CardDescription>{customers.length} customers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-96">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name/phone/email/id..." />
              </div>
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2 text-right">Balance USD</th>
                    <th className="px-3 py-2 text-right">Balance LBP</th>
                    <th className="px-3 py-2 text-right">Limit USD</th>
                    <th className="px-3 py-2 text-right">Limit LBP</th>
                    <th className="px-3 py-2 text-right">Points</th>
                    <th className="px-3 py-2">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-slate-500">{c.phone || ""} {c.email ? `· ${c.email}` : ""}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(c.credit_balance_usd)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(c.credit_balance_lbp)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(c.credit_limit_usd)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(c.credit_limit_lbp)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fmt(c.loyalty_points)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{c.id}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={7}>
                        No customers.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

