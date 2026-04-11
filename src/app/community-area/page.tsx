import { PageRibbon } from "@/components/layout/PageRibbon";
import { Reveal } from "@/components/motion/Reveal";
import { CommunitySpaceCard } from "@/components/sections/CardWithModal";
import { Container } from "@/components/ui/Container";
import {
  communityActivities,
  communityHero,
  communityIntro,
  communitySpaces,
  communitySpecialEvents,
} from "@/content/community";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Community Area",
  description: communityHero.subtitle,
  path: "/community-area",
});

export default function CommunityAreaPage() {
  return (
    <>
      <PageRibbon
        title={communityHero.title}
        subtitle={communityHero.subtitle}
        image="/legacy-images/62f5bf7bfc22850018b36726-63021b52b4a9f5776b671ae4_home_video-thumbnail_2.webp"
        imageAlt="Goko community space"
      />

      <section className="py-16 md:py-24">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-display-md font-bold text-brand-green">
              {communityIntro.title}
            </h2>
            <p className="mt-6 text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
              {communityIntro.paragraph}
            </p>
          </div>
        </Container>
      </section>

      <section className="relative py-16 md:py-24">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
        <Container>
          <h2 className="text-center font-display text-display-md font-bold text-brand-green">
            Our common spaces
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-brand-green-dark/85">
            Designed for connection, comfort, and community. Click any space to explore photos.
          </p>
          <div className="mt-14 grid gap-10 md:grid-cols-2">
            {communitySpaces.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.05}>
                <CommunitySpaceCard space={s} />
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="relative bg-brand-sand/40 py-16 md:py-24">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-display-md font-bold text-brand-green">
              {communityActivities.title}
            </h2>
            <p className="mt-3 text-brand-green-dark/85">{communityActivities.subtitle}</p>
          </div>
          <div className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2">
            {communityActivities.badges.map((b) => (
              <span
                key={b}
                className="rounded-full border border-brand-mist bg-white px-3 py-1.5 text-xs font-medium text-brand-green-dark md:text-sm"
              >
                {b}
              </span>
            ))}
          </div>
          <div className="mx-auto mt-12 max-w-2xl rounded-3xl border border-brand-mist bg-white p-8 shadow-soft md:p-10">
            <h3 className="text-center font-display text-xl font-bold text-brand-green">
              {communityActivities.rhythmTitle}
            </h3>
            <p className="mt-4 text-center text-sm leading-relaxed text-brand-green-dark/90 md:text-base">
              {communityActivities.rhythmIntro}
            </p>
            <ul className="mt-8 space-y-3 border-t border-brand-mist pt-6 text-sm text-brand-green-dark/90 md:text-base">
              {communityActivities.weekly.map((w) => (
                <li key={w.label} className="flex gap-3 border-b border-brand-mist/80 pb-3 last:border-b-0 last:pb-0">
                  <span className="shrink-0 font-semibold text-brand-red">{w.label}</span>
                  <span>{w.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section className="py-16 md:py-24">
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-display text-display-md font-bold text-brand-green">
              {communitySpecialEvents.title}
            </h2>
            <p className="mt-3 text-brand-green-dark/85">{communitySpecialEvents.subtitle}</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {communitySpecialEvents.cards.map((c, i) => (
              <Reveal key={c.title} delay={i * 0.05}>
                <article className="h-full rounded-3xl border border-brand-mist bg-white p-6 shadow-soft md:p-8">
                  <h3 className="font-display text-lg font-bold text-brand-green-dark md:text-xl">
                    {c.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-brand-green-dark/90 md:text-base">
                    {c.description}
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
