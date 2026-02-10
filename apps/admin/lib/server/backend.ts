import { headers } from "next/headers";

function stripTrailingSlash(s: string) {
  return s.replace(/\/+$/, "");
}

export function backendBaseUrl(): string {
  // Match `next.config.js` rewrite default to keep local/dev simple.
  return stripTrailingSlash(process.env.API_PROXY_TARGET || "http://api:8000");
}

export class BackendHttpError extends Error {
  status: number;
  bodyText: string;
  constructor(status: number, message: string, bodyText: string) {
    super(message);
    this.name = "BackendHttpError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

export async function backendGetJson<T>(path: string): Promise<T> {
  const h = await headers();
  const cookie = h.get("cookie") || "";
  const url = backendBaseUrl() + (path.startsWith("/") ? path : `/${path}`);
  const res = await fetch(url, {
    method: "GET",
    headers: cookie ? { cookie } : undefined,
    // Never cache PDFs or the data they depend on (auditability + correctness).
    cache: "no-store"
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BackendHttpError(res.status, `Backend GET failed: ${res.status}`, text);
  }
  return (await res.json()) as T;
}

