import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // API is on a different port — proxy in dev so browser doesn't need CORS
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
  experimental: {
    // Server actions enabled by default in Next 15
    typedRoutes: false,
  },
};

export default nextConfig;
