"use client";

import { useState } from "react";
import Image from "next/image";
import useEmblaCarousel from "embla-carousel-react";
import { useCallback, useEffect } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookNowButton } from "@/components/booking/BookNowButton";
import { cn } from "@/lib/utils";
import type { EventItem } from "@/content/events";
import type { CommunitySpace } from "@/content/community";

function PhotoCarousel({ photos, alt }: { photos: string[]; alt: string }) {
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

  if (photos.length === 0) return null;

  return (
    <div className="relative">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {photos.map((src) => (
            <div className="min-w-0 flex-[0_0_100%]" key={src}>
              <Image
                src={src}
                alt={alt}
                width={1200}
                height={800}
                className="h-[200px] w-full object-cover sm:h-[280px] md:h-[360px]"
              />
            </div>
          ))}
        </div>
      </div>

      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={scrollPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
            aria-label="Previous photo"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={scrollNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
            aria-label="Next photo"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {photos.map((_, i) => (
              <button
                key={`dot-${i}`}
                type="button"
                aria-label={`Go to photo ${i + 1}`}
                className={cn(
                  "h-2 w-2 rounded-full transition-all",
                  i === selected
                    ? "w-5 bg-white"
                    : "bg-white/50 hover:bg-white/75"
                )}
                onClick={() => emblaApi?.scrollTo(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const fallbackImg = "/images/IMG_3345.jpg";

export { EventCard as PastEventCard };

export function EventCard({ ev }: { ev: EventItem }) {
  const [open, setOpen] = useState(false);
  const photos = ev.photos?.length ? ev.photos : [ev.cover ?? fallbackImg];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={
          <article className="group/event cursor-pointer overflow-hidden rounded-3xl border border-brand-mist bg-white shadow-card transition-all duration-300 hover:shadow-lift hover:-translate-y-1" />
        }
      >
        <div className="relative aspect-[16/10] overflow-hidden">
          <Image
            src={ev.cover ?? fallbackImg}
            alt=""
            fill
            className="object-cover transition-transform duration-500 group-hover/event:scale-105"
            sizes="(max-width:768px) 100vw, 50vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover/event:opacity-100" />
          <div className="absolute bottom-3 right-3 flex h-8 items-center gap-1.5 rounded-full bg-black/50 px-3 text-xs font-medium text-white backdrop-blur-sm opacity-0 transition-opacity duration-300 group-hover/event:opacity-100">
            View event
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="p-6">
          <time className="text-sm font-semibold uppercase tracking-wide text-brand-red">
            {ev.date}
          </time>
          <h3 className="mt-2 font-display text-xl font-bold text-brand-green-dark">
            {ev.title}
          </h3>
          <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-brand-green-dark/85 md:text-base">
            {ev.description}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {ev.tags.map((t) => (
              <li
                key={t}
                className="rounded-full bg-brand-sand px-3 py-1 text-xs font-medium text-brand-green"
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed inset-x-4 top-1/2 z-50 mx-auto max-h-[90vh] max-w-2xl -translate-y-1/2 overflow-hidden overflow-y-auto rounded-3xl bg-white shadow-lift-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:inset-x-auto sm:left-1/2 sm:w-full sm:-translate-x-1/2">
          <div className="relative">
            <PhotoCarousel photos={photos} alt={ev.title} />
            <DialogPrimitive.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-3 top-3 z-10 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60"
                />
              }
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div className="p-6 md:p-8">
            <time className="text-sm font-semibold uppercase tracking-wide text-brand-red">
              {ev.date}
            </time>
            <DialogPrimitive.Title className="mt-2 font-display text-2xl font-bold text-brand-green-dark md:text-3xl">
              {ev.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-4 text-base leading-relaxed text-brand-green-dark/85 md:text-lg">
              {ev.description}
            </DialogPrimitive.Description>
            <ul className="mt-6 flex flex-wrap gap-2">
              {ev.tags.map((t) => (
                <li
                  key={t}
                  className="rounded-full bg-brand-sand px-3.5 py-1.5 text-sm font-medium text-brand-green"
                >
                  {t}
                </li>
              ))}
            </ul>
            {!ev.past && (
              <div className="mt-8 flex items-center gap-3 border-t border-brand-mist pt-6">
                <BookNowButton>Book your stay</BookNowButton>
                <p className="text-sm text-brand-green-dark/60">
                  Be here for this event
                </p>
              </div>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function CommunitySpaceCard({ space }: { space: CommunitySpace }) {
  const [open, setOpen] = useState(false);
  const photos = space.photos.length ? space.photos : [space.image];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={
          <article className="group/space cursor-pointer overflow-hidden rounded-3xl border border-brand-mist bg-brand-sand shadow-soft transition-all duration-300 hover:shadow-lift hover:-translate-y-1" />
        }
      >
        <div className="relative aspect-[16/10] overflow-hidden">
          <Image
            src={space.image}
            alt={space.title}
            fill
            className="object-cover transition-transform duration-500 group-hover/space:scale-105"
            sizes="(max-width:768px) 100vw, 50vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover/space:opacity-100" />
          <div className="absolute bottom-3 right-3 flex h-8 items-center gap-1.5 rounded-full bg-black/50 px-3 text-xs font-medium text-white backdrop-blur-sm opacity-0 transition-opacity duration-300 group-hover/space:opacity-100">
            View space
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="p-6">
          <div className="text-2xl" aria-hidden>
            {space.emoji}
          </div>
          <h3 className="mt-2 font-display text-xl font-bold text-brand-green">
            {space.title}
          </h3>
          <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-brand-green-dark/90 md:text-base">
            {space.description}
          </p>
        </div>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed inset-x-4 top-1/2 z-50 mx-auto max-h-[90vh] max-w-2xl -translate-y-1/2 overflow-hidden overflow-y-auto rounded-3xl bg-white shadow-lift-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:inset-x-auto sm:left-1/2 sm:w-full sm:-translate-x-1/2">
          <div className="relative">
            <PhotoCarousel photos={photos} alt={space.title} />
            <DialogPrimitive.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-3 top-3 z-10 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60"
                />
              }
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div className="p-6 md:p-8">
            <div className="text-3xl" aria-hidden>
              {space.emoji}
            </div>
            <DialogPrimitive.Title className="mt-2 font-display text-2xl font-bold text-brand-green md:text-3xl">
              {space.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-4 text-base leading-relaxed text-brand-green-dark/85 md:text-lg">
              {space.description}
            </DialogPrimitive.Description>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type StayRoom = {
  name: string;
  description: string;
  features: readonly string[];
};

export function StayRoomCard({
  room,
  images,
}: {
  room: StayRoom;
  images: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const photos = images.length ? [...images] : [fallbackImg];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={
          <div className="group/room cursor-pointer" />
        }
      >
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div className="relative overflow-hidden rounded-2xl shadow-card">
            <div className="flex touch-pan-y">
              <Image
                src={photos[0]}
                alt={room.name}
                width={1200}
                height={800}
                className="h-[220px] w-full object-cover transition-transform duration-500 group-hover/room:scale-105 sm:h-[280px] md:h-[380px]"
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover/room:opacity-100" />
            <div className="absolute bottom-3 right-3 flex h-8 items-center gap-1.5 rounded-full bg-black/50 px-3 text-xs font-medium text-white backdrop-blur-sm opacity-0 transition-opacity duration-300 group-hover/room:opacity-100">
              View all photos
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </div>
          </div>
          <div>
            <h3 className="font-display text-2xl font-bold capitalize text-brand-green-dark transition-colors group-hover/room:text-brand-green md:text-3xl">
              {room.name}
            </h3>
            <p className="mt-4 text-base leading-relaxed text-brand-green-dark/90">
              {room.description}
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {room.features.map((f) => (
                <li
                  key={f}
                  className="rounded-full bg-brand-mist px-3 py-1.5 text-sm text-brand-green-dark"
                >
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed inset-x-4 top-1/2 z-50 mx-auto max-h-[90vh] max-w-2xl -translate-y-1/2 overflow-hidden overflow-y-auto rounded-3xl bg-white shadow-lift-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:inset-x-auto sm:left-1/2 sm:w-full sm:-translate-x-1/2">
          <div className="relative">
            <PhotoCarousel photos={photos} alt={room.name} />
            <DialogPrimitive.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-3 top-3 z-10 rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/60"
                />
              }
            >
              <XIcon className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          <div className="p-6 md:p-8">
            <DialogPrimitive.Title className="font-display text-2xl font-bold capitalize text-brand-green-dark md:text-3xl">
              {room.name}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-4 text-base leading-relaxed text-brand-green-dark/85 md:text-lg">
              {room.description}
            </DialogPrimitive.Description>
            <ul className="mt-6 flex flex-wrap gap-2">
              {room.features.map((f) => (
                <li
                  key={f}
                  className="rounded-full bg-brand-sand px-3.5 py-1.5 text-sm font-medium text-brand-green"
                >
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex items-center gap-3 border-t border-brand-mist pt-6">
              <BookNowButton>Book this room</BookNowButton>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
