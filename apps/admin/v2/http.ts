type HttpErrorPayload = {
  status: number;
  message: string;
  body?: unknown;
};

export class HttpError extends Error {
  status: number;
  body?: unknown;
  constructor(payload: HttpErrorPayload) {
    super(payload.message);
    this.name = "HttpError";
    this.status = payload.status;
    this.body = payload.body;
  }
}

function apiBase(): string {
  // Keep everything same-origin to reuse cookie-based sessions.
  return "/api";
}

export async function httpJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

  if (!res.ok) {
    const detail =
      (body && typeof body === "object" && "detail" in (body as any) ? String((body as any).detail) : "") ||
      (typeof body === "string" && body) ||
      `Request failed (${res.status})`;
    throw new HttpError({ status: res.status, message: detail, body });
  }

  return body as T;
}

