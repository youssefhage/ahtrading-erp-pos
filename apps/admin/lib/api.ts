export type LoginResponse =
  | {
      token: string;
      user_id: string;
      companies: string[];
      active_company_id?: string | null;
      mfa_required?: false;
    }
  | {
      mfa_required: true;
      mfa_token: string;
      user_id: string;
      companies: string[];
      active_company_id?: string | null;
    };

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const storageKeys = {
  companyId: "ahtrading.companyId",
  companies: "ahtrading.companies"
} as const;

export function apiBase(): string {
  // Prefer a same-origin proxy path so the browser never needs direct access
  // to the backend container network hostname.
  return process.env.NEXT_PUBLIC_API_BASE_URL || "/api";
}

export function apiUrl(path: string): string {
  const base = apiBase().replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export function getCompanyId(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(storageKeys.companyId) || "";
}

export function getCompanies(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(storageKeys.companies);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setSession(login: LoginResponse) {
  if (typeof window === "undefined") return;
  // Only store session info after a successful login that minted a session token.
  if (!("token" in login)) return;
  window.localStorage.setItem(storageKeys.companies, JSON.stringify(login.companies || []));
  const currentCompany = getCompanyId();
  const nextCompany =
    currentCompany || (login.active_company_id || "") || (login.companies?.[0] || "");
  if (nextCompany) window.localStorage.setItem(storageKeys.companyId, nextCompany);
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKeys.companyId);
  window.localStorage.removeItem(storageKeys.companies);
}

function headers(extra?: Record<string, string>) {
  const rid = (() => {
    try {
      return globalThis.crypto && "randomUUID" in globalThis.crypto
        ? (globalThis.crypto as Crypto).randomUUID()
        : undefined;
    } catch {
      return undefined;
    }
  })();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (rid) h["X-Request-Id"] = rid;
  return { ...h, ...(extra || {}) };
}

function headersForm(extra?: Record<string, string>) {
  const rid = (() => {
    try {
      return globalThis.crypto && "randomUUID" in globalThis.crypto
        ? (globalThis.crypto as Crypto).randomUUID()
        : undefined;
    } catch {
      return undefined;
    }
  })();
  const h: Record<string, string> = {};
  // Don't set Content-Type for FormData; the browser will set the boundary.
  if (rid) h["X-Request-Id"] = rid;
  return { ...h, ...(extra || {}) };
}

function extractJsonMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  const detail = b["detail"];
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  const err = b["error"];
  if (typeof err === "string" && err.trim()) return err.trim();
  const msg = b["message"];
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  return "";
}

async function handle(res: Response) {
  if (res.ok) return res;

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  let body: unknown = null;
  let message = "";

  if (ct.includes("application/json")) {
    try {
      body = await res.json();
      message = extractJsonMessage(body);
      if (!message) message = JSON.stringify(body);
    } catch {
      body = await res.text().catch(() => "");
      if (typeof body === "string") message = body;
    }
  } else {
    body = await res.text().catch(() => "");
    if (typeof body === "string") message = body;
  }

  message = String(message || "").trim();
  if (!message) message = `Request failed: ${res.status}`;
  // Include status code (keeps logs/actionability high in the UI).
  if (!message.startsWith("HTTP ")) message = `HTTP ${res.status}: ${message}`;

  throw new ApiError(res.status, message, body);
}

export async function apiGet<T>(path: string): Promise<T> {
  const raw = await fetch(apiUrl(path), {
    headers: headers(),
    credentials: "include"
  });
  const res = await handle(raw);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const raw = await fetch(apiUrl(path), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    credentials: "include"
  });
  const res = await handle(raw);
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const raw = await fetch(apiUrl(path), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
    credentials: "include"
  });
  const res = await handle(raw);
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const raw = await fetch(apiUrl(path), {
    method: "DELETE",
    headers: headers(),
    credentials: "include"
  });
  const res = await handle(raw);
  return (await res.json()) as T;
}

export async function apiPostForm<T>(path: string, body: FormData): Promise<T> {
  const raw = await fetch(apiUrl(path), {
    method: "POST",
    headers: headersForm(),
    body,
    credentials: "include"
  });
  const res = await handle(raw);
  return (await res.json()) as T;
}
