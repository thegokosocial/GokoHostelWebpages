import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/motion/Reveal";
import { HomeHeroPremium } from "@/components/sections/HomeHeroPremium";
import { RoomTabs } from "@/components/sections/RoomTabs";
import { BookNowButton } from "@/components/booking/BookNowButton";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  homeFaqTeaser,
  homeIntro,
  homeLocation,
  homeNeighborhood,
  homeStats,
} from "@/content/home";
import { guestReviews } from "@/content/reviews";
import { excerpt } from "@/lib/format";
import { buildMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

const homeReviewGrid = guestReviews.slice(0, 6);

export const metadata = buildMetadata({
  title: "Home",
  description: site.description,
  path: "/",
});

export default function HomePage() {
  return (
    <>
      <HomeHeroPremium />

      <section className="relative goko-mesh goko-noise py-20 md:py-28">
        <Container>
          <div className="grid gap-14 lg:grid-cols-2 lg:items-center">
            <Reveal>
              <SectionHeader
                align="left"
                eyebrow="The vibe"
                title={homeIntro.title}
                className="!max-w-none"
                subtitle={undefined}
              />
              <div className="mt-8 space-y-4 text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
                {homeIntro.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              <Link
                href="/story"
                className="mt-8 inline-flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-brand-red transition-transform hover:translate-x-1"
              >
                Our story →
              </Link>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="relative">
                <div
                  className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-brand-red/15 via-transparent to-brand-green/20 blur-2xl motion-safe:animate-goko-float"
                  aria-hidden
                />
                <div className="relative overflow-hidden rounded-3xl shadow-lift ring-1 ring-brand-green/10">
                  <Image
                    src={homeIntro.image}
                    alt={homeIntro.imageAlt}
                    width={1400}
                    height={1050}
                    className="h-auto w-full object-cover transition-transform duration-700 hover:scale-[1.02] motion-reduce:transition-none"
                  />
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      <section className="border-y border-brand-mist bg-white py-14 md:py-20">
        <Container>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
            {homeStats.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.06}>
                <div className="relative text-center">
                  <div
                    className="absolute inset-x-8 top-1/2 -z-10 h-24 -translate-y-1/2 rounded-full bg-brand-mist/80 blur-xl"
                    aria-hidden
                  />
                  <p className="font-display text-3xl font-bold text-brand-green md:text-4xl">
                    {s.value}
                  </p>
                  <p className="mt-3 text-sm font-medium uppercase tracking-wide text-brand-green-dark/70">
                    {s.label}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 md:py-28">
        <Container>
          <SectionHeader
            eyebrow="Stay"
            title="Room types"
            subtitle="Swipe through photos, compare vibes, then lock in your bed—instant confirmation on our booking partner."
          />
          <div className="mt-14">
            <RoomTabs />
          </div>
        </Container>
      </section>

      <section className="relative overflow-hidden bg-gradient-to-b from-white to-brand-sand py-20 md:py-28">
        <div
          className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-brand-green/5 blur-3xl"
          aria-hidden
        />
        <Container>
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <Reveal>
              <div className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-lift lg:order-2">
                <Image
                  src={homeNeighborhood.image}
                  alt={homeNeighborhood.imageAlt}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 45vw"
                />
                <div className="absolute inset-0 bg-gradient-to-tr from-brand-green-dark/40 via-transparent to-transparent" />
              </div>
            </Reveal>
            <Reveal delay={0.06}>
              <div className="lg:order-1">
                <SectionHeader
                  align="left"
                  eyebrow="Neighbourhood"
                  title={homeNeighborhood.titleLead}
                  className="!max-w-xl"
                  subtitle={undefined}
                />
                <div className="mt-8 space-y-4 text-base leading-relaxed text-brand-green-dark/90">
                  {homeNeighborhood.paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
                <Link
                  href={homeNeighborhood.communityAreaLink.href}
                  className="mt-8 inline-flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-brand-red transition-transform hover:translate-x-1"
                >
                  {homeNeighborhood.communityAreaLink.label} →
                </Link>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      <section className="goko-mesh py-20 md:py-24">
        <Container>
          <div className="mx-auto max-w-3xl rounded-3xl border border-brand-mist bg-white/90 p-8 shadow-card backdrop-blur-md md:p-12">
            <Reveal>
              <h2 className="text-center font-display text-display-md font-bold text-brand-green">
                {homeFaqTeaser.title}
              </h2>
              <ul className="mt-10 space-y-3">
                {homeFaqTeaser.items.map((item) => (
                  <li key={item.question}>
                    <Link
                      href={item.href}
                      className="flex min-h-12 items-center justify-between rounded-2xl border border-brand-mist bg-brand-sand/50 px-5 py-3 font-medium text-brand-green-dark transition-colors hover:border-brand-green/30 hover:bg-white"
                    >
                      {item.question}
                      <span className="text-brand-red" aria-hidden>
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-8 text-center">
                <ButtonLink href={homeFaqTeaser.cta.href} variant="ctaOutline">
                  {homeFaqTeaser.cta.label}
                </ButtonLink>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      <section className="relative bg-brand-green py-20 text-white md:py-28">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 80%, rgba(234,54,57,0.25), transparent 45%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.08), transparent 40%)",
          }}
          aria-hidden
        />
        <Container className="relative z-[1]">
          <SectionHeader
            eyebrow="Guests"
            title="Voices from Goko"
            subtitle="A few favourites from what travelers have shared—see the reviews page for the full set."
            className="[&_h2]:text-white [&_p]:text-white/85 [&_.goko-gradient-cta]:opacity-90"
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {homeReviewGrid.map((t, i) => (
              <Reveal key={`${t.author}-${i}`} delay={i * 0.05}>
                <Card className="group/card relative h-full border-white/15 bg-white/[0.08] py-6 text-white shadow-none ring-1 ring-white/10 backdrop-blur-md transition-colors duration-300 hover:bg-white/[0.12] md:py-7">
                  <CardContent className="relative px-6 md:px-7">
                    <div
                      className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-red/30 blur-2xl transition-opacity group-hover/card:opacity-80"
                      aria-hidden
                    />
                    <blockquote className="relative m-0 border-0 p-0">
                      <p className="text-sm leading-relaxed text-white/95 md:text-[0.95rem]">
                        “{excerpt(t.quote, 240)}”
                      </p>
                      <footer className="mt-5 font-display text-xs font-semibold uppercase tracking-wide text-white/70">
                        — {t.author}
                      </footer>
                    </blockquote>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <ButtonLink
              href="/reviews"
              variant="ctaOutline"
              className="!border-white !text-white hover:!bg-white hover:!text-brand-green"
            >
              All guest reviews
            </ButtonLink>
            <ButtonLink
              href={site.googleReviewsSearchUrl}
              external
              variant="ctaGhost"
              className="!text-white hover:!text-white/90 !no-underline hover:!underline"
            >
              Google reviews
            </ButtonLink>
          </div>
        </Container>
      </section>

      <section className="border-t border-brand-mist py-20 md:py-24">
        <Container>
          <Reveal>
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="font-display text-display-md font-bold text-brand-green">
                {homeLocation.title}
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-brand-green-dark/88">
                {homeLocation.body}
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <ButtonLink href={site.mapsUrl} external>
                  Open in Maps
                </ButtonLink>
                <ButtonLink href="/how-to-reach" variant="ctaOutline">
                  How to reach
                </ButtonLink>
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="goko-wave-divider border-t border-brand-mist bg-brand-sand py-16 md:py-20">
        <Container className="text-center">
          <Reveal>
            <h2 className="font-display text-display-md font-bold text-brand-green">
              Ready when you are
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-brand-green-dark/85">
              Instant confirmation on our booking partner, or message us first—we love
              helping you plan.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <BookNowButton>Book now</BookNowButton>
              <ButtonLink href="/booking-enquiry" variant="ctaOutline">
                Booking enquiry
              </ButtonLink>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
