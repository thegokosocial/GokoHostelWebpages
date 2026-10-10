"use client";

import { useEffect, useState } from "react";
import { homeRooms, type RoomTab } from "@/content/home";
import { ImageCarousel } from "@/components/media/ImageCarousel";
import { BookNowButton } from "@/components/booking/BookNowButton";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/motion/Reveal";
import type { PublicAccommodationContent } from "@/lib/accommodationContent";

const accentRing: Record<RoomTab["accent"], string> = {
  blue: "ring-brand-green/25 data-[active=true]:bg-brand-sand",
  green: "ring-brand-green/40 data-[active=true]:bg-brand-green/[0.07]",
  orange: "ring-brand-red/30 data-[active=true]:bg-brand-sand",
};

export function RoomTabs() {
  const [rooms, setRooms] = useState<RoomTab[]>(homeRooms);
  const [activeId, setActiveId] = useState(homeRooms[0].id);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/site?page=stay")
      .then((response) => response.ok ? response.json() : null)
      .then((data: PublicAccommodationContent | null) => {
        if (cancelled || !data?.rooms?.length) return;
        const live = data.rooms.map((room, index) => ({
          id: `live-${index}`,
          name: room.publicName,
          tagline: room.amenities.slice(0, 2).join(" · ") || "Stay at Goko",
          description: room.description || "Comfortable hostel accommodation with Goko's shared facilities.",
          images: [...room.roomPhotos, ...room.washroomPhotos],
          accent: (["blue", "green", "orange"] as const)[index % 3],
        }));
        setRooms(live);
        setActiveId(live[0].id);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const room = rooms.find((r) => r.id === activeId) ?? rooms[0];

  return (
    <div>
      <div
        className="mb-8 flex flex-wrap justify-center gap-2 md:gap-3"
        role="tablist"
        aria-label="Room types"
      >
        {rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={r.id === activeId}
            id={`tab-${r.id}`}
            aria-controls={`panel-${r.id}`}
            data-active={r.id === activeId}
            className={cn(
              "rounded-full border-2 border-transparent px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-brand-green-dark ring-2 ring-transparent transition-all min-h-11",
              accentRing[r.accent],
              r.id === activeId && "border-brand-green shadow-soft"
            )}
            onClick={() => setActiveId(r.id)}
          >
            {r.name}
          </button>
        ))}
      </div>
      <Reveal>
        <div
          role="tabpanel"
          id={`panel-${room.id}`}
          aria-labelledby={`tab-${room.id}`}
        >
          <ImageCarousel images={room.images} alt={room.name} />
          <div className="mt-8 text-center md:mt-10">
            <p className="font-display text-sm font-semibold uppercase tracking-widest text-brand-red">
              {room.tagline}
            </p>
            <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-brand-green-dark/90 md:text-lg">
              {room.description}
            </p>
            <div className="mt-8 flex justify-center">
              <BookNowButton>Book this room type</BookNowButton>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
