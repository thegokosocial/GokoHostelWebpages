import Image from "next/image";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import {
  founders,
  storyBegin,
  storyHero,
  storyStaff,
  storyTeamLeads,
  storyValues,
} from "@/content/story";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Our Story",
  description: storyHero.subtitle,
  path: "/story",
});

export default function StoryPage() {
  return (
    <>
      <PageRibbon
        title={storyHero.title}
        subtitle={storyHero.subtitle}
        image="/images/story/pawan/WhatsApp%20Image%202025-12-06%20at%2010.33.37%20PM.jpeg"
        imageAlt="Founders at Goko Hostel"
      />

      <section className="py-16 md:py-24">
        <Container>
          <h2 className="font-display text-display-md font-bold text-brand-green">
            {storyBegin.title}
          </h2>
          <div className="mt-8 max-w-3xl space-y-5 text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
            {storyBegin.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-brand-mist bg-white py-16 md:py-24">
        <Container>
          <h2 className="text-center font-display text-display-md font-bold text-brand-green">
            Meet the founders
          </h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {founders.map((f, i) => (
              <Reveal key={f.name} delay={i * 0.05}>
                <article className="overflow-hidden rounded-3xl border border-brand-mist bg-brand-sand shadow-soft">
                  <div className="relative aspect-[4/5]">
                    <Image
                      src={f.image}
                      alt={f.name}
                      fill
                      className="object-cover"
                      sizes="(max-width:1024px) 50vw, 25vw"
                    />
                  </div>
                  <div className="p-5">
                    <h3 className="font-display text-lg font-bold text-brand-green-dark">
                      {f.name}
                    </h3>
                    <p className="text-sm font-semibold text-brand-red">{f.role}</p>
                    <p className="mt-3 text-sm leading-relaxed text-brand-green-dark/85">
                      {f.bio}
                    </p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-16 md:py-20">
        <Container>
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl font-bold text-brand-green">
                Team leads
              </h2>
              <ul className="mt-6 space-y-3">
                {storyTeamLeads.map((m) => (
                  <li
                    key={m.name}
                    className="rounded-2xl bg-brand-mist px-5 py-4"
                  >
                    <p className="font-display font-semibold text-brand-green-dark">
                      {m.name}
                    </p>
                    <p className="text-sm text-brand-green-dark/80">{m.role}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-brand-green">
                Staff & operations
              </h2>
              <ul className="mt-6 space-y-2 text-brand-green-dark/90">
                {storyStaff.map((m) => (
                  <li key={m.name}>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-brand-green/80"> — {m.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      <section className="border-t border-brand-mist bg-white py-16 md:py-24">
        <Container>
          <h2 className="text-center font-display text-display-md font-bold text-brand-green">
            What we believe
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            {storyValues.map((v, i) => (
              <Reveal key={v.title} delay={i * 0.05}>
                <div className="rounded-3xl border border-brand-mist p-6 shadow-soft">
                  <div className="text-3xl" aria-hidden>
                    {v.icon}
                  </div>
                  <h3 className="mt-4 font-display text-xl font-bold text-brand-green-dark">
                    {v.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-brand-green-dark/85 md:text-base">
                    {v.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
