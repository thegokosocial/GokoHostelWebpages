"use client";

import useEmblaCarousel from "embla-carousel-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ImageCarouselProps = {
  images: string[];
  alt: string;
  className?: string;
};

export function ImageCarousel({ images, alt, className }: ImageCarouselProps) {
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

  return (
    <div className={cn("w-full", className)}>
      <div className="overflow-hidden rounded-2xl shadow-card" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {images.map((src) => (
            <div
              className="min-w-0 flex-[0_0_100%] translate-x-0"
              key={src}
            >
              <Image
                src={src}
                alt={alt}
                width={1200}
                height={800}
                className="h-[220px] w-full object-cover sm:h-[280px] md:h-[380px]"
              />
            </div>
          ))}
        </div>
      </div>
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
                i === selected ? "bg-brand-red" : "bg-brand-green/25"
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
    </div>
  );
}
