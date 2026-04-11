import { Reveal } from "@/components/motion/Reveal";
import { EventCard } from "@/components/sections/CardWithModal";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Container } from "@/components/ui/Container";
import { BookNowButton } from "@/components/booking/BookNowButton";
import { ButtonLink } from "@/components/ui/button";
import {
  eventsHero,
  eventsPastCta,
  upcomingEvents,
  pastEvents,
} from "@/content/events";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Events",
  description: eventsHero.subtitle,
  path: "/events",
});

export default function EventsPage() {
  return (
    <>
      <PageRibbon
        title={eventsHero.title}
        subtitle={eventsHero.subtitle}
        image="/images/goko-holi-2024/IMG_6047.jpg"
        imageAlt="Colour and celebration at Goko Hostel"
      />
      <section className="py-8">
        <Container>
          <div className="flex flex-wrap justify-center gap-2">
            {eventsHero.chips.map((c) => (
              <span
                key={c}
                className="rounded-full bg-brand-mist px-4 py-2 text-sm font-medium text-brand-green-dark"
              >
                {c}
              </span>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-12 md:py-16">
        <Container>
          <h2 className="font-display text-display-md font-bold text-brand-green">
            Upcoming highlights
          </h2>
          <p className="mt-3 text-base text-brand-green-dark/70">
            Click on any event to see details and promotional images
          </p>
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            {upcomingEvents.map((ev, i) => (
              <Reveal key={ev.title} delay={i * 0.04}>
                <EventCard ev={ev} />
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="relative py-12 md:py-20">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
        <Container>
          <h2 className="font-display text-display-md font-bold text-brand-green">
            Memories from past events
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            {pastEvents.map((ev, i) => (
              <Reveal key={ev.title} delay={i * 0.04}>
                <EventCard ev={ev} />
              </Reveal>
            ))}
          </div>

          <div className="goko-border-gradient mx-auto mt-14 max-w-2xl rounded-3xl bg-brand-sand/60 p-8 text-center shadow-soft md:p-10">
            <h3 className="font-display text-xl font-bold text-brand-green-dark md:text-2xl">
              {eventsPastCta.title}
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-brand-green-dark/90 md:text-base">
              {eventsPastCta.body}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <ButtonLink href="/stay">View rooms</ButtonLink>
              <BookNowButton variant="ctaOutline">Book now</BookNowButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
