"use client";

import { useCallback, useEffect, useState } from "react";
import { StayRoomCard } from "@/components/sections/CardWithModal";
import { ImageCarousel } from "@/components/media/ImageCarousel";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { stayRoomSummaries } from "@/content/stay";
import { stayGalleryById } from "@/lib/stayGallery";
import type { PublicAccommodationContent } from "@/lib/accommodationContent";

type StayCard = { room: { id?: string; name: string; description: string; features: readonly string[] }; images: readonly string[] };
const fallbackRooms: StayCard[] = stayRoomSummaries.map((room) => ({ room, images: stayGalleryById[room.id] || [] }));

export function StayRoomsLive() {
  const [rooms, setRooms] = useState<StayCard[]>(fallbackRooms);
  const [property, setProperty] = useState<PublicAccommodationContent["property"] | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const loadRooms = useCallback(() => {
    let cancelled = false;
    setRefreshFailed(false);
    fetch("/api/site?page=stay").then((response) => response.ok ? response.json() : null).then((data: PublicAccommodationContent | null) => {
      if (cancelled || !data?.rooms?.length) return;
      const live = data.rooms.map((room) => ({
        room: { name: room.publicName, description: room.description || "Comfortable hostel accommodation with Goko's shared facilities.", features: room.amenities },
        images: [...room.roomPhotos, ...room.washroomPhotos],
      }));
      if (live.length) setRooms(live);
      if (data.property) setProperty(data.property);
    }).catch(() => { if (!cancelled) setRefreshFailed(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => loadRooms(), [loadRooms]);
  const propertyPhotos = property ? [...property.exteriorPhotos, ...property.commonPhotos, ...property.washroomPhotos] : [];
  return <>
    <section className="py-16 md:py-24"><Container><SectionHeader title="Our rooms" /><p className="mx-auto mt-3 max-w-2xl text-center text-brand-green-dark/85">Swipe through real room and washroom photos, then book directly with Goko.</p>{refreshFailed && <div className="mx-auto mt-5 max-w-2xl rounded-xl bg-brand-sand px-4 py-3 text-center text-sm text-brand-green-dark" role="status">Showing saved room details while live updates reconnect. <button type="button" className="min-h-11 font-semibold underline underline-offset-2" onClick={loadRooms}>Retry</button></div>}<div className="mt-14 space-y-16">{rooms.map(({ room, images }, index) => <StayRoomCard key={`${room.name}-${index}`} room={room} images={images} />)}</div></Container></section>
    {propertyPhotos.length > 0 && <section className="pb-16 md:pb-24"><Container><SectionHeader title="Around the property" /><div className="mx-auto mt-10 max-w-4xl"><ImageCarousel images={propertyPhotos} controls="overlay" alt="Goko Hostel property" /></div></Container></section>}
  </>;
}
