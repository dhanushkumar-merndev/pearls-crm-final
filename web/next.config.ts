import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera for prescription scanning (Phase 8); location for "Use my current location" on an office (Phase 18).
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
];

const config: NextConfig = {
  // A second build beside the normal one (scripts/videos records from its own copy); default .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@pearl/shared"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(config);
