export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function upstreamBase(): string {
  const raw = (process.env.API_PROXY_TARGET || "http://api_melqard:8000").trim();
  return raw.replace(/\/+$/, "");
}

function joinPath(parts: string[]): string {
  const cleaned = parts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .map((p) => p.replace(/^\/+|\/+$/g, ""));
  return cleaned.join("/");
}

function copyHeaders(upstream: Response): Headers {
  const out = new Headers();

  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "set-cookie") return;
    if (k === "connection" || k === "transfer-encoding" || k === "keep-alive") return;
    out.set(key, value);
  });

  // Preserve multi-value set-cookie when available (Node/undici).
  const anyHeaders = upstream.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    for (const c of anyHeaders.getSetCookie()) out.append("set-cookie", c);
  } else {
    const sc = upstream.headers.get("set-cookie");
    if (sc) out.set("set-cookie", sc);
  }

  return out;
}

async function proxy(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  const base = upstreamBase();

  const url = new URL(req.url);
  const upstreamUrl = `${base}/${joinPath(path)}${url.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    // Node fetch requires duplex for streaming bodies (multipart upload).
    (init as any).duplex = "half";
    init.body = req.body;
  }

  try {
    const upstream = await fetch(upstreamUrl, init);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: copyHeaders(upstream),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg, upstream_url: upstreamUrl }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
