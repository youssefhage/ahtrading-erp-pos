/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Local dev default (backend exposed on host). Docker/CI should override via API_PROXY_TARGET.
    const rawTarget = process.env.API_PROXY_TARGET || "http://127.0.0.1:8001";
    const target = rawTarget.replace(/\/$/, "");
    return [
      {
        source: "/api/:path*",
        destination: `${target}/:path*`
      },
      {
        // Cloud: avoid /api host-level collisions by using a different path prefix that
        // always reaches the Next.js server, then proxy to the API container.
        source: "/xapi/:path*",
        destination: `${target}/:path*`
      }
    ];
  }
};

module.exports = nextConfig;
