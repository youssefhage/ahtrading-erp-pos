import { proxyRoute, type ProxyRouteContext } from "@/lib/proxy-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: ProxyRouteContext) {
  return proxyRoute(req, ctx);
}

export async function POST(req: Request, ctx: ProxyRouteContext) {
  return proxyRoute(req, ctx);
}

export async function PUT(req: Request, ctx: ProxyRouteContext) {
  return proxyRoute(req, ctx);
}

export async function PATCH(req: Request, ctx: ProxyRouteContext) {
  return proxyRoute(req, ctx);
}

export async function DELETE(req: Request, ctx: ProxyRouteContext) {
  return proxyRoute(req, ctx);
}

export async function OPTIONS(req: Request, ctx: ProxyRouteContext) {
  return proxyRoute(req, ctx);
}
