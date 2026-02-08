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

type Supplier = {
  id: string;
  code?: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  payment_terms_days: string | number;
  party_type?: PartyType;
  legal_name?: string | null;
  tax_id?: string | null;
  vat_no?: string | null;
  notes?: string | null;
  is_active?: boolean;
};

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [detail, setDetail] = useState<Supplier | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState<PartyType>("business");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [vatNo, setVatNo] = useState("");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [termsDays, setTermsDays] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [creating, setCreating] = useState(false);

  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editPartyType, setEditPartyType] = useState<PartyType>("business");
  const [editLegalName, setEditLegalName] = useState("");
  const [editTaxId, setEditTaxId] = useState("");
  const [editVatNo, setEditVatNo] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTermsDays, setEditTermsDays] = useState("0");
  const [editIsActive, setEditIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<
    { code?: string | null; name: string; party_type?: PartyType; phone?: string | null; email?: string | null; payment_terms_days?: number }[]
  >([]);
  const [importErrors, setImportErrors] = useState("");
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return suppliers;
    return suppliers.filter((s) => {
      return (
        s.name.toLowerCase().includes(needle) ||
        (s.code || "").toLowerCase().includes(needle) ||
        (s.legal_name || "").toLowerCase().includes(needle) ||
        (s.phone || "").toLowerCase().includes(needle) ||
        (s.email || "").toLowerCase().includes(needle) ||
        (s.vat_no || "").toLowerCase().includes(needle) ||
        (s.tax_id || "").toLowerCase().includes(needle)
      );
    });
  }, [suppliers, q]);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ suppliers: Supplier[] }>("/suppliers");
      setSuppliers(res.suppliers || []);
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
    const found = suppliers.find((s) => s.id === supplierId) || null;
    setDetail(found);
  }, [supplierId, suppliers]);

  async function createSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setStatus("name is required");
    setCreating(true);
    setStatus("Creating...");
    try {
      await apiPost("/suppliers", {
        code: code.trim() || null,
        name: name.trim(),
        party_type: partyType,
        legal_name: legalName.trim() || null,
        tax_id: taxId.trim() || null,
        vat_no: vatNo.trim() || null,
        notes: notes.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        payment_terms_days: Number(termsDays || 0),
        is_active: isActive
      });
      setName("");
      setCode("");
      setPartyType("business");
      setLegalName("");
      setTaxId("");
      setVatNo("");
      setNotes("");
      setPhone("");
      setEmail("");
      setTermsDays("0");
      setIsActive(true);
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

  function openEdit(s: Supplier) {
    setSupplierId(s.id);
    setEditCode((s.code as any) || "");
    setEditName(s.name || "");
    setEditPartyType((s.party_type as PartyType) || "business");
    setEditLegalName(s.legal_name || "");
    setEditTaxId(s.tax_id || "");
    setEditVatNo(s.vat_no || "");
    setEditNotes(s.notes || "");
    setEditPhone(s.phone || "");
    setEditEmail(s.email || "");
    setEditTermsDays(String(s.payment_terms_days ?? 0));
    setEditIsActive(s.is_active !== false);
    setEditOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) return;
    if (!editName.trim()) return setStatus("name is required");
    setSaving(true);
    setStatus("Saving...");
    try {
      await apiPatch(`/suppliers/${supplierId}`, {
        code: editCode.trim() || null,
        name: editName.trim(),
        party_type: editPartyType,
        legal_name: editLegalName.trim() || null,
        tax_id: editTaxId.trim() || null,
        vat_no: editVatNo.trim() || null,
        notes: editNotes.trim() || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        payment_terms_days: Number(editTermsDays || 0),
        is_active: editIsActive
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
      const termsIdx = idx(["payment_terms_days", "terms_days", "terms"]);
      if (nameIdx < 0) {
        setImportPreview([]);
        setImportErrors("Missing required header: name");
        return;
      }
      const preview: { code?: string | null; name: string; party_type?: PartyType; phone?: string | null; email?: string | null; payment_terms_days?: number }[] = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const name = (row[nameIdx] || "").trim();
        if (!name) continue;
        const partyRaw = partyIdx >= 0 ? (row[partyIdx] || "").trim().toLowerCase() : "";
        const party_type: PartyType = partyRaw === "individual" ? "individual" : "business";
        const terms = termsIdx >= 0 ? Number((row[termsIdx] || "").trim() || 0) : 0;
        preview.push({
          code: codeIdx >= 0 ? (row[codeIdx] || "").trim() || null : null,
          name,
          party_type,
          phone: phoneIdx >= 0 ? (row[phoneIdx] || "").trim() || null : null,
          email: emailIdx >= 0 ? (row[emailIdx] || "").trim() || null : null,
          payment_terms_days: Number.isFinite(terms) ? terms : 0
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
    setStatus("Importing suppliers...");
    try {
      await apiPost("/suppliers/bulk", { suppliers: importPreview });
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
                <CardTitle>Suppliers</CardTitle>
                <CardDescription>{suppliers.length} suppliers</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full md:w-96">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name/legal/phone/email/vat/tax..." />
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
                      <DialogTitle>Import Suppliers (CSV)</DialogTitle>
                      <DialogDescription>
                        Header required. Columns:{" "}
                        <span className="font-mono text-xs">code,name,party_type,phone,email,payment_terms_days</span>.
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
                        placeholder={
                          "code,name,party_type,phone,email,payment_terms_days\nS-0001,Default Supplier,business,+961...,ap@supplier.com,30\n,John Vendor,individual,,,0"
                        }
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
                      <DialogTitle>Create Supplier</DialogTitle>
                      <DialogDescription>Supports businesses and individuals.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={createSupplier} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Code (optional)</label>
                        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="S-0001" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Display Name</label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nestle Lebanon" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Type</label>
                        <select className="ui-select" value={partyType} onChange={(e) => setPartyType(e.target.value as PartyType)}>
                          <option value="business">Business</option>
                          <option value="individual">Individual</option>
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
                          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@..." />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Payment Terms (days)</label>
                        <Input value={termsDays} onChange={(e) => setTermsDays(e.target.value)} placeholder="0" />
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
                      <DialogTitle>Edit Supplier</DialogTitle>
                  <DialogDescription>Update legal/tax data and payment terms.</DialogDescription>
                </DialogHeader>
                <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Code (optional)</label>
                        <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} placeholder="S-0001" />
                      </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-700">Display Name</label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Type</label>
                        <select className="ui-select" value={editPartyType} onChange={(e) => setEditPartyType(e.target.value as PartyType)}>
                          <option value="business">Business</option>
                          <option value="individual">Individual</option>
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
                        <label className="text-xs font-medium text-slate-700">Payment Terms (days)</label>
                        <Input value={editTermsDays} onChange={(e) => setEditTermsDays(e.target.value)} />
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

            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead className="ui-thead">
                  <tr>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Active</th>
                    <th className="px-3 py-2 text-right">Terms</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.id} className="ui-tr-hover" style={{ cursor: "pointer" }} onClick={() => setSupplierId(s.id)}>
                      <td className="px-3 py-2 font-mono text-xs">{s.code || "-"}</td>
                      <td className="px-3 py-2 font-medium">{s.name}</td>
                      <td className="px-3 py-2">{s.party_type || "business"}</td>
                      <td className="px-3 py-2">{s.phone || "-"}</td>
                      <td className="px-3 py-2">{s.email || "-"}</td>
                      <td className="px-3 py-2">{s.is_active === false ? <span className="text-slate-500">No</span> : "Yes"}</td>
                      <td className="px-3 py-2 text-right">{Number(s.payment_terms_days || 0)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openEdit(s);
                          }}
                        >
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
                    <CardTitle className="text-base">Supplier Detail</CardTitle>
                    <CardDescription>Used for purchasing and AP.</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div>
                      <span className="text-slate-500">Code:</span> {detail.code || "-"}
                    </div>
                    <div>
                      <span className="text-slate-500">Name:</span> {detail.name}
                    </div>
                    <div>
                      <span className="text-slate-500">Type:</span> {detail.party_type || "business"}
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
                      <span className="text-slate-500">Notes:</span> {detail.notes || "-"}
                    </div>
                  </CardContent>
                </Card>

                <PartyAddresses partyKind="supplier" partyId={detail.id} />
                <PartyContacts partyKind="supplier" partyId={detail.id} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>);
}
