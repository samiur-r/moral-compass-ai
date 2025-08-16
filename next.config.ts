import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Security headers for all pages
  async headers() {
    const baseHeaders = [
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "X-XSS-Protection",
        value: "1; mode=block",
      },
      {
        key: "Referrer-Policy",
        value: "no-referrer",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];

    // Add HSTS headers in production
    if (process.env.NODE_ENV === "production") {
      baseHeaders.unshift({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      });
    }

    return [
      {
        source: "/(.*)",
        headers: baseHeaders,
      },
      {
        source: "/api/(.*)",
        headers: [
          ...baseHeaders,
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; frame-ancestors 'none';",
          },
        ],
      },
    ];
  },

  // Request body size limits
  experimental: {
    serverComponentsExternalPackages: [],
  },

  // Enable compression
  compress: true,

  // Security-related configurations
  poweredByHeader: false, // Remove X-Powered-By header
};

export default nextConfig;
