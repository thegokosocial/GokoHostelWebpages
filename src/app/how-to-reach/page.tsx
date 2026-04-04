import Link from "next/link";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Reveal } from "@/components/motion/Reveal";
import { ButtonLink } from "@/components/ui/Button";
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

      <section className="py-16 md:py-24">
        <Container>
          <div className="grid gap-8 md:grid-cols-2">
            {transportModes.map((m, i) => (
              <Reveal key={m.title} delay={i * 0.04}>
                <article className="h-full rounded-3xl border border-brand-mist bg-white p-6 shadow-soft md:p-8">
                  <div className="text-3xl" aria-hidden>
                    {m.icon}
                  </div>
                  <h2 className="mt-4 font-display text-xl font-bold text-brand-green">
                    {m.title}
                  </h2>
                  <div className="mt-4 space-y-3 text-sm leading-relaxed text-brand-green-dark/90 md:text-base">
                    {m.body.map((p, j) => (
                      <p key={`${m.title}-${j}`}>{p}</p>
                    ))}
                  </div>
                </article>
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
          <h2 className="font-display text-display-md font-bold text-brand-green">
            {parkingWalk.title}
          </h2>
          <p className="mt-4 max-w-3xl text-brand-green-dark/90">
            {parkingWalk.intro}
          </p>
          <ol className="mt-10 space-y-6">
            {parkingWalk.steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.05}>
                <li className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-semibold text-brand-green-dark">
                      {s.title}
                    </h3>
                    <p className="mt-2 text-sm text-brand-green-dark/85 md:text-base">
                      {s.text}
                    </p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
          <ul className="mt-10 space-y-2 rounded-2xl bg-brand-mist p-6 text-sm text-brand-green-dark md:text-base">
            {parkingWalk.tips.map((t) => (
              <li key={t}>• {t}</li>
            ))}
          </ul>
          <div className="mt-10 flex flex-wrap gap-3">
            <ButtonLink href={site.mapsUrl} external>
              Open in Google Maps
            </ButtonLink>
            <ButtonLink href={site.whatsAppUrl} external variant="secondary">
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
