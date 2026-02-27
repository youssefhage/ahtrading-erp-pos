import { NextResponse, type NextRequest } from "next/server";

/**
 * Auth-guard middleware.
 *
 * If the user has no session cookie (`ahtrading_session`), redirect to /login
 * for any protected route.  Public routes (login, landing, static assets,
 * API proxy, etc.) are excluded.
 */

const PUBLIC_PATHS = [
  "/login",
  "/",
  "/favicon.ico",
  "/icon.png",
  "/apple-icon.png",
];

const PUBLIC_PREFIXES = [
  "/api/",      // backend proxy — auth handled by backend
  "/_next/",    // Next.js internals
  "/light/",    // public marketing pages
  "/dark/",     // public marketing pages
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return NextResponse.next();
  }

  // Allow static file extensions
  if (/\.(png|jpg|jpeg|svg|gif|ico|css|js|woff2?|ttf|eot|map)$/.test(pathname)) {
    return NextResponse.next();
  }

  // Check for session cookie
  const session = request.cookies.get("ahtrading_session");
  if (!session?.value) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next.js internals and static files.
     * This is the recommended pattern from Next.js docs.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
