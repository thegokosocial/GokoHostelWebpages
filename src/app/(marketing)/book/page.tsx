import { PageRibbon } from "@/components/layout/PageRibbon";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/button";
import { buildMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { BookingHeroPanel } from "@/components/booking/BookingHeroPanel";

export const dynamic = "force-static";
export const metadata = buildMetadata({ title: "Book your Goko stay", description: "Plan your stay at Goko Hostel in Gokarna. Contact our team for dates, beds and booking assistance.", path: "/book" });

export default function BookPage() {
  return <>
    <PageRibbon title="Your next chapter starts at Goko" subtitle="A bed by the beach. A community to come home to." image="/images/IMG_3345.jpg" imageAlt="Palm trees near Goko Hostel"><BookingHeroPanel /></PageRibbon>
    <section className="py-14 md:py-20">
      <Container>
        <div className="mx-auto max-w-2xl rounded-2xl border border-brand-mist bg-brand-sand/40 p-6 text-brand-green-dark md:p-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-green">Goko direct booking</p>
          <h2 className="mt-3 font-display text-3xl font-bold">Stay a little closer to Goko</h2>
          <p className="mt-4 leading-relaxed">Search our online beds above, choose your selection and send it to our team to confirm rates and availability. You can also retrieve an existing booking with your confirmation number and email verification.</p>
          <p className="mt-3 text-sm">This page does not take payments or create a confirmed reservation. Please wait for confirmation from our team.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href="/booking-enquiry">Send a booking enquiry</ButtonLink>
            <ButtonLink href={site.whatsAppUrl} external variant="ctaOutline">Ask us on WhatsApp</ButtonLink>
          </div>
          <div className="mt-8 grid gap-4 border-t border-brand-mist pt-6 text-sm sm:grid-cols-2">
            <p><strong>Solo travellers & small groups</strong><br />Up to 4 guests, aged 18–35. No children.</p>
            <p><strong>Stay timings</strong><br />Check-in from noon. Check-out by 10 AM.</p>
            <p><strong>Easygoing, non-AC dorms</strong><br />An individual fan, locker and charging point at each bed.</p>
            <p><strong>Plan your arrival</strong><br />A scenic 300 m walk from parking. Backpacks recommended.</p>
          </div>
          <a href="/stay" className="mt-6 inline-block font-semibold text-brand-green underline underline-offset-4">Explore our dorms and amenities</a>
        </div>
      </Container>
    </section>
  </>;
}
