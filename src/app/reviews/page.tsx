import { Reveal } from "@/components/motion/Reveal";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { BookNowButton } from "@/components/booking/BookNowButton";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { guestReviews } from "@/content/reviews";
import { buildMetadata } from "@/lib/seo";
import { site, social } from "@/lib/site";

export const metadata = buildMetadata({
  title: "Reviews",
  description:
    "Guest love for Goko Hostel — full testimonials migrated from our homepage, plus Google and Instagram.",
  path: "/reviews",
});

export default function ReviewsPage() {
  return (
    <>
      <PageRibbon
        title="Reviews & love from travellers"
        subtitle="Real words from travellers who shared sunsets, meals, and dance floors with us."
        image="/images/IMG_7403.jpg"
        imageAlt="Guests at Goko Hostel"
      />
      <section className="goko-mesh py-16 md:py-24">
        <Container>
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink href={site.googleReviewsSearchUrl} external>
              Google reviews
            </ButtonLink>
            <ButtonLink href={social.instagram} external variant="ctaOutline">
              Instagram
            </ButtonLink>
            <BookNowButton variant="ctaOutline">Book a bed</BookNowButton>
          </div>

          <div className="mt-16">
            <SectionHeader
              title="Every card from the original site"
              subtitle="Longer reviews our guests left on Google—lightly edited for typos only."
            />
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-2">
            {guestReviews.map((t, i) => (
              <Reveal key={`${t.author}-${i}`} delay={(i % 4) * 0.04}>
                <Card className="group/card h-full border-brand-mist bg-white py-8 shadow-card transition-shadow duration-300 hover:shadow-lift">
                  <CardContent className="relative px-8">
                    <div
                      className="absolute -right-10 top-0 h-40 w-40 rounded-full bg-brand-red/10 blur-3xl transition-opacity group-hover/card:bg-brand-red/15"
                      aria-hidden
                    />
                    <blockquote className="relative m-0 border-0 p-0">
                      <p className="text-base leading-relaxed text-brand-green-dark/92">
                        “{t.quote}”
                      </p>
                      <footer className="mt-8 border-t border-brand-mist pt-6 font-display text-sm font-semibold text-brand-green">
                        — {t.author}
                      </footer>
                    </blockquote>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>

          <p className="mx-auto mt-16 max-w-2xl text-center text-sm text-brand-green-dark/80">
            We’re a small team — if you stayed with us, leaving a note on Google
            helps the next traveler find their way to the sand.
          </p>
        </Container>
      </section>
    </>
  );
}
