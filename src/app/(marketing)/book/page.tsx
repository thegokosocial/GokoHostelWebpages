import { PageRibbon } from "@/components/layout/PageRibbon";
import { buildMetadata } from "@/lib/seo";
import { BookingHeroPanel } from "@/components/booking/BookingHeroPanel";

export const dynamic = "force-static";
export const metadata = buildMetadata({ title: "Book your Goko stay", description: "Plan your stay at Goko Hostel in Gokarna. Contact our team for dates, beds and booking assistance.", path: "/book" });

export default function BookPage() {
  return (
    <PageRibbon
      title="Your next chapter starts at Goko"
      subtitle="A bed by the beach. A community to come home to."
      image="/images/IMG_3345.jpg"
      imageAlt="Palm trees near Goko Hostel"
    >
      <BookingHeroPanel />
    </PageRibbon>
  );
}
