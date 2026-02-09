"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { fmtLbp, fmtUsd } from "@/lib/money";
import { ErrorBanner } from "@/components/error-banner";
import { PartyAddresses } from "@/components/party-addresses";
import { PartyContacts } from "@/components/party-contacts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { Chip } from "@/components/ui/chip";
import { ViewRaw } from "@/components/view-raw";

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

  const loadLoyaltyLedger = useCallback(async (id: string) => {
    setLoyaltyStatus("Loading loyalty ledger...");
    try {
      const res = await apiGet<{ loyalty_points: string | number; ledger: LoyaltyRow[] }>(`/customers/${id}/loyalty-ledger?limit=50`);
      setLoyaltyLedger(res.ledger || []);
      setLoyaltyStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoyaltyStatus(message);
    }
  }, []);

  const openEdit = useCallback(
    (c: Customer) => {
      setCustomerId(c.id);
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
    },
    []
  );

  const columns = useMemo(() => {
    const cols: Array<DataTableColumn<Customer>> = [
      { id: "code", header: "Code", sortable: true, mono: true, defaultHidden: true, accessor: (c) => c.code || "" },
      {
        id: "name",
        header: "Name",
        sortable: true,
        accessor: (c) => c.name,
        cell: (c) => (
          <button
            type="button"
            className="ui-link text-left font-medium"
            onClick={() => setCustomerId(c.id)}
          >
            {c.name}
          </button>
        )
      },
      {
        id: "party_type",
        header: "Type",
        sortable: true,
        accessor: (c) => c.party_type || "individual",
        cell: (c) => (
          <Chip variant={(c.party_type || "individual") === "business" ? "primary" : "default"}>
            {c.party_type || "individual"}
          </Chip>
        ),
        globalSearch: true,
      },
      { id: "phone", header: "Phone", sortable: true, accessor: (c) => c.phone || "-" },
      { id: "email", header: "Email", sortable: true, accessor: (c) => c.email || "-" },
      { id: "membership_no", header: "Membership #", sortable: true, defaultHidden: true, accessor: (c) => c.membership_no || "-" },
      { id: "vat_no", header: "VAT", sortable: true, defaultHidden: true, accessor: (c) => c.vat_no || "-" },
      { id: "tax_id", header: "Tax ID", sortable: true, defaultHidden: true, accessor: (c) => c.tax_id || "-" },
      {
        id: "is_active",
        header: "Active",
        sortable: true,
        accessor: (c) => (c.is_active === false ? "No" : "Yes"),
        cell: (c) => (
          <Chip variant={c.is_active === false ? "default" : "success"}>
            {c.is_active === false ? "No" : "Yes"}
          </Chip>
        ),
      },
      {
        id: "credit_balance_usd",
        header: "AR USD",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (c) => Number(c.credit_balance_usd || 0),
        cell: (c) => fmt(c.credit_balance_usd),
        cellClassName: (c) => {
          const n = Number(c.credit_balance_usd || 0);
          if (n < 0) return "text-danger";
          if (n > 0) return "text-primary";
          return "text-fg-subtle";
        },
      },
      {
        id: "credit_balance_lbp",
        header: "AR LL",
        sortable: true,
        align: "right",
        mono: true,
        accessor: (c) => Number(c.credit_balance_lbp || 0),
        cell: (c) => fmt(c.credit_balance_lbp),
        cellClassName: (c) => {
          const n = Number(c.credit_balance_lbp || 0);
          if (n < 0) return "text-danger";
          if (n > 0) return "text-primary";
          return "text-fg-subtle";
        },
      },
      {
        id: "actions",
        header: "Actions",
        align: "right",
        globalSearch: false,
        cell: (c) => (
          <div className="text-right">
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(c);
              }}
            >
              Edit
            </Button>
          </div>
        ),
      },
    ];
    return cols;
  }, [openEdit]);

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
  }, [customerId, loadLoyaltyLedger]);

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
        {status ? <ErrorBanner error={status} onRetry={load} /> : null}

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
                        className="h-48 w-full rounded-md border border-border bg-bg-elevated p-3 text-xs font-mono text-foreground"
                        value={importText}
                        onChange={(e) => {
                          const v = e.target.value;
                          setImportText(v);
                          recomputeImport(v);
                        }}
                        placeholder={"code,name,party_type,phone,email,membership_no\nC-0001,Walk-in,individual,,,\nC-1002,Company XYZ,business,+961...,ap@xyz.com,"}
                      />
                      {importErrors ? (
                        <pre className="whitespace-pre-wrap rounded-md border border-border bg-bg-sunken p-3 text-xs text-fg-muted">
                          {importErrors}
                        </pre>
                      ) : null}
                      <div className="rounded-md border border-border bg-bg-elevated p-3 text-xs text-fg-muted">
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
                        <label className="text-xs font-medium text-fg-muted">Code (optional)</label>
                        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="C-0001" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Display Name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Doe or ABC Market" />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Type</label>
                        <select className="ui-select" value={partyType} onChange={(e) => setPartyType(e.target.value as PartyType)}>
                          <option value="individual">Individual</option>
                          <option value="business">Business</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Legal Name</label>
                        <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Optional" />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Tax ID</label>
                        <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">VAT No</label>
                        <Input value={vatNo} onChange={(e) => setVatNo(e.target.value)} placeholder="Optional" />
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:col-span-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Phone</label>
                          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+961..." />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Email</label>
                          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@..." />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Payment Terms (days)</label>
                        <Input value={termsDays} onChange={(e) => setTermsDays(e.target.value)} placeholder="0" />
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Credit USD</label>
                          <Input value={creditLimitUsd} onChange={(e) => setCreditLimitUsd(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Credit LL</label>
                          <Input value={creditLimitLbp} onChange={(e) => setCreditLimitLbp(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Membership #</label>
                        <Input value={membershipNo} onChange={(e) => setMembershipNo(e.target.value)} placeholder="Optional" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Member?</label>
                        <select className="ui-select" value={isMember ? "yes" : "no"} onChange={(e) => setIsMember(e.target.value === "yes")}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Active?</label>
                        <select className="ui-select" value={isActive ? "yes" : "no"} onChange={(e) => setIsActive(e.target.value === "yes")}>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Notes</label>
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
                        <label className="text-xs font-medium text-fg-muted">Code (optional)</label>
                        <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="C-0001" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Display Name</label>
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Type</label>
                        <select className="ui-select" value={editPartyType} onChange={(e) => setEditPartyType(e.target.value as PartyType)}>
                          <option value="individual">Individual</option>
                          <option value="business">Business</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Legal Name</label>
                        <Input value={editLegalName} onChange={(e) => setEditLegalName(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Tax ID</label>
                        <Input value={editTaxId} onChange={(e) => setEditTaxId(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">VAT No</label>
                        <Input value={editVatNo} onChange={(e) => setEditVatNo(e.target.value)} />
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:col-span-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Phone</label>
                          <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Email</label>
                          <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Terms (days)</label>
                        <Input value={editTermsDays} onChange={(e) => setEditTermsDays(e.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Credit USD</label>
                          <Input value={editLimitUsd} onChange={(e) => setEditLimitUsd(e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-fg-muted">Credit LL</label>
                          <Input value={editLimitLbp} onChange={(e) => setEditLimitLbp(e.target.value)} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Membership #</label>
                        <Input value={editMembershipNo} onChange={(e) => setEditMembershipNo(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-fg-muted">Member?</label>
                        <select className="ui-select" value={editIsMember ? "yes" : "no"} onChange={(e) => setEditIsMember(e.target.value === "yes")}>
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Active?</label>
                        <select className="ui-select" value={editIsActive ? "yes" : "no"} onChange={(e) => setEditIsActive(e.target.value === "yes")}>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>

                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-fg-muted">Notes</label>
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
	              <DataTable
	                tableId="partners.customers"
	                rows={customers}
	                columns={columns}
	                getRowId={(c) => c.id}
	                globalFilterPlaceholder="Search name, code, phone, email, VAT, tax id, membership..."
	                emptyText="No customers yet."
	                actions={
	                  <Button size="sm" variant="outline" onClick={load}>
	                    Refresh
	                  </Button>
	                }
	              />

	            {detail ? (
	              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Customer Detail</CardTitle>
                    <CardDescription>Operational fields used by invoices and POS credit.</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div>
                      <span className="text-fg-subtle">Code:</span> {detail.code || "-"}
                    </div>
                    <div>
                      <span className="text-fg-subtle">Name:</span> {detail.name}
                    </div>
                    <div>
                      <span className="text-fg-subtle">Type:</span> {detail.party_type || "individual"}
                    </div>
                    <div>
                      <span className="text-fg-subtle">Legal:</span> {detail.legal_name || "-"}
                    </div>
                    <div>
                      <span className="text-fg-subtle">VAT:</span> {detail.vat_no || "-"}
                    </div>
                    <div>
                      <span className="text-fg-subtle">Tax ID:</span> {detail.tax_id || "-"}
                    </div>
                    <div>
                      <span className="text-fg-subtle">Terms:</span> {detail.payment_terms_days}
                    </div>
                    <div>
                      <span className="text-fg-subtle">Credit Limit:</span>{" "}
                      <span className="data-mono">
                        {fmtUsd(detail.credit_limit_usd)} / {fmtLbp(detail.credit_limit_lbp)}
                      </span>
                    </div>
                    <div>
                      <span className="text-fg-subtle">Balance:</span>{" "}
                      <span className="data-mono">
                        {fmtUsd(detail.credit_balance_usd)} / {fmtLbp(detail.credit_balance_lbp)}
                      </span>
                    </div>
                    <div>
                      <span className="text-fg-subtle">Loyalty Points:</span> {fmt(detail.loyalty_points)}
                    </div>
                    <div>
                      <span className="text-fg-subtle">Notes:</span> {detail.notes || "-"}
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
                    {loyaltyStatus ? <ViewRaw value={loyaltyStatus} label="Loyalty details" /> : null}
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
                              <td className="px-3 py-6 text-center text-fg-subtle" colSpan={3}>
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
