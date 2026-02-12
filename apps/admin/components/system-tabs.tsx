"use client";

import { TabBar } from "@/components/tab-bar";
import { cn } from "@/lib/utils";

export function SystemTabs(props: { className?: string }) {
  return (
    <TabBar
      className={props.className}
      tabs={[
        { label: "Config", href: "/system/config", activePathPrefix: "/system/config" },
        { label: "Branches", href: "/system/branches", activePathPrefix: "/system/branches" },
        { label: "Warehouses", href: "/system/warehouses", activePathPrefix: "/system/warehouses" },
        { label: "Locations", href: "/system/warehouse-locations", activePathPrefix: "/system/warehouse-locations" },
        { label: "Dimensions", href: "/system/dimensions", activePathPrefix: "/system/dimensions" },
        { label: "UOMs", href: "/system/uoms", activePathPrefix: "/system/uoms" },
        { label: "Users", href: "/system/users", activePathPrefix: "/system/users" },
        { label: "Roles", href: "/system/roles-permissions", activePathPrefix: "/system/roles-permissions" },
        { label: "Security", href: "/system/security", activePathPrefix: "/system/security" },
        { label: "POS Devices", href: "/system/pos-devices", activePathPrefix: "/system/pos-devices" },
        { label: "POS Cashiers", href: "/system/pos-cashiers", activePathPrefix: "/system/pos-cashiers" },
        { label: "POS Shifts", href: "/system/pos-shifts", activePathPrefix: "/system/pos-shifts" },
        { label: "Outbox", href: "/system/outbox", activePathPrefix: "/system/outbox" },
        { label: "Audit", href: "/system/audit-logs", activePathPrefix: "/system/audit-logs" },
        { label: "Attention", href: "/system/attention", activePathPrefix: "/system/attention" },
      ]}
    />
  );
}

