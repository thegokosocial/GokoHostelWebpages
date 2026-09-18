import type { Metadata } from "next";

export const dynamic = "force-static";

/**
 * PWA install + Home Screen targets are admin-only — not the public website.
 * Apple meta/icons are required so Safari Share → Add to Home Screen creates a
 * real standalone app (not just a Safari bookmark).
 */
export const metadata: Metadata = {
  title: "Admin",
  manifest: "/manifest.webmanifest",
  applicationName: "Goko",
  appleWebApp: {
    capable: true,
    title: "Goko",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Goko",
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
