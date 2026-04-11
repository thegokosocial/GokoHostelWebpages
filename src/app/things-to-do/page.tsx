import { PageRibbon } from "@/components/layout/PageRibbon";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import {
  beaches,
  beachesIntro,
  beachTrekTips,
  dayTrips,
  dayTripsIntro,
  temples,
  templesIntro,
  thingsToDoHero,
} from "@/content/thingsToDo";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Things to Do",
  description: thingsToDoHero.subtitle,
  path: "/things-to-do",
});

export default function ThingsToDoPage() {
  return (
    <>
      <PageRibbon
        title={thingsToDoHero.title}
        subtitle={thingsToDoHero.subtitle}
        image="/images/IMG_7403.jpg"
        imageAlt="Beaches and things to do in Gokarna"
        heroVideo={null}
      />

      <section className="py-16 md:py-24">
        <Container>
          <h2 className="font-display text-display-md font-bold text-brand-green">
            Beaches
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-center text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
            {beachesIntro}
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {beaches.map((b, i) => (
              <Reveal key={b.name} delay={i * 0.04} className="h-full">
                <article className="flex h-full flex-col rounded-3xl border border-brand-mist bg-white p-6 shadow-soft">
                  <h3 className="font-display text-xl font-bold text-brand-green-dark">
                    {b.name}
                  </h3>
                  <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-brand-red">
                    {b.distance}
                  </p>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-brand-green-dark/90 md:text-base">
                    {b.description}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
          <div className="mt-10 rounded-2xl bg-brand-mist p-6">
            <p className="font-display text-sm font-bold uppercase tracking-wide text-brand-green">
              Beach trek tips
            </p>
            <ul className="mt-3 space-y-2 text-sm text-brand-green-dark/90 md:text-base">
              {beachTrekTips.map((t) => (
                <li key={t}>• {t}</li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="relative py-16 md:py-24">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
        <Container>
          <h2 className="font-display text-display-md font-bold text-brand-green">
            Temples & culture
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-center text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
            {templesIntro}
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {temples.map((t, i) => (
              <Reveal key={t.name} delay={i * 0.04} className="h-full">
                <article className="flex h-full flex-col rounded-3xl border border-brand-mist p-6">
                  <h3 className="font-display text-xl font-bold text-brand-green-dark">
                    {t.name}
                  </h3>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-brand-green/80">
                    {t.meta}
                  </p>
                  <p className="mt-3 flex-1 text-sm text-brand-green-dark/90 md:text-base">
                    {t.description}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-16 md:py-24">
        <Container>
          <h2 className="font-display text-display-md font-bold text-brand-green">
            Day trips
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-center text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
            {dayTripsIntro}
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {dayTrips.map((d, i) => (
              <Reveal key={d.name} delay={i * 0.05} className="h-full">
                <article className="flex h-full flex-col rounded-3xl bg-gradient-to-br from-brand-sand to-white p-8 shadow-card">
                  <span className="inline-block rounded-full bg-brand-green px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    {d.badge}
                  </span>
                  <h3 className="mt-4 font-display text-xl font-bold text-brand-green-dark">
                    {d.name}
                  </h3>
                  <p className="text-sm font-medium text-brand-red">{d.meta}</p>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-brand-green-dark/90 md:text-base">
                    {d.description}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
