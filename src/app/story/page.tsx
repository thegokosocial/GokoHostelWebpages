import Image from "next/image";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import {
  founders,
  storyBegin,
  storyFoundersGroupPhoto,
  storyHero,
  storyTeamAlso,
  storyTeamPhotos,
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

      <section className="relative py-16 md:py-24">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
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

          <Reveal delay={0.12}>
            <figure className="mt-14 overflow-hidden rounded-3xl border border-brand-mist bg-gradient-to-b from-brand-sand via-brand-sand to-brand-mist/25 shadow-soft">
              <div className="flex justify-center px-2 py-6 sm:px-4 sm:py-8 md:py-10">
                <Image
                  src={storyFoundersGroupPhoto.image}
                  alt={storyFoundersGroupPhoto.imageAlt}
                  width={storyFoundersGroupPhoto.width}
                  height={storyFoundersGroupPhoto.height}
                  className="h-auto w-full max-w-md object-contain sm:max-w-lg md:max-w-xl lg:max-w-2xl"
                  sizes="(max-width:640px) 100vw, (max-width:1024px) 80vw, 672px"
                  priority={false}
                />
              </div>
              <figcaption className="border-t border-brand-mist/80 bg-white px-5 py-4 text-center text-sm font-medium text-brand-green-dark/85">
                {storyFoundersGroupPhoto.caption}
              </figcaption>
            </figure>
          </Reveal>
        </Container>
      </section>

      <section className="py-16 md:py-20">
        <Container>
          <h2 className="text-center font-display text-display-md font-bold text-brand-green">
            Team & operations
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-base text-brand-green-dark/85">
            The people who keep Goko running day to day — say hi when you see us by the mural.
          </p>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {storyTeamPhotos.map((m, i) => (
              <Reveal key={m.image} delay={i * 0.05}>
                <article className="overflow-hidden rounded-3xl border border-brand-mist bg-white shadow-soft">
                  <div className="relative aspect-[4/5]">
                    <Image
                      src={m.image}
                      alt={m.imageAlt}
                      fill
                      className="object-cover object-top"
                      sizes="(max-width:1024px) 50vw, 20vw"
                    />
                  </div>
                  <div className="p-4">
                    <h3 className="font-display text-base font-bold text-brand-green-dark md:text-lg">
                      {m.name}
                    </h3>
                    <p className="text-sm font-semibold text-brand-red">{m.role}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
          {storyTeamAlso.length > 0 ? (
            <ul className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-center text-sm text-brand-green-dark/80">
              {storyTeamAlso.map((x) => (
                <li key={x.name}>
                  <span className="font-medium text-brand-green-dark">{x.name}</span>
                  <span className="text-brand-green/75"> — {x.role}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Container>
      </section>

      <section className="relative py-16 md:py-24">
        <div className="goko-divider-fade mx-auto mb-12 max-w-4xl" aria-hidden />
        <Container>
          <h2 className="text-center font-display text-display-md font-bold text-brand-green">
            What we believe
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            {storyValues.map((v, i) => (
              <Reveal key={v.title} delay={i * 0.05} className="h-full">
                <div className="flex h-full flex-col rounded-3xl border border-brand-mist p-6 shadow-soft">
                  <div className="text-3xl" aria-hidden>
                    {v.icon}
                  </div>
                  <h3 className="mt-4 font-display text-xl font-bold text-brand-green-dark">
                    {v.title}
                  </h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-brand-green-dark/85 md:text-base">
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
