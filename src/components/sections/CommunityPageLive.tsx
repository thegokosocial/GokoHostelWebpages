"use client";

import { useEffect, useState } from "react";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Reveal } from "@/components/motion/Reveal";
import { CommunitySpaceCard } from "@/components/sections/CardWithModal";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { heroVideoB } from "@/lib/site";
import type { CommunityPageData } from "@/lib/siteContent";

export function CommunityPageLive({ initial }: { initial: CommunityPageData }) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/site?page=community")
      .then((r) => (r.ok ? r.json() : null))
      .then((live: unknown) => {
        if (cancelled || !live || typeof live !== "object") return;
        const next = live as CommunityPageData;
        if (!next.copy?.hero || !Array.isArray(next.spaces)) return;
        setData(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const { copy, spaces } = data;

  return (
    <>
      <PageRibbon
        title={copy.hero.title}
        subtitle={copy.hero.subtitle}
        image={copy.hero.ribbonImage}
        imageAlt="Goko community space"
        heroVideo={heroVideoB}
        pageKey="community"
      />

      <section className="py-16 md:py-24">
        <Container>
          <SectionHeader title={copy.intro.title} />
          <p className="mx-auto mt-6 max-w-3xl text-center text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
            {copy.intro.paragraph}
          </p>
        </Container>
      </section>

      <section className="relative py-16 md:py-24">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
        <Container>
          <SectionHeader title="Our common spaces" />
          <p className="mx-auto mt-3 max-w-2xl text-center text-brand-green-dark/85">
            Designed for connection, comfort, and community. Click any space to explore photos.
          </p>
          {spaces.length === 0 ? (
            <p className="mt-10 text-center text-sm text-brand-green-dark/60">No common spaces listed yet.</p>
          ) : (
          <div className="mt-14 grid gap-10 md:grid-cols-2">
            {spaces.map((s, i) => (
              <Reveal key={`${s.title}-${i}`} delay={i * 0.05}>
                <CommunitySpaceCard space={s} />
              </Reveal>
            ))}
          </div>
          )}
        </Container>
      </section>

      <section className="relative bg-brand-sand/40 py-16 md:py-24">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
        <Container>
          <SectionHeader title={copy.activities.title} />
          <p className="mx-auto mt-3 max-w-3xl text-center text-brand-green-dark/85">
            {copy.activities.subtitle}
          </p>
          <div className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2">
            {copy.activities.badges.map((b, i) => (
              <span
                key={`${b}-${i}`}
                className="rounded-full border border-brand-mist bg-white px-3 py-1.5 text-xs font-medium text-brand-green-dark md:text-sm"
              >
                {b}
              </span>
            ))}
          </div>
          <div className="mx-auto mt-12 max-w-2xl rounded-3xl border border-brand-mist bg-white p-8 shadow-soft md:p-10">
            <h3 className="text-center font-display text-xl font-bold text-brand-green">
              {copy.activities.rhythmTitle}
            </h3>
            <p className="mt-4 text-center text-sm leading-relaxed text-brand-green-dark/90 md:text-base">
              {copy.activities.rhythmIntro}
            </p>
            <ul className="mt-8 space-y-3 border-t border-brand-mist pt-6 text-sm text-brand-green-dark/90 md:text-base">
              {copy.activities.weekly.map((w, i) => (
                <li key={`${w.label}-${i}`} className="flex gap-3 border-b border-brand-mist/80 pb-3 last:border-b-0 last:pb-0">
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
          <SectionHeader title={copy.specialEvents.title} />
          <p className="mx-auto mt-3 max-w-3xl text-center text-brand-green-dark/85">
            {copy.specialEvents.subtitle}
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {copy.specialEvents.cards.map((c, i) => (
              <Reveal key={`${c.title}-${i}`} delay={i * 0.05}>
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
