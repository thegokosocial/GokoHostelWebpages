import { HeroBackdrop } from "@/components/media/HeroBackdrop";
import { cn } from "@/lib/utils";
import { heroLoopVideo, type HeroLoopVideo } from "@/lib/site";

type PageRibbonProps = {
  title: string;
  subtitle?: string;
  /** Used when video is disabled or for `prefers-reduced-motion` (per-page artwork). */
  image: string;
  imageAlt?: string;
  className?: string;
  /** Set false to use only `image` (no loop). Defaults to legacy Webflow yard clip. */
  heroVideo?: HeroLoopVideo | null;
};

export function PageRibbon({
  title,
  subtitle,
  image,
  imageAlt = "",
  className,
  heroVideo = heroLoopVideo,
}: PageRibbonProps) {
  return (
    <section
      className={cn(
        "relative flex min-h-[42vh] items-center justify-center overflow-hidden md:min-h-[48vh]",
        className
      )}
    >
      <div className="absolute inset-0 z-0 overflow-hidden">
        <HeroBackdrop
          image={image}
          imageAlt={imageAlt || title}
          video={heroVideo}
          priority
        />
      </div>
      <div
        className="absolute inset-0 z-[1] bg-gradient-to-t from-brand-green-dark/90 via-brand-green/50 to-brand-green-dark/30"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-24 top-1/3 z-[1] h-64 w-64 rounded-full bg-brand-red/25 blur-3xl motion-safe:opacity-80"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-1/4 z-[1] h-48 w-48 rounded-full bg-white/15 blur-2xl"
        aria-hidden
      />
      <div className="relative z-[2] max-w-4xl px-4 py-16 text-center">
        <h1 className="font-display text-display-lg font-bold text-white [text-shadow:2px_2px_14px_rgba(0,0,0,0.35)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-white/95 md:text-xl">
            {subtitle}
          </p>
        ) : null}
      </div>
    </section>
  );
}
