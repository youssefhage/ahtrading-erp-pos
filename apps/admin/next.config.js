/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    // Admin V2 is a client-only app mounted at /v2. During local/dev ops, we don't want the HTML to be cached
    // aggressively (stale chunks can cause confusing router warnings).
    return [
      {
        source: "/v2",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/v2/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
  async rewrites() {
    const rawTarget = process.env.API_PROXY_TARGET || "http://api:8000";
    const target = rawTarget.replace(/\/$/, "");
    return [
      {
        source: "/api/:path*",
        destination: `${target}/:path*`
      }
    ];
  }
};

module.exports = nextConfig;
