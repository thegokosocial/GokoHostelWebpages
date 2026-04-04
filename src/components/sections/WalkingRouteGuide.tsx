"use client";

import Image from "next/image";
import { MapPin, ImageIcon } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils";
import type { WalkingRouteStep, WalkingRouteVideo } from "@/types/walking-route";

type WalkingRouteGuideProps = {
  title: string;
  intro: string;
  steps: WalkingRouteStep[];
  tips: string[];
  video?: WalkingRouteVideo;
};

export function WalkingRouteGuide({
  title,
  intro,
  steps,
  tips,
  video,
}: WalkingRouteGuideProps) {
  return (
    <div>
      <h2 className="font-display text-display-md font-bold text-brand-green">
        {title}
      </h2>
      <p className="mt-4 max-w-3xl text-lg leading-relaxed text-brand-green-dark/90">
        {intro}
      </p>

      <div className="relative mt-10 md:mt-12">
        <div
          className="pointer-events-none absolute left-[1.125rem] top-6 bottom-6 w-px bg-gradient-to-b from-brand-green/25 via-brand-green/50 to-brand-red/40 md:left-1/2 md:-translate-x-1/2"
          aria-hidden
        />

        <ol className="relative space-y-12 md:space-y-20">
          {steps.map((step, i) => {
            const n = i + 1;
            const isEven = i % 2 === 0;
            const hasImage = Boolean(step.image?.trim());
            const mediaSrc = step.image?.trim() ?? "";
            const isAnimatedGif = mediaSrc.toLowerCase().endsWith(".gif");

            return (
              <Reveal key={`${step.title}-${i}`} delay={i * 0.06}>
                <li
                  className={cn(
                    "relative grid gap-8 md:grid-cols-2 md:gap-12 md:gap-y-8",
                    !isEven && "md:[&>div:first-child]:order-2"
                  )}
                >
                  <div
                    className={cn(
                      "flex flex-col md:items-end md:text-right",
                      !isEven && "md:items-start md:text-left"
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-start gap-4 md:max-w-md",
                        !isEven && "md:flex-row-reverse"
                      )}
                    >
                      <span
                        className="relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-bold text-white shadow-soft ring-4 ring-brand-sand"
                        aria-hidden
                      >
                        {n}
                      </span>
                      <div className="min-w-0 pt-0.5">
                        {step.badge ? (
                          <p className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-brand-mist px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-green-dark/80">
                            <MapPin className="size-3" aria-hidden />
                            {step.badge}
                          </p>
                        ) : null}
                        <h3 className="font-display text-xl font-bold text-brand-green md:text-2xl">
                          {step.title}
                        </h3>
                        <p className="mt-3 text-sm leading-relaxed text-brand-green-dark/88 md:text-base">
                          {step.text}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "md:flex md:items-center",
                      isEven ? "md:justify-start" : "md:justify-end"
                    )}
                  >
                    <figure
                      className={cn(
                        "group relative w-full overflow-hidden rounded-2xl border border-brand-mist/80 bg-white shadow-card ring-1 ring-brand-green/5 transition-shadow duration-300 hover:shadow-lift md:max-w-2xl",
                        !hasImage && "border-dashed"
                      )}
                    >
                      <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-brand-sand via-white to-brand-mist/30">
                        {hasImage ? (
                          isAnimatedGif ? (
                            // Native <img>: next/image wrappers often break aspect-ratio boxes for looping GIFs.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mediaSrc}
                              alt={step.imageAlt ?? step.title}
                              className="absolute inset-0 h-full w-full object-cover object-center transition duration-500 motion-safe:group-hover:scale-[1.02]"
                              loading={i === 0 ? "eager" : "lazy"}
                              decoding="async"
                            />
                          ) : (
                            <Image
                              src={mediaSrc}
                              alt={step.imageAlt ?? step.title}
                              fill
                              priority={i === 0}
                              className="object-cover object-center transition duration-500 motion-safe:group-hover:scale-[1.02]"
                              sizes="(max-width: 768px) 100vw, min(672px, 50vw)"
                            />
                          )
                        ) : (
                          <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-brand-green-dark/45">
                            <ImageIcon className="size-10 stroke-[1.25]" aria-hidden />
                            <span className="text-xs font-medium uppercase tracking-wide">
                              Add your photo in content
                            </span>
                          </div>
                        )}
                      </div>
                    </figure>
                  </div>
                </li>
              </Reveal>
            );
          })}
        </ol>
      </div>

      {video ? (
        <Reveal delay={0.04}>
          <figure className="mt-14 overflow-hidden rounded-2xl border border-brand-mist/80 bg-brand-green-dark shadow-card ring-1 ring-brand-green/10 md:mt-16">
            <div className="border-b border-white/10 bg-brand-green-dark/95 px-4 py-3 md:px-5">
              <p className="font-display text-sm font-semibold text-white md:text-base">
                {video.title}
              </p>
              <p className="mt-1 text-xs text-white/75 md:text-sm">{video.description}</p>
            </div>
            <div className="relative aspect-video bg-black">
              <video
                className="size-full object-contain"
                controls
                playsInline
                preload="metadata"
                aria-label={video.title}
              >
                <source src={video.src} type="video/mp4" />
                Your browser does not support embedded video.{" "}
                <a href={video.src} className="underline">
                  Download the walkthrough
                </a>
                .
              </video>
            </div>
          </figure>
        </Reveal>
      ) : null}

      <ul className="mt-14 space-y-3 rounded-2xl border border-brand-green/15 bg-gradient-to-br from-brand-sand/90 to-white p-6 text-sm text-brand-green-dark shadow-soft md:mt-16 md:p-8 md:text-base">
        {tips.map((t) => (
          <li key={t} className="flex gap-3">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-red" aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
