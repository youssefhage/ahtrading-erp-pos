"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { getCompanyId, getCompanies } from "@/lib/api";
import { applyCompanyMetadata } from "@/lib/constants";

const PUBLIC_PREFIXES = ["/login", "/company/select"];
const PUBLIC_PREFIXES_EXTRA = ["/lite", "/full", "/light", "/dark"];

function isPrintPath(pathname: string) {
  const clean = String(pathname || "").split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  return parts.includes("print");
}

function isPublicPath(pathname: string) {
  if (pathname === "/") return true;
  if (isPrintPath(pathname)) return true;
  return [...PUBLIC_PREFIXES, ...PUBLIC_PREFIXES_EXTRA].some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function ClientShellLayout(props: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";

  // Re-apply company metadata (title, favicon, accent) after hydration and
  // on every client-side navigation so Next.js never overrides them.
  // Also validate the company and strip ?company= from URL.
  useEffect(() => {
    // Strip ?company= from URL after the init script has read it
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("company")) {
        url.searchParams.delete("company");
        window.history.replaceState({}, "", url.toString());
      }
    } catch { /* ignore */ }

    const cid = getCompanyId();
    if (!cid) return;

    // Validate the company is one the user is authorized for
    const authorized = getCompanies();
    if (authorized.length > 0 && !authorized.includes(cid)) {
      // Invalid company for this user — clear and redirect to select
      try { window.sessionStorage.removeItem("ahtrading.companyId"); } catch { /* ignore */ }
      window.location.href = "/company/select";
      return;
    }

    applyCompanyMetadata(cid);
  }, [pathname]);

  if (isPublicPath(pathname)) return props.children;
  return <AppShell>{props.children}</AppShell>;
}
