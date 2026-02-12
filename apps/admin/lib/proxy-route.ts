export type ProxyRouteContext = {
  params: Promise<{ path?: string[] }>;
};

const DEFAULT_PROXY_TIMEOUT_MS = 12000;

function upstreamBase(): string {
  const raw = (process.env.API_PROXY_TARGET || "http://api_melqard:8000").trim();
  return raw.replace(/\/+$/, "");
}

function joinPath(parts: string[]): string {
  return parts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .join("/");
}

function getRequestId(req: Request): string {
  const existing = req.headers.get("x-request-id");
  if (existing && existing.trim()) return existing.trim();
  try {
    if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
      return (globalThis.crypto as Crypto).randomUUID();
    }
  } catch {
    // ignore
  }
  return `p_${Math.random().toString(16).slice(2)}`;
}

function copyHeaders(upstream: Response, requestId: string): Headers {
  const out = new Headers();

  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "set-cookie") return;
    if (k === "connection" || k === "transfer-encoding" || k === "keep-alive") return;
    out.set(key, value);
  });

  const anyHeaders = upstream.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    for (const cookie of anyHeaders.getSetCookie()) out.append("set-cookie", cookie);
  } else {
    const sc = upstream.headers.get("set-cookie");
    if (sc) out.set("set-cookie", sc);
  }

  out.set("x-request-id", requestId);
  out.set("cache-control", "no-store");
  out.set("x-upstream-url", upstream.url);
  return out;
}

function timeoutMs() {
  const raw = Number(process.env.API_PROXY_TIMEOUT_MS || DEFAULT_PROXY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 250 ? Math.floor(raw) : DEFAULT_PROXY_TIMEOUT_MS;
}

export async function proxyRoute(req: Request, ctx: ProxyRouteContext): Promise<Response> {
  const { path = [] } = await ctx.params;
  const base = upstreamBase();
  const url = new URL(req.url);
  const upstreamUrl = `${base}/${joinPath(path)}${url.search}`;

  const requestId = getRequestId(req);
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("x-request-id", requestId);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs());

  try {
    const init: RequestInit = {
      method: req.method,
      headers,
      redirect: "manual",
      signal: controller.signal
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      (init as any).duplex = "half";
      init.body = req.body;
    }

    const upstream = await fetch(upstreamUrl, init);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: copyHeaders(upstream, requestId)
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        ok: false,
        error: timedOut ? "upstream request timed out" : message,
        upstream_url: upstreamUrl,
        request_id: requestId
      },
      { status: timedOut ? 504 : 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}

