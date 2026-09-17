import { notFound } from "next/navigation";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { BookingHeroPanel } from "@/components/booking/BookingHeroPanel";
import { todayIST } from "@/lib/utils";
import { addCalendarDays } from "@/lib/inventoryAvailability";
export const dynamic = "force-dynamic";
export const metadata = { title: "Booking design preview — Goko", robots: { index: false, follow: false } };
export default function BookingPreviewPage() {
  if (process.env.GOKO_BOOKING_UI_PREVIEW !== "true") notFound();
  const checkinDate = addCalendarDays(todayIST(), 7), middle = addCalendarDays(checkinDate, 1), checkoutDate = addCalendarDays(checkinDate, 2);
  const rate = (id: number, name: string, first: number, second: number) => ({ id, name, nightlyRates: [{ date: checkinDate, rupees: first }, { date: middle, rupees: second }], subtotalRupees: first + second });
  return <PageRibbon title="Your next chapter starts at Goko" subtitle="Explore the booking design. Payments are blocked." image="/images/IMG_3345.jpg">
    <BookingHeroPanel preview={{ taxPercent: 5, stay: { checkinDate, checkoutDate, guests: "2" }, rooms: [
      { id: "demo-mixed", name: "Mixed dorm", type: "Bed", capacity: 1, availableUnits: 6, rates: [rate(1, "Sample standard rate", 850, 950), rate(2, "Sample flexible rate", 1000, 1100)] },
      { id: "demo-female", name: "Female dorm", type: "Bed", capacity: 1, availableUnits: 3, rates: [rate(3, "Sample standard rate", 900, 1000)] },
      { id: "demo-double", name: "Mixed dorm double beds", type: "Double", capacity: 2, availableUnits: 2, rates: [rate(4, "Sample double rate", 1600, 1800)] },
    ] }} />
  </PageRibbon>;
}
