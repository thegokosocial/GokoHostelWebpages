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

      {/* ── Intro / The vibe ── */}
      <section className="relative goko-mesh goko-noise py-24 md:py-32">
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
                className="group/link mt-8 inline-flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-brand-red transition-all duration-200 hover:gap-3"
              >
                Our story
                <span className="transition-transform duration-200 group-hover/link:translate-x-0.5">→</span>
              </Link>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="relative">
                <div
                  className="absolute -inset-4 rounded-4xl bg-gradient-to-br from-brand-red/12 via-transparent to-brand-green/15 blur-2xl motion-safe:animate-goko-float"
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

      {/* ── Goko = Gokarna ── */}
      <section className="relative overflow-hidden py-24 md:py-32">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-sand via-white to-brand-sand/60"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-32 top-1/4 h-[30rem] w-[30rem] rounded-full bg-brand-red/[0.03] blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-32 bottom-1/4 h-[25rem] w-[25rem] rounded-full bg-brand-green/[0.04] blur-3xl"
          aria-hidden
        />
        <Container className="relative">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-20">
            <Reveal>
              <div className="relative">
                <div
                  className="absolute -inset-4 rounded-4xl bg-gradient-to-br from-brand-red/10 via-transparent to-brand-green/12 blur-2xl motion-safe:animate-goko-float"
                  aria-hidden
                />
                <div className="relative overflow-hidden rounded-3xl shadow-lift ring-1 ring-brand-green/10">
                  <Image
                    src="/images/goko-gokarna-sign.png"
                    alt="Railway sign showing Goko = Gokarna in English, Hindi, and Kannada"
                    width={800}
                    height={534}
                    className="h-auto w-full object-cover transition-transform duration-700 hover:scale-[1.02] motion-reduce:transition-none"
                  />
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.1}>
              <SectionHeader
                align="left"
                eyebrow="The name"
                title="Goko = Gokarna"
                className="!max-w-none"
                subtitle={undefined}
              />
              <div className="mt-8 space-y-4 text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
                <p>
                  If you&apos;ve ever taken the Konkan Railway into Gokarna, you&apos;ve
                  seen the yellow sign on the platform—Goko is the official
                  railway code, the local shorthand that every regular knows.
                </p>
                <p>
                  We borrowed the name because it fits: short, warm, and
                  unmistakably rooted in this place. Goko carries the soul of
                  Gokarna—its unhurried pace, its surf-and-sand mornings, its
                  chai-on-the-cliff sunsets, and the kind of community you only
                  find in a small coastal temple town.
                </p>
                <p>
                  Visit Goko and you complete the Gokarna experience—community,
                  comfort, and coastline all under one roof.
                </p>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* ── Stats ── */}
      <section className="relative py-16 md:py-20">
        <div className="goko-divider-fade mx-auto max-w-4xl" aria-hidden />
        <Container className="py-14 md:py-16">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-4">
            {homeStats.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.08}>
                <div className="goko-border-gradient relative rounded-2xl bg-white/70 px-6 py-8 text-center backdrop-blur-sm transition-shadow duration-300 hover:shadow-card">
                  <p className="font-display text-4xl font-bold tracking-tight text-brand-green md:text-5xl">
                    {s.value}
                  </p>
                  <p className="mt-3 text-sm font-medium uppercase tracking-widest text-brand-green-dark/60">
                    {s.label}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
        <div className="goko-divider-fade mx-auto max-w-4xl" aria-hidden />
      </section>

      {/* ── Room types ── */}
      <section className="relative py-24 md:py-32">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-brand-sand/30 to-transparent"
          aria-hidden
        />
        <Container className="relative">
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

      {/* ── Neighbourhood ── */}
      <section className="relative overflow-hidden py-24 md:py-32">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white via-brand-sand/50 to-white"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-brand-green/[0.04] blur-3xl"
          aria-hidden
        />
        <Container className="relative">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-20">
            <Reveal>
              <div className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-lift lg:order-2">
                <Image
                  src={homeNeighborhood.image}
                  alt={homeNeighborhood.imageAlt}
                  fill
                  className="object-cover transition-transform duration-700 hover:scale-[1.02] motion-reduce:transition-none"
                  sizes="(max-width: 1024px) 100vw, 45vw"
                />
                <div className="absolute inset-0 bg-gradient-to-tr from-brand-green-dark/30 via-transparent to-transparent" />
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
                <div className="mt-8 space-y-4 text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
                  {homeNeighborhood.paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
                <Link
                  href={homeNeighborhood.communityAreaLink.href}
                  className="group/link mt-8 inline-flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-brand-red transition-all duration-200 hover:gap-3"
                >
                  {homeNeighborhood.communityAreaLink.label}
                  <span className="transition-transform duration-200 group-hover/link:translate-x-0.5">→</span>
                </Link>
              </div>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* ── FAQ teaser ── */}
      <section className="relative py-20 md:py-24">
        <div
          className="pointer-events-none absolute inset-0 goko-mesh goko-noise"
          aria-hidden
        />
        <Container className="relative">
          <div className="goko-border-gradient mx-auto max-w-3xl rounded-3xl bg-white/80 p-8 shadow-card backdrop-blur-lg md:p-12">
            <Reveal>
              <h2 className="text-center font-display text-display-md font-bold text-brand-green">
                {homeFaqTeaser.title}
              </h2>
              <ul className="mt-10 space-y-3">
                {homeFaqTeaser.items.map((item) => (
                  <li key={item.question}>
                    <Link
                      href={item.href}
                      className="group/faq flex min-h-12 items-center justify-between rounded-2xl bg-brand-sand/60 px-5 py-3.5 font-medium text-brand-green-dark transition-all duration-200 hover:bg-white hover:shadow-soft"
                    >
                      {item.question}
                      <span className="text-brand-red transition-transform duration-200 group-hover/faq:translate-x-1" aria-hidden>
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

      {/* ── Reviews ── */}
      <section className="relative overflow-hidden bg-brand-green py-24 text-white md:py-32">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 50% at 15% 85%, rgba(234,54,57,0.2), transparent 50%), radial-gradient(ellipse 50% 60% at 85% 15%, rgba(255,255,255,0.06), transparent 45%), radial-gradient(ellipse 40% 40% at 50% 50%, rgba(255,255,255,0.03), transparent 50%)",
          }}
          aria-hidden
        />
        <Container className="relative z-[1]">
          <SectionHeader
            eyebrow="Guests"
            title="Voices from Goko"
            subtitle="A few favourites from what travelers have shared—see the reviews page for the full set."
            className="[&_h2]:text-white [&_p]:text-white/80 [&_.goko-gradient-cta]:opacity-80"
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {homeReviewGrid.map((t, i) => (
              <Reveal key={`${t.author}-${i}`} delay={i * 0.05}>
                <Card className="group/card relative h-full overflow-hidden border-white/[0.08] bg-white/[0.06] py-6 text-white shadow-none ring-1 ring-white/[0.08] backdrop-blur-xl transition-all duration-300 hover:bg-white/[0.1] hover:ring-white/[0.15] hover:shadow-[0_8px_32px_rgba(0,0,0,0.2)] md:py-7">
                  <CardContent className="relative px-6 md:px-7">
                    <div
                      className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-brand-red/20 blur-2xl transition-all duration-500 group-hover/card:bg-brand-red/30 group-hover/card:blur-3xl"
                      aria-hidden
                    />
                    <blockquote className="relative m-0 border-0 p-0">
                      <p className="text-sm leading-relaxed text-white/90 md:text-[0.95rem]">
                        &ldquo;{excerpt(t.quote, 240)}&rdquo;
                      </p>
                      <footer className="mt-5 flex items-center gap-2">
                        <div className="h-px flex-1 bg-white/10" />
                        <span className="font-display text-xs font-semibold uppercase tracking-wide text-white/60">
                          {t.author}
                        </span>
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
              className="!border-white/30 !bg-white/[0.06] !text-white hover:!bg-white hover:!text-brand-green"
            >
              All guest reviews
            </ButtonLink>
            <ButtonLink
              href={site.googleReviewsSearchUrl}
              external
              variant="ctaGhost"
              className="!text-white/80 hover:!text-white !no-underline hover:!underline"
            >
              Google reviews
            </ButtonLink>
          </div>
        </Container>
      </section>

      {/* ── Location ── */}
      <section className="relative py-24 md:py-28">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-sand/40 via-white to-brand-sand/60"
          aria-hidden
        />
        <Container className="relative">
          <Reveal>
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="font-display text-display-md font-bold text-brand-green">
                {homeLocation.title}
              </h2>
              <p className="mt-6 text-lg leading-relaxed text-brand-green-dark/85">
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

      {/* ── Closing CTA ── */}
      <section className="relative overflow-hidden bg-brand-sand py-20 md:py-24">
        <div className="goko-divider-fade mx-auto mb-16 max-w-4xl" aria-hidden />
        <Container className="text-center">
          <Reveal>
            <h2 className="font-display text-display-md font-bold text-brand-green">
              Ready when you are
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-brand-green-dark/80">
              Instant confirmation on our booking partner when you&apos;re ready to stay
              with us.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <BookNowButton>Book now</BookNowButton>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
