"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";

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

  if (isPublicPath(pathname)) return props.children;
  return <AppShell>{props.children}</AppShell>;
}
