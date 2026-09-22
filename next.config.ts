import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const isPi = process.env.GOKO_RUNTIME === "pi";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["better-sqlite3"],
  ...(isPi ? { output: "standalone" } : {}),
  env: {
    BUILD_VERSION: process.env.BUILD_VERSION || "unknown",
    NEXT_PUBLIC_GOKO_RUNTIME: process.env.NEXT_PUBLIC_GOKO_RUNTIME || process.env.GOKO_RUNTIME || "cloudflare",
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Content-Security-Policy-Report-Only", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://tagmanager.google.com; img-src 'self' data: blob: https://cdn.prod.website-files.com https://*.googleusercontent.com https://drive.google.com; media-src 'self' https://cdn.prod.website-files.com; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com; frame-src https://bookingengine.stayflexi.com" },
      ],
    }];
  },
};

// OpenNext runs Wrangler + monkey-patches Node's `vm` during dev. Loading it only
// when explicitly enabled avoids rare Webpack runtime errors
// (`__webpack_modules__[moduleId] is not a function`) on plain `next dev`.
// Enable with OPENNEXT_CLOUDFLARE_DEV=1 or NEXT_DEV_WRANGLER_ENV.
const shouldInitOpenNextDev =
  process.env.OPENNEXT_CLOUDFLARE_DEV === "1" ||
  Boolean(process.env.NEXT_DEV_WRANGLER_ENV?.length);

if (process.env.NODE_ENV === "development" && shouldInitOpenNextDev) {
  void import("@opennextjs/cloudflare").then((m) =>
    m.initOpenNextCloudflareForDev()
  );
}

const analyzeBundles = withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" });
export default analyzeBundles(nextConfig);
