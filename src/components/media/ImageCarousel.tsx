"use client";

import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ImageCarouselProps = {
  images: string[];
  alt: string;
  className?: string;
  /** `overlay` places prev/next on the image; `below` keeps the legacy controls under the image. */
  controls?: "below" | "overlay";
};

export function ImageCarousel({ images, alt, className, controls = "below" }: ImageCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
  const [selected, setSelected] = useState(0);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelected(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  if (!images.length) return null;

  const multi = images.length > 1;
  const overlay = controls === "overlay";

  return (
    <div className={cn("w-full", className)}>
      <div className={cn("overflow-hidden rounded-2xl shadow-card", overlay && "relative")} ref={emblaRef}>
        <div className="flex touch-pan-y">
          {images.map((src) => (
            <div className="min-w-0 flex-[0_0_100%] translate-x-0" key={src}>
              <Image
                src={src}
                alt={alt}
                width={1200}
                height={800}
                className="h-[220px] w-full object-cover sm:h-[280px] md:h-[380px]"
                sizes="(max-width:768px) 100vw, 50vw"
              />
            </div>
          ))}
        </div>

        {overlay && multi && (
          <>
            <button
              type="button"
              className="absolute left-2 top-1/2 flex h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:goko-focus"
              onClick={scrollPrev}
              aria-label="Previous image"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              className="absolute right-2 top-1/2 flex h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 focus-visible:goko-focus"
              onClick={scrollNext}
              aria-label="Next image"
            >
              <ChevronRight className="size-5" />
            </button>
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5" role="tablist" aria-label="Slide indicators">
              {images.map((_, i) => (
                <button
                  key={`dot-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={i === selected}
                  aria-label={`Go to slide ${i + 1}`}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    i === selected ? "w-5 bg-white" : "w-2 bg-white/50 hover:bg-white/75",
                  )}
                  onClick={() => emblaApi?.scrollTo(i)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {!overlay && multi && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            className="flex h-11 min-w-11 items-center justify-center rounded-full border-2 border-brand-green bg-white text-lg font-semibold text-brand-green transition-colors hover:bg-brand-green hover:text-white focus-visible:goko-focus"
            onClick={scrollPrev}
            aria-label="Previous image"
          >
            ‹
          </button>
          <div className="flex gap-1.5" role="tablist" aria-label="Slide indicators">
            {images.map((_, i) => (
              <button
                key={`dot-${i}`}
                type="button"
                role="tab"
                aria-selected={i === selected}
                aria-label={`Go to slide ${i + 1}`}
                className={cn(
                  "h-2.5 w-2.5 rounded-full transition-colors",
                  i === selected ? "bg-brand-red" : "bg-brand-green/25",
                )}
                onClick={() => emblaApi?.scrollTo(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className="flex h-11 min-w-11 items-center justify-center rounded-full border-2 border-brand-green bg-white text-lg font-semibold text-brand-green transition-colors hover:bg-brand-green hover:text-white focus-visible:goko-focus"
            onClick={scrollNext}
            aria-label="Next image"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
