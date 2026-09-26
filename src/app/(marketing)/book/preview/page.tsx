import { notFound } from "next/navigation";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { BookingHeroPanel } from "@/components/booking/BookingHeroPanel";
import { todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";
export const dynamic = "force-dynamic";
export const metadata = { title: "Booking design preview — Goko", robots: { index: false, follow: false } };
export default function BookingPreviewPage() {
  if (process.env.GOKO_BOOKING_UI_PREVIEW !== "true") notFound();
  const checkinDate = addCalendarDays(todayIST(), 7), checkoutDate = addCalendarDays(checkinDate, 2);
  return <PageRibbon title="Your next chapter starts at Goko" subtitle="Explore the booking design. Payments are blocked." image="/images/IMG_3345.jpg" pageKey="book">
    <BookingHeroPanel preview={{ stay: { checkinDate, checkoutDate } }} />
  </PageRibbon>;
}
