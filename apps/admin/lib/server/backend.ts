import { headers } from "next/headers";

function stripTrailingSlash(s: string) {
  return s.replace(/\/+$/, "");
}

export function backendBaseUrl(): string {
  // Match `next.config.js` rewrite default to keep local/dev simple.
  return stripTrailingSlash(process.env.API_PROXY_TARGET || "http://api_melqard:8000");
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
  return backendGetJsonWithHeaders<T>(path);
}

export async function backendGetJsonWithHeaders<T>(path: string, extraHeaders?: Record<string, string>): Promise<T> {
  const h = await headers();
  const cookie = h.get("cookie") || "";
  const url = backendBaseUrl() + (path.startsWith("/") ? path : `/${path}`);
  const merged = {
    ...(cookie ? { cookie } : {}),
    ...(extraHeaders || {})
  } as Record<string, string>;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: Object.keys(merged).length ? merged : undefined,
      // Never cache PDFs or the data they depend on (auditability + correctness).
      cache: "no-store"
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new BackendHttpError(503, "Backend GET failed: 503", detail);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BackendHttpError(res.status, `Backend GET failed: ${res.status}`, text);
  }
  return (await res.json()) as T;
}
