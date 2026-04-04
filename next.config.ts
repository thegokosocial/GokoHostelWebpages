import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
};

// OpenNext runs Wrangler + monkey-patches Node's `vm` during dev. That integration
// is only needed when testing Cloudflare bindings locally; skipping it avoids rare
// Webpack runtime errors (`__webpack_modules__[moduleId] is not a function`) on
// plain `next dev`. Enable with OPENNEXT_CLOUDFLARE_DEV=1 or NEXT_DEV_WRANGLER_ENV.
const shouldInitOpenNextDev =
  process.env.OPENNEXT_CLOUDFLARE_DEV === "1" ||
  Boolean(process.env.NEXT_DEV_WRANGLER_ENV?.length);

if (process.env.NODE_ENV === "development" && shouldInitOpenNextDev) {
  void initOpenNextCloudflareForDev();
}

export default nextConfig;
