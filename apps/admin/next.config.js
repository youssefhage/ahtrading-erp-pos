/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
