"use client";

import { useEffect, useState } from "react";

import { apiGet, apiPost, getCompanyId } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type DeviceRow = {
  id: string;
  branch_id: string | null;
  device_code: string;
  created_at: string;
  has_token: boolean;
};

export default function PosDevicesPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [status, setStatus] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const [deviceCode, setDeviceCode] = useState("");
  const [branchId, setBranchId] = useState("");
  const [registering, setRegistering] = useState(false);
  const [lastToken, setLastToken] = useState<{ id: string; token: string | null } | null>(null);

  async function load() {
    setStatus("Loading...");
    try {
      const res = await apiGet<{ devices: DeviceRow[] }>("/pos/devices");
      setDevices(res.devices || []);
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function registerDevice(e: React.FormEvent) {
    e.preventDefault();
    const companyId = getCompanyId();
    if (!companyId) {
      setStatus("Company is not selected. Go to Change Company first.");
      return;
    }
    if (!deviceCode.trim()) {
      setStatus("device_code is required");
      return;
    }

    setRegistering(true);
    setStatus("Registering device...");
    setLastToken(null);
    try {
      const qs = new URLSearchParams();
      qs.set("company_id", companyId);
      qs.set("device_code", deviceCode.trim());
      if (branchId.trim()) qs.set("branch_id", branchId.trim());
      const res = await apiPost<{ id: string; token: string | null }>(`/pos/devices/register?${qs.toString()}`, {});
      setLastToken(res);
      setDeviceCode("");
      setBranchId("");
      setRegisterOpen(false);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
    } finally {
      setRegistering(false);
    }
  }

  async function resetToken(deviceId: string) {
    setStatus("Resetting token...");
    setLastToken(null);
    try {
      const res = await apiPost<{ id: string; token: string }>(`/pos/devices/${deviceId}/reset-token`, {});
      setLastToken(res);
      await load();
      setStatus("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(message);
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

        {lastToken ? (
          <Card>
            <CardHeader>
              <CardTitle>Device Token</CardTitle>
              <CardDescription>
                This token is shown once. Copy it into the POS agent `config.json`.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-600">Device ID</span>
                <code className="rounded bg-slate-100 px-2 py-1 text-xs">{lastToken.id}</code>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-600">Token</span>
                <code className="rounded bg-slate-100 px-2 py-1 text-xs break-all">
                  {lastToken.token || "(token not returned; already registered)"}
                </code>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
            <CardDescription>{devices.length} devices</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={load}>
                Refresh
              </Button>
              <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
                <DialogTrigger asChild>
                  <Button>Register Device</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Register POS Device</DialogTitle>
                    <DialogDescription>Creates a device and returns a one-time token.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={registerDevice} className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Device Code</label>
                      <Input value={deviceCode} onChange={(e) => setDeviceCode(e.target.value)} placeholder="POS-01" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-700">Branch ID (optional)</label>
                      <Input value={branchId} onChange={(e) => setBranchId(e.target.value)} placeholder="uuid" />
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={registering}>
                        {registering ? "..." : "Register"}
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
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Device ID</th>
                    <th className="px-3 py-2">Branch</th>
                    <th className="px-3 py-2">Token</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id} className="ui-tr-hover">
                      <td className="px-3 py-2 font-mono text-xs">{d.device_code}</td>
                      <td className="px-3 py-2 font-mono text-xs">{d.id}</td>
                      <td className="px-3 py-2 font-mono text-xs">{d.branch_id || "-"}</td>
                      <td className="px-3 py-2 text-xs">{d.has_token ? "set" : "missing"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => resetToken(d.id)}>
                          Reset Token
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {devices.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                        No devices yet.
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
