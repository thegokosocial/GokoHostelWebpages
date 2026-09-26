import { PageRibbon } from "@/components/layout/PageRibbon";
import { StayRoomsLive } from "@/components/sections/StayRoomsLive";
import { BookNowButton } from "@/components/booking/BookNowButton";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  stayAmenities,
  stayHero,
  stayWhy,
} from "@/content/stay";
import { buildMetadata } from "@/lib/seo";
import { heroVideoB } from "@/lib/site";

export const dynamic = "force-static";

export const metadata = buildMetadata({
  title: "Stay",
  description: stayHero.subtitle,
  path: "/stay",
});

export default function StayPage() {
  return (
    <>
      <PageRibbon
        title={stayHero.title}
        subtitle={stayHero.subtitle}
        image={stayHero.image}
        imageAlt="Goko Hostel stay"
        heroVideo={heroVideoB}
      />

      <StayRoomsLive />

      <section className="relative py-16 md:py-24">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
        <Container>
          <SectionHeader title="Amenities & facilities" />
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {stayAmenities.map((a) => (
              <div key={a.title} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-green/[0.07]">
                  <Icon name={a.icon} className="h-6 w-6 text-brand-green" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-brand-green">
                  {a.title}
                </h3>
                <p className="mt-2 text-sm text-brand-green-dark/85 md:text-base">
                  {a.description}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <div className="rounded-3xl bg-gradient-to-br from-brand-green to-brand-green-dark px-6 py-12 text-center text-white md:px-12 md:py-16">
            <h3 className="font-display text-2xl font-bold md:text-3xl">
              Ready to book your stay?
            </h3>
            <p className="mx-auto mt-4 max-w-xl text-base text-white/90">
              Experience the Goko community and make memories that last a
              lifetime.
            </p>
            <BookNowButton className="mt-8 !shadow-lg">Book now</BookNowButton>
          </div>
        </Container>
      </section>

      <section className="relative py-16 md:py-20">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
        <Container>
          <SectionHeader title={stayWhy.title} />
          <div className="mx-auto mt-10 max-w-3xl space-y-5 text-center text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
            {stayWhy.paragraphs.map((p, idx) => (
              <p key={idx}>{p}</p>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
