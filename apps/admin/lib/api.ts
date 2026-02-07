export type LoginResponse = {
  token: string;
  user_id: string;
  companies: string[];
  active_company_id?: string | null;
};

const storageKeys = {
  companyId: "ahtrading.companyId",
  companies: "ahtrading.companies"
} as const;

export function apiBase(): string {
  // Prefer a same-origin proxy path so the browser never needs direct access
  // to the backend container network hostname.
  return process.env.NEXT_PUBLIC_API_BASE_URL || "/api";
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
  const h: Record<string, string> = { "Content-Type": "application/json" };
  return { ...h, ...(extra || {}) };
}

async function handle(res: Response) {
  if (res.ok) return res;
  const text = await res.text();
  throw new Error(text || `Request failed: ${res.status}`);
}

export async function apiGet<T>(path: string): Promise<T> {
  const raw = await fetch(`${apiBase()}${path}`, {
    headers: headers(),
    credentials: "include"
  });
  const res = await handle(raw);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const raw = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    credentials: "include"
  });
  const res = await handle(raw);
  return (await res.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const raw = await fetch(`${apiBase()}${path}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
    credentials: "include"
  });
  const res = await handle(raw);
  return (await res.json()) as T;
}
