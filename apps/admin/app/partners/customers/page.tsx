"use client";

import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { PartyAddresses } from "@/components/party-addresses";
import { PartyContacts } from "@/components/party-contacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PartyType = "individual" | "business";

type Customer = {
  id: string;
  code?: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  party_type?: PartyType;
  legal_name?: string | null;
  tax_id?: string | null;
  vat_no?: string | null;
  notes?: string | null;
  membership_no?: string | null;
  is_member?: boolean;
  membership_expires_at?: string | null;
  payment_terms_days: string | number;
  credit_limit_usd: string | number;
  credit_limit_lbp: string | number;
  credit_balance_usd: string | number;
  credit_balance_lbp: string | number;
  loyalty_points: string | number;
  is_active?: boolean;
};

function fmt(n: string | number) {
  return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

type LoyaltyRow = {
  id: string;
  source_type: string;
  source_id: string;
  points: string | number;
  created_at: string;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [detail, setDetail] = useState<Customer | null>(null);
  const [loyaltyLedger, setLoyaltyLedger] = useState<LoyaltyRow[]>([]);
  const [loyaltyStatus, setLoyaltyStatus] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState<PartyType>("individual");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [vatNo, setVatNo] = useState("");
  const [notes, setNotes] = useState("");

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [membershipNo, setMembershipNo] = useState("");
  const [isMember, setIsMember] = useState(false);
  const [membershipExpiresAt, setMembershipExpiresAt] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [termsDays, setTermsDays] = useState("0");
  const [creditLimitUsd, setCreditLimitUsd] = useState("0");
  const [creditLimitLbp, setCreditLimitLbp] = useState("0");
  const [creating, setCreating] = useState(false);

  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editPartyType, setEditPartyType] = useState<PartyType>("individual");
  const [editLegalName, setEditLegalName] = useState("");
  const [editTaxId, setEditTaxId] = useState("");
  const [editVatNo, setEditVatNo] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editMembershipNo, setEditMembershipNo] = useState("");
  const [editIsMember, setEditIsMember] = useState(false);
  const [editMembershipExpiresAt, setEditMembershipExpiresAt] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editTermsDays, setEditTermsDays] = useState("0");
  const [editLimitUsd, setEditLimitUsd] = useState("0");
  const [editLimitLbp, setEditLimitLbp] = useState("0");
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<
    { code?: string | null; name: string; party_type?: PartyType; phone?: string | null; email?: string | null; membership_no?: string | null }[]
  >([]);
  const [importErrors, setImportErrors] = useState("");
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((c) => {
      return (
        c.name.toLowerCase().includes(needle) ||
        (c.code || "").toLowerCase().includes(needle) ||
        (c.legal_name || "").toLowerCase().includes(needle) ||
        (c.phone || "").toLowerCase().includes(needle) ||
        (c.email || "").toLowerCase().includes(needle) ||
        (c.membership_no || "").toLowerCase().includes(needle) ||
        (c.vat_no || "").toLowerCase().includes(needle) ||
        (c.tax_id || "").toLowerCase().includes(needle) ||
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

  useEffect(() => {
    const found = customers.find((c) => c.id === customerId) || null;
    setDetail(found);
  }, [customerId, customers]);

  useEffect(() => {
    if (!customerId) {
      setLoyaltyLedger([]);
      setLoyaltyStatus("");
      return;
    }
    loadLoyaltyLedger(customerId);
  }, [customerId]);

  async function loadLoyaltyLedger(id: string) {
    setLoyaltyStatus("Loading loyalty ledger...");
    try {
      const res = await apiGet<{ loyalty_points: string | number; ledger: LoyaltyRow[] }>(`/customers/${id}/loyalty-ledger?limit=50`);
      setLoyaltyLedger(res.ledger || []);
      setLoyaltyStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoyaltyStatus(message);
    }
  }

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setStatus("name is required");
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/customers", {
        code: code.trim() || null,
        name: name.trim(),
        party_type: partyType,
        legal_name: legalName.trim() || null,
        tax_id: taxId.trim() || null,
        vat_no: vatNo.trim() || null,
        notes: notes.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        membership_no: membershipNo.trim() || null,
        is_member: isMember,
        membership_expires_at: membershipExpiresAt.trim() || null,
        is_active: isActive,
        payment_terms_days: Number(termsDays || 0),
        credit_limit_usd: Number(creditLimitUsd || 0),
        credit_limit_lbp: Number(creditLimitLbp || 0)
      });
      setName("");
      setCode("");
      setPartyType("individual");
      setLegalName("");
      setTaxId("");
      setVatNo("");
      setNotes("");
      setPhone("");
      setEmail("");
      setMembershipNo("");
      setIsMember(false);
      setMembershipExpiresAt("");
      setIsActive(true);
      setTermsDays("0");
      setCreditLimitUsd("0");
      setCreditLimitLbp("0");
      setCreateOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setCreating(false);
    }
  }

  function openEdit(c: Customer) {
    setCustomerId(c.id);
    loadLoyaltyLedger(c.id);
    setEditCode((c.code as any) || "");
    setEditName(c.name || "");
    setEditPartyType((c.party_type as PartyType) || "individual");
    setEditLegalName(c.legal_name || "");
    setEditTaxId(c.tax_id || "");
    setEditVatNo(c.vat_no || "");
    setEditNotes(c.notes || "");
    setEditPhone(c.phone || "");
    setEditEmail(c.email || "");
    setEditMembershipNo(c.membership_no || "");
    setEditIsMember(Boolean(c.is_member));
    setEditMembershipExpiresAt(c.membership_expires_at || "");
    setEditIsActive(c.is_active !== false);
    setEditTermsDays(String(c.payment_terms_days ?? 0));
    setEditLimitUsd(String(c.credit_limit_usd ?? 0));
    setEditLimitLbp(String(c.credit_limit_lbp ?? 0));
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) return;
    if (!editName.trim()) return setStatus("name is required");
    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/customers/${customerId}`, {
        code: editCode.trim() || null,
        name: editName.trim(),
        party_type: editPartyType,
        legal_name: editLegalName.trim() || null,
        tax_id: editTaxId.trim() || null,
        vat_no: editVatNo.trim() || null,
        notes: editNotes.trim() || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        membership_no: editMembershipNo.trim() || null,
        is_member: editIsMember,
        membership_expires_at: editMembershipExpiresAt.trim() || null,
        is_active: editIsActive,
        payment_terms_days: Number(editTermsDays || 0),
        credit_limit_usd: Number(editLimitUsd || 0),
        credit_limit_lbp: Number(editLimitLbp || 0)
      });
      setEditOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  }

  function parseCsv(input: string): string[][] {
    const out: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let i = 0;
    let inQuotes = false;
    const s = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    function pushCell() {
      row.push(cell);
      cell = "";
    }
    function pushRow() {
      const allEmpty = row.every((c) => !String(c || "").trim());
      if (!allEmpty) out.push(row);
      row = [];
    }

    while (i < s.length) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          const next = s[i + 1];
          if (next === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        cell += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ",") {
        pushCell();
        i += 1;
        continue;
      }
      if (ch === "\n") {
        pushCell();
        pushRow();
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    }
    pushCell();
    pushRow();
    return out;
  }

  function recomputeImport(text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      setImportPreview([]);
      setImportErrors("");
      return;
    }
    try {
      const rows = parseCsv(trimmed);
      if (rows.length < 2) {
        setImportPreview([]);
        setImportErrors("CSV must have a header row + at least 1 data row.");
        return;
      }
      const headers = rows[0].map((h) => (h || "").trim().toLowerCase());
      const idx = (names: string[]) => {
        for (const n of names) {
          const i = headers.indexOf(n);
          if (i >= 0) return i;
        }
        return -1;
      };
      const codeIdx = idx(["code"]);
      const nameIdx = idx(["name"]);
      const partyIdx = idx(["party_type", "type"]);
      const phoneIdx = idx(["phone"]);
      const emailIdx = idx(["email"]);
      const memIdx = idx(["membership_no", "membership"]);
      if (nameIdx < 0) {
        setImportPreview([]);
        setImportErrors("Missing required header: name");
        return;
      }
      const preview: { code?: string | null; name: string; party_type?: PartyType; phone?: string | null; email?: string | null; membership_no?: string | null }[] = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const name = (row[nameIdx] || "").trim();
        if (!name) continue;
        const partyRaw = partyIdx >= 0 ? (row[partyIdx] || "").trim().toLowerCase() : "";
        const party_type: PartyType = partyRaw === "business" ? "business" : "individual";
        preview.push({
          code: codeIdx >= 0 ? (row[codeIdx] || "").trim() || null : null,
          name,
          party_type,
          phone: phoneIdx >= 0 ? (row[phoneIdx] || "").trim() || null : null,
          email: emailIdx >= 0 ? (row[emailIdx] || "").trim() || null : null,
          membership_no: memIdx >= 0 ? (row[memIdx] || "").trim() || null : null
        });
      }
      if (!preview.length) {
        setImportPreview([]);
        setImportErrors("No valid rows parsed (need at least 1 row with a name).");
        return;
      }
      setImportPreview(preview);
      setImportErrors("");
    } catch (e) {
      setImportPreview([]);
      setImportErrors(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importPreview.length) return setStatus("Paste a CSV with at least 1 row.");
    setImporting(true);
    setStatus("Importing customers...");
    try {
      await apiPost("/customers/bulk", { customers: importPreview });
      setImportOpen(false);
      setImportText("");
      setImportPreview([]);
      setImportErrors("");
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
        {status ? (
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>Errors and action results show here.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-xs text-slate-700">{status}</pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Customers</CardTitle>
                <CardDescription>{customers.length} customers</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={load}>
                  Refresh
                </Button>
                <Dialog
                  open={importOpen}
                  onOpenChange={(o) => {
                    setImportOpen(o);
                    if (!o) {
                      setImportText("");
                      setImportPreview([]);
                      setImportErrors("");
                    }
                  }}
                >
                  <DialogTrigger asChild>
                    <Button variant="outline">Import CSV</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Import Customers (CSV)</DialogTitle>
                      <DialogDescription>
                        Header required. Columns: <span className="font-mono text-xs">code,name,party_type,phone,email,membership_no</span>.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={submitImport} className="space-y-3">
                      <textarea
                        className="h-48 w-full rounded-md border border-slate-200 bg-white p-3 text-xs font-mono text-slate-900"
                        value={importText}
                        onChange={(e) => {
                          const v = e.target.value;
                          setImportText(v);
                          recomputeImport(v);
                        }}
                        placeholder={"code,name,party_type,phone,email,membership_no\nC-0001,Walk-in,individual,,,\nC-1002,Company XYZ,business,+961...,ap@xyz.com,"}
                      />
                      {importErrors ? (
                        <pre className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                          {importErrors}
                        </pre>
                      ) : null}
                      <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-700">
                        Parsed rows: <span className="font-mono">{importPreview.length}</span>
                      </div>
                      <div className="flex justify-end">
                        <Button type="submit" disabled={importing}>
                          {importing ? "..." : "Import"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                  <DialogTrigger asChild>
                    <Button>New</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Create Customer</DialogTitle>
                      <DialogDescription>Supports individuals and businesses.</DialogDescription>
                    </DialogHeader>

                    <form onSubmit={createCustomer} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Code (optional)</label>
                        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="C-0001" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Display Name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Doe or ABC Market" />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Type</label>
                        <select className="ui-select" value={partyType} onChange={(e) => setPartyType(e.target.value as PartyType)}>
                          <option value="individual">Individual</option>
                          <option value="business">Business</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Legal Name</label>
                        <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Optional" />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Tax ID</label>
                        <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">VAT No</label>
                        <Input value={vatNo} onChange={(e) => setVatNo(e.target.value)} placeholder="Optional" />
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:col-span-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Phone</label>
                          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+961..." />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Email</label>
                          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@..." />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Payment Terms (days)</label>
                        <Input value={termsDays} onChange={(e) => setTermsDays(e.target.value)} placeholder="0" />
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Credit USD</label>
                          <Input value={creditLimitUsd} onChange={(e) => setCreditLimitUsd(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Credit LBP</label>
                          <Input value={creditLimitLbp} onChange={(e) => setCreditLimitLbp(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Membership #</label>
                        <Input value={membershipNo} onChange={(e) => setMembershipNo(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Member?</label>
                        <select className="ui-select" value={isMember ? "yes" : "no"} onChange={(e) => setIsMember(e.target.value === "yes")}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-slate-700">Active?</label>
                        <select className="ui-select" value={isActive ? "yes" : "no"} onChange={(e) => setIsActive(e.target.value === "yes")}>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-slate-700">Notes</label>
                        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                      </div>

                      <div className="md:col-span-2 flex justify-end">
                        <Button type="submit" disabled={creating}>
                          {creating ? "..." : "Create"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>

                <Dialog open={editOpen} onOpenChange={setEditOpen}>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Edit Customer</DialogTitle>
                      <DialogDescription>Update business/individual fields and credit settings.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Code (optional)</label>
                        <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="C-0001" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Display Name</label>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Type</label>
                        <select className="ui-select" value={editPartyType} onChange={(e) => setEditPartyType(e.target.value as PartyType)}>
                          <option value="individual">Individual</option>
                          <option value="business">Business</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Legal Name</label>
                        <Input value={editLegalName} onChange={(e) => setEditLegalName(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Tax ID</label>
                        <Input value={editTaxId} onChange={(e) => setEditTaxId(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">VAT No</label>
                        <Input value={editVatNo} onChange={(e) => setEditVatNo(e.target.value)} />
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:col-span-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Phone</label>
                          <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Email</label>
                          <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Terms (days)</label>
                        <Input value={editTermsDays} onChange={(e) => setEditTermsDays(e.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Credit USD</label>
                          <Input value={editLimitUsd} onChange={(e) => setEditLimitUsd(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-slate-700">Credit LBP</label>
                          <Input value={editLimitLbp} onChange={(e) => setEditLimitLbp(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Membership #</label>
                        <Input value={editMembershipNo} onChange={(e) => setEditMembershipNo(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Member?</label>
                        <select className="ui-select" value={editIsMember ? "yes" : "no"} onChange={(e) => setEditIsMember(e.target.value === "yes")}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-slate-700">Active?</label>
                        <select className="ui-select" value={editIsActive ? "yes" : "no"} onChange={(e) => setEditIsActive(e.target.value === "yes")}>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-slate-700">Notes</label>
                        <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
                      </div>

                      <div className="md:col-span-2 flex justify-end">
                        <Button type="submit" disabled={saving}>
                          {saving ? "..." : "Save"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
	                </Dialog>
	              </div>
	            </div>
	          </CardHeader>

	          <CardContent className="space-y-3">
	            <div className="flex flex-wrap items-center justify-between gap-2">
	              <div className="w-full md:w-96">
	                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name/legal/phone/email/vat/tax/id..." />
	              </div>
	            </div>

	            <div className="ui-table-wrap">
	              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2 text-right">AR USD</th>
                    <th className="px-3 py-2 text-right">AR LBP</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="ui-tr-hover" style={{ cursor: "pointer" }} onClick={() => setCustomerId(c.id)}>
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2">{c.party_type || "individual"}</td>
                      <td className="px-3 py-2">{c.phone || "-"}</td>
                      <td className="px-3 py-2">{c.email || "-"}</td>
                      <td className="px-3 py-2">{c.is_active === false ? <span className="text-slate-500">No</span> : "Yes"}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.credit_balance_usd)}</td>
                      <td className="px-3 py-2 text-right">{fmt(c.credit_balance_lbp)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => openEdit(c)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

	            {detail ? (
	              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Customer Detail</CardTitle>
                    <CardDescription>Operational fields used by invoices and POS credit.</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div>
                      <span className="text-slate-500">Code:</span> {detail.code || "-"}
                    </div>
                    <div>
                      <span className="text-slate-500">Name:</span> {detail.name}
                    </div>
                    <div>
                      <span className="text-slate-500">Type:</span> {detail.party_type || "individual"}
                    </div>
                    <div>
                      <span className="text-slate-500">Legal:</span> {detail.legal_name || "-"}
                    </div>
                    <div>
                      <span className="text-slate-500">VAT:</span> {detail.vat_no || "-"}
                    </div>
                    <div>
                      <span className="text-slate-500">Tax ID:</span> {detail.tax_id || "-"}
                    </div>
                    <div>
                      <span className="text-slate-500">Terms:</span> {detail.payment_terms_days}
                    </div>
                    <div>
                      <span className="text-slate-500">Credit Limit:</span> {fmt(detail.credit_limit_usd)} USD / {fmt(detail.credit_limit_lbp)} LBP
                    </div>
                    <div>
                      <span className="text-slate-500">Balance:</span> {fmt(detail.credit_balance_usd)} USD / {fmt(detail.credit_balance_lbp)} LBP
                    </div>
                    <div>
                      <span className="text-slate-500">Loyalty Points:</span> {fmt(detail.loyalty_points)}
                    </div>
                    <div>
                      <span className="text-slate-500">Notes:</span> {detail.notes || "-"}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Loyalty Ledger</CardTitle>
                    <CardDescription>Recent point movements for this customer.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" onClick={() => loadLoyaltyLedger(detail.id)}>
                        Refresh
                      </Button>
                    </div>
                    {loyaltyStatus ? <pre className="whitespace-pre-wrap text-xs text-slate-700">{loyaltyStatus}</pre> : null}
                    <div className="ui-table-wrap">
                      <table className="ui-table">
                        <thead className="ui-thead">
                          <tr>
                            <th className="px-3 py-2">When</th>
                            <th className="px-3 py-2">Source</th>
                            <th className="px-3 py-2 text-right">Points</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loyaltyLedger.map((r) => (
                            <tr key={r.id} className="ui-tr-hover">
                              <td className="px-3 py-2 font-mono text-xs">{String(r.created_at || "").replace("T", " ").slice(0, 19)}</td>
                              <td className="px-3 py-2 font-mono text-xs">{r.source_type}:{String(r.source_id).slice(0, 8)}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs">{fmt(r.points)}</td>
                            </tr>
                          ))}
                          {loyaltyLedger.length === 0 ? (
                            <tr>
                              <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                                No loyalty entries yet.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                <PartyAddresses partyKind="customer" partyId={detail.id} />
                <PartyContacts partyKind="customer" partyId={detail.id} />
	              </div>
	            ) : null}
	          </CardContent>
	        </Card>
	      </div>);
	}
