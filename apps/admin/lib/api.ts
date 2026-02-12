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

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type ApiCallOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
};

export class ApiError extends Error {
  status: number;
  body: unknown;
  requestId?: string;

  constructor(status: number, message: string, body: unknown, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

const storageKeys = {
  companyId: "ahtrading.companyId",
  companies: "ahtrading.companies"
} as const;

function nextRequestId() {
  try {
    return globalThis.crypto && "randomUUID" in globalThis.crypto
      ? (globalThis.crypto as Crypto).randomUUID()
      : undefined;
  } catch {
    return undefined;
  }
}

function asNumber(raw: unknown, fallback: number, min = 1) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
}

function resolveTimeout(ms?: number) {
  if (ms != null) return Math.max(300, asNumber(ms, DEFAULT_REQUEST_TIMEOUT_MS));
  return asNumber(process.env.NEXT_PUBLIC_API_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS, 300);
}

function resolveRetries(method: string, overrides?: number) {
  if (overrides != null) return Math.max(0, asNumber(overrides, 0, 0));
  return RETRYABLE_METHODS.has(method.toUpperCase()) ? 1 : 0;
}

function resolveRetryDelay(ms?: number) {
  return asNumber(ms, 250, 50);
}

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
  if (!("token" in login)) return;
  window.localStorage.setItem(storageKeys.companies, JSON.stringify(login.companies || []));
  const currentCompany = getCompanyId();
  const nextCompany = currentCompany || (login.active_company_id || "") || (login.companies?.[0] || "");
  if (nextCompany) window.localStorage.setItem(storageKeys.companyId, nextCompany);
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKeys.companyId);
  window.localStorage.removeItem(storageKeys.companies);
}

function headers(extra?: Record<string, string>, requestId?: string) {
  const rid = requestId || nextRequestId();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (rid) h["X-Request-Id"] = rid;
  return { ...h, ...(extra || {}) };
}

function headersForm(extra?: Record<string, string>, requestId?: string) {
  const rid = requestId || nextRequestId();
  const h: Record<string, string> = {};
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

async function parseErrorBody(res: Response): Promise<unknown> {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return await res.text().catch(() => "");
    }
  }
  return await res.text().catch(() => "");
}

async function handle(res: Response) {
  if (res.ok) return res;

  const body = await parseErrorBody(res);
  let message = extractJsonMessage(body);
  if (!message) {
    if (typeof body === "string") message = body;
    else message = JSON.stringify(body);
  }
  message = String(message || "").trim();
  if (!message) message = `Request failed: ${res.status}`;
  if (!message.startsWith("HTTP ")) message = `HTTP ${res.status}: ${message}`;
  const requestId = res.headers.get("x-request-id") || undefined;
  throw new ApiError(res.status, message, body, requestId);
}

function toRequestJsonError(bodyText: string | unknown, err: unknown, requestId?: string) {
  if (err instanceof Error && err.name === "AbortError") {
    return new ApiError(504, "Request timeout or network failure", bodyText, requestId);
  }
  if (err instanceof ApiError) return err;
  if (err instanceof TypeError) return new ApiError(503, err.message || "Network error", bodyText, requestId);
  if (err instanceof Error) return new ApiError(500, err.message || "Unexpected error", bodyText, requestId);
  if (err == null) return new ApiError(500, "Unexpected error", bodyText, requestId);
  return new ApiError(500, String(err), bodyText, requestId);
}

function parseSuccessBody<T>(response: Response): Promise<T> {
  const ct = (response.headers.get("content-type") || "").toLowerCase();
  return response.text().then((text) => {
    if (!ct.includes("application/json")) {
      return ((text ?? "") as unknown) as T;
    }
    if (!text.trim()) return ({} as unknown) as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return (text as unknown) as T;
    }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetry(attempt: number, maxAttempts: number, method: string, err: unknown, status?: number) {
  if (attempt + 1 >= maxAttempts) return false;
  if (!RETRYABLE_METHODS.has(method.toUpperCase())) return false;
  if (status != null && RETRYABLE_STATUS.has(status)) return true;
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  return false;
}

async function requestJson<T>(path: string, init: RequestInit, opts: ApiCallOptions = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const timeoutMs = resolveTimeout(opts.timeoutMs);
  const maxAttempts = resolveRetries(method, opts.retries) + 1;
  const retryDelayMs = resolveRetryDelay(opts.retryDelayMs);
  const requestId = (() => {
    if (!init.headers) return undefined;
    if (init.headers instanceof Headers) {
      return init.headers.get("x-request-id") ?? init.headers.get("X-Request-Id") ?? undefined;
    }
    if (typeof init.headers === "object" && !Array.isArray(init.headers)) {
      const map = init.headers as Record<string, string>;
      return map["X-Request-Id"] ?? map["x-request-id"] ?? undefined;
    }
    return undefined;
  })();
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const timerController = new AbortController();
    let detach = () => {};

    try {
      if (opts.signal) {
        if (opts.signal.aborted) {
          const reason = opts.signal.reason;
          if (reason instanceof Error) throw reason;
          throw new ApiError(499, typeof reason === "string" ? reason : "Request cancelled", null, requestId);
        }
        const relay = () => timerController.abort(opts.signal?.reason);
        opts.signal.addEventListener("abort", relay, { once: true });
        detach = () => opts.signal?.removeEventListener("abort", relay);
      }

      const timeoutId = window.setTimeout(() => {
        timerController.abort(new DOMException("Request timeout", "AbortError"));
      }, timeoutMs);

      const response = await fetch(apiUrl(path), {
        ...init,
        signal: timerController.signal,
      });
      clearTimeout(timeoutId);

      const res = await handle(response);
      if (res.status === 204) return {} as T;
      return await parseSuccessBody<T>(res);
    } catch (err) {
      lastErr = err;
      const status = err instanceof ApiError ? err.status : undefined;

      if (shouldRetry(attempt, maxAttempts, method, err, status)) {
        const delay = retryDelayMs * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      if (err instanceof DOMException && err.name === "AbortError") {
        throw toRequestJsonError(null, err, requestId);
      }
      if (err instanceof ApiError) throw err;
      throw toRequestJsonError(null, err, requestId);
    } finally {
      detach();
    }
  }

  throw lastErr instanceof Error ? lastErr : new ApiError(503, "Request failed", null);
}

export async function apiGet<T>(path: string, options?: ApiCallOptions): Promise<T> {
  return requestJson<T>(path, {
    method: "GET",
    headers: headers(),
    credentials: "include",
  }, options);
}

export async function apiPost<T>(path: string, body: unknown, options?: ApiCallOptions): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    credentials: "include",
  }, options);
}

export async function apiPatch<T>(path: string, body: unknown, options?: ApiCallOptions): Promise<T> {
  return requestJson<T>(path, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
    credentials: "include",
  }, options);
}

export async function apiDelete<T>(path: string, options?: ApiCallOptions): Promise<T> {
  return requestJson<T>(path, {
    method: "DELETE",
    headers: headers(),
    credentials: "include",
  }, options);
}

export async function apiPostForm<T>(path: string, body: FormData, options?: ApiCallOptions): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: headersForm(),
    body,
    credentials: "include",
  }, options);
}
