import Image from "next/image";
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
  type PlacePhoto,
} from "@/content/thingsToDo";
import { cn } from "@/lib/utils";
import { buildMetadata } from "@/lib/seo";

function PlacePhotoGrid({ photos }: { photos: PlacePhoto[] }) {
  if (photos.length === 0) return null;
  const cols =
    photos.length >= 3 ? "sm:grid-cols-3" : photos.length === 2 ? "sm:grid-cols-2" : "grid-cols-1";

  return (
    <div className={cn("mt-4 grid grid-cols-1 gap-2", cols)}>
      {photos.map((p) => (
        <div
          key={p.src}
          className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-brand-mist"
        >
          <Image
            src={p.src}
            alt={p.alt}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 280px"
          />
        </div>
      ))}
    </div>
  );
}

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
        image="/images/things-to-do/om-beach.jpg"
        imageAlt="Gokarna coastline"
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
                  <PlacePhotoGrid photos={b.photos} />
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

      <section className="border-t border-brand-mist bg-white py-16 md:py-24">
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
                  <PlacePhotoGrid photos={t.photos} />
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
                  <PlacePhotoGrid photos={d.photos} />
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
