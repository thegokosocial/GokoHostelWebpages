import Image from "next/image";
import { Reveal } from "@/components/motion/Reveal";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Container } from "@/components/ui/Container";
import { BookNowButton } from "@/components/booking/BookNowButton";
import { ButtonLink } from "@/components/ui/button";
import { eventsHero, eventsPastCta, upcomingEvents, pastEvents } from "@/content/events";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Events",
  description: eventsHero.subtitle,
  path: "/events",
});

const fallbackImg = "/images/IMG_3345.jpg";

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
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            {upcomingEvents.map((ev, i) => (
              <Reveal key={ev.title} delay={i * 0.04}>
                <article className="overflow-hidden rounded-3xl border border-brand-mist bg-white shadow-card">
                  <div className="relative aspect-[16/10]">
                    <Image
                      src={ev.cover ?? fallbackImg}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="(max-width:768px) 100vw, 50vw"
                    />
                  </div>
                  <div className="p-6">
                    <time className="text-sm font-semibold uppercase tracking-wide text-brand-red">
                      {ev.date}
                    </time>
                    <h3 className="mt-2 font-display text-xl font-bold text-brand-green-dark">
                      {ev.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-brand-green-dark/85 md:text-base">
                      {ev.description}
                    </p>
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {ev.tags.map((t) => (
                        <li
                          key={t}
                          className="rounded-full bg-brand-sand px-3 py-1 text-xs font-medium text-brand-green"
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-brand-mist bg-white py-12 md:py-20">
        <Container>
          <h2 className="font-display text-display-md font-bold text-brand-green">
            Memories from past events
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            {pastEvents.map((ev, i) => (
              <Reveal key={ev.title} delay={i * 0.04}>
                <article className="flex flex-col overflow-hidden rounded-3xl border border-brand-mist bg-brand-sand/50 sm:flex-row">
                  <div className="relative aspect-video sm:aspect-auto sm:h-auto sm:min-h-[200px] sm:w-2/5 sm:shrink-0">
                    <Image
                      src={ev.cover ?? fallbackImg}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="(max-width:640px) 100vw, 240px"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <time className="text-xs font-bold uppercase tracking-wide text-brand-green/70">
                      {ev.date}
                    </time>
                    <h3 className="mt-2 font-display text-lg font-bold text-brand-green-dark">
                      {ev.title}
                    </h3>
                    <p className="mt-2 flex-1 text-sm text-brand-green-dark/85">
                      {ev.description}
                    </p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>

          <div className="mx-auto mt-14 max-w-2xl rounded-3xl border border-brand-mist bg-brand-sand/60 p-8 text-center shadow-soft md:p-10">
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
