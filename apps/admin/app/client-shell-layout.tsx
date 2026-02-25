"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { titleForPath } from "@/lib/nav";

const PUBLIC_PREFIXES = ["/login", "/company/select"];
// Public utility routes that just flip client-side UI settings (no auth gating here).
const PUBLIC_PREFIXES_EXTRA = ["/lite", "/full", "/light", "/dark"];

function isPrintPath(pathname: string) {
  // Match any route that contains a `print` path segment.
  // Examples:
  // - /sales/invoices/[id]/print
  // - /purchasing/supplier-invoices/[id]/print
  const clean = String(pathname || "").split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  return parts.includes("print");
}

function isPublicPath(pathname: string) {
  if (pathname === "/") return true;
  // Print-friendly views should not be wrapped with the AppShell/nav chrome.
  if (isPrintPath(pathname)) return true;
  return [...PUBLIC_PREFIXES, ...PUBLIC_PREFIXES_EXTRA].some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function ClientShellLayout(props: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";

  if (isPublicPath(pathname)) return props.children;
  return <AppShell title={titleForPath(pathname)}>{props.children}</AppShell>;
}
