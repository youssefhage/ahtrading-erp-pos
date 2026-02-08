"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AppBar,
  Layout,
  Menu,
  MenuItemLink,
  ToggleThemeButton,
  useGetIdentity,
  useNotify,
  useRefresh,
} from "react-admin";
import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
} from "@mui/material";

import { httpJson } from "@/v2/http";

type Company = { id: string; name: string };

const storageKeys = {
  companyId: "ahtrading.companyId",
} as const;

function getStoredCompanyId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(storageKeys.companyId) || "";
}

function setStoredCompanyId(id: string) {
  if (typeof window === "undefined") return;
  if (!id) window.localStorage.removeItem(storageKeys.companyId);
  else window.localStorage.setItem(storageKeys.companyId, id);
}

function CompanySwitcher() {
  const notify = useNotify();
  const refresh = useRefresh();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string>(() => getStoredCompanyId());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await httpJson<{ companies: Array<{ id: string; name: string }> }>("/companies");
        if (cancelled) return;
        setCompanies(res.companies || []);
      } catch (err) {
        if (cancelled) return;
        notify(err instanceof Error ? err.message : "Failed to load companies", { type: "warning" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const companyChoices = useMemo(() => companies || [], [companies]);

  async function onChange(next: string) {
    setCompanyId(next);
    setStoredCompanyId(next);
    try {
      await httpJson("/auth/select-company", {
        method: "POST",
        body: JSON.stringify({ company_id: next }),
      });
      refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to select company", { type: "warning" });
    }
  }

  return (
    <FormControl size="small" sx={{ minWidth: 220 }}>
      <InputLabel id="company-select-label">Company</InputLabel>
      <Select
        labelId="company-select-label"
        label="Company"
        value={companyId}
        onChange={(e) => onChange(String(e.target.value))}
        disabled={loading || companyChoices.length === 0}
      >
        {companyChoices.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {c.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function RightSide() {
  const { identity } = useGetIdentity();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      <CompanySwitcher />
      <ToggleThemeButton />
      <Tooltip title={identity?.fullName || ""}>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 240 }} noWrap>
          {identity?.fullName || ""}
        </Typography>
      </Tooltip>
    </Box>
  );
}

function AdminV2AppBar() {
  return (
    <AppBar
      toolbar={
        <Box sx={{ width: "100%", display: "flex", alignItems: "center" }}>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 0.2 }}>
              Admin V2
            </Typography>
            <Typography variant="body2" color="text.secondary">
              ERPNext-style flows
            </Typography>
          </Box>
          <RightSide />
        </Box>
      }
    />
  );
}

export function AdminV2Layout(props: React.ComponentProps<typeof Layout>) {
  return <Layout {...props} appBar={AdminV2AppBar} menu={AdminV2Menu} />;
}

function AdminV2Menu() {
  return (
    <Menu>
      <Menu.DashboardItem />
      <MenuItemLink to="/ops" primaryText="Ops Portal" />
      <Menu.ResourceItem name="sales-invoices" />
      <Menu.ResourceItem name="items" />
      <Menu.ResourceItem name="customers" />
    </Menu>
  );
}
