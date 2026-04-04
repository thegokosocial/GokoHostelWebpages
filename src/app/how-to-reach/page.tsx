import Link from "next/link";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Reveal } from "@/components/motion/Reveal";
import { WalkingRouteGuide } from "@/components/sections/WalkingRouteGuide";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Container } from "@/components/ui/Container";
import {
  howToReachHero,
  localContacts,
  parkingWalk,
  transportModes,
} from "@/content/howToReach";
import { buildMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata = buildMetadata({
  title: "How to Reach",
  description: howToReachHero.subtitle,
  path: "/how-to-reach",
});

export default function HowToReachPage() {
  return (
    <>
      <PageRibbon
        title={howToReachHero.title}
        subtitle={howToReachHero.subtitle}
        image="/images/mahabaleshwar_temple.jpg"
        imageAlt="Travel to Gokarna"
      />

      <section className="goko-mesh goko-noise py-16 md:py-24">
        <Container>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-brand-green/70">
            Getting here
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold text-brand-green md:text-display-md">
            Choose your mode
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:gap-8">
            {transportModes.map((m, i) => (
              <Reveal key={m.title} delay={i * 0.04}>
                <Card className="h-full border-brand-mist/80 bg-white/95 py-0 shadow-card ring-brand-green/[0.06] transition-shadow hover:shadow-lift">
                  <CardContent className="p-6 md:p-8">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-mist/70 text-2xl" aria-hidden>
                      {m.icon}
                    </div>
                    <h3 className="mt-5 font-display text-xl font-bold text-brand-green">
                      {m.title}
                    </h3>
                    <div className="mt-4 space-y-3 text-sm leading-relaxed text-brand-green-dark/90 md:text-base">
                      {m.body.map((p, j) => (
                        <p key={`${m.title}-${j}`}>{p}</p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-brand-mist bg-white py-16 md:py-24">
        <Container>
          <h2 className="font-display text-display-md font-bold text-brand-green">
            Local transport & rentals
          </h2>
          <p className="mt-3 max-w-3xl text-brand-green-dark/85">
            {localContacts.intro} Phone numbers appeared on the legacy site — confirm before you travel.
          </p>
          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            <div>
              <h3 className="font-display text-lg font-semibold text-brand-green-dark">
                Autos
              </h3>
              <ul className="mt-4 space-y-4">
                {localContacts.autos.map((a) => (
                  <li key={a.name} className="rounded-2xl bg-brand-sand p-4">
                    <p className="font-semibold text-brand-green-dark">{a.name}</p>
                    <p className="text-sm text-brand-green-dark/80">{a.note}</p>
                    <a
                      href={`tel:${a.phone.replace(/\s/g, "")}`}
                      className="mt-2 inline-block text-sm font-medium text-brand-red underline-offset-2 hover:underline"
                    >
                      {a.phone}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-display text-lg font-semibold text-brand-green-dark">
                Bike rentals
              </h3>
              <ul className="mt-4 space-y-4">
                {localContacts.rentals.map((a) => (
                  <li key={a.name} className="rounded-2xl bg-brand-sand p-4">
                    <p className="font-semibold text-brand-green-dark">{a.name}</p>
                    <p className="text-sm text-brand-green-dark/80">{a.note}</p>
                    <a
                      href={`tel:${a.phone.replace(/\s/g, "")}`}
                      className="mt-2 inline-block text-sm font-medium text-brand-red underline-offset-2 hover:underline"
                    >
                      {a.phone}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-16 md:py-24">
        <Container>
          <WalkingRouteGuide
            title={parkingWalk.title}
            intro={parkingWalk.intro}
            steps={parkingWalk.steps}
            tips={parkingWalk.tips}
            video={parkingWalk.video}
          />
          <div className="mt-10 flex flex-wrap gap-3 border-t border-brand-mist/80 pt-10">
            <ButtonLink href={site.mapsUrl} external>
              Open in Google Maps
            </ButtonLink>
            <ButtonLink href={site.whatsAppUrl} external variant="ctaOutline">
              WhatsApp us
            </ButtonLink>
          </div>
        </Container>
      </section>

      <section className="border-t border-brand-mist py-10">
        <Container>
          <p className="text-center text-sm text-brand-green-dark/75">
            After you arrive, explore{" "}
            <Link href="/things-to-do" className="font-medium text-brand-red underline-offset-2 hover:underline">
              things to do
            </Link>{" "}
            around Gokarna.
          </p>
        </Container>
      </section>
    </>
  );
}
