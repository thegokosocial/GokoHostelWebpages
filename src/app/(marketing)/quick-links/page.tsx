import type { Metadata } from "next";
import { QuickLinksPublic } from "@/components/sections/QuickLinksPublic";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Guest Links & QR Codes",
  description: "Quick access to Goko Hostel check-in, food ordering, payments, and guest services.",
  path: "/quick-links",
});

export default function QuickLinksPage() {
  return <QuickLinksPublic />;
}
