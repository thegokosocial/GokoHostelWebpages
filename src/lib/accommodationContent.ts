import { z } from "zod";
import { sanitizeSiteImageUrl } from "@/lib/mediaKeys";
import { resolveRoomGallery } from "@/content/rooms";
import { getAccommodationContentRows } from "@/db/siteQueries";

export const ACCOMMODATION_GALLERY_MAX = 8;
const textList = z.array(z.string().trim().min(1).max(80)).max(12);
const photoList = z.array(z.string()).max(ACCOMMODATION_GALLERY_MAX);

export const roomContentInputSchema = z.object({
  dormId: z.number().int().positive(),
  publicName: z.string().trim().max(100),
  description: z.string().trim().max(1000),
  amenities: textList,
  roomPhotos: photoList,
  washroomPhotos: photoList,
  revision: z.string().max(100),
}).strict();

export const propertyContentInputSchema = z.object({
  exteriorPhotos: photoList,
  commonPhotos: photoList,
  washroomPhotos: photoList,
  revision: z.string().max(100),
}).strict();

export type AccommodationRoomContent = {
  dormId: number;
  operationalName: string;
  publicName: string;
  description: string;
  amenities: string[];
  roomPhotos: string[];
  washroomPhotos: string[];
  revision: string;
  mapped: boolean;
};

export type AccommodationPropertyContent = {
  exteriorPhotos: string[];
  commonPhotos: string[];
  washroomPhotos: string[];
  revision: string;
};

export type PublicAccommodationRoom = Pick<AccommodationRoomContent,
  "publicName" | "description" | "amenities" | "roomPhotos" | "washroomPhotos">;
export type PublicAccommodationContent = {
  rooms: PublicAccommodationRoom[];
  property: Omit<AccommodationPropertyContent, "revision">;
};

/** Strip operational names, row IDs/revisions and unmapped inventory before public delivery. */
export function publicAccommodationContent(data: {
  rooms: AccommodationRoomContent[];
  property: AccommodationPropertyContent;
}): PublicAccommodationContent {
  return {
    rooms: data.rooms.filter((room) => room.mapped).map((room) => ({
      publicName: room.publicName,
      description: room.description,
      amenities: room.amenities,
      roomPhotos: room.roomPhotos,
      washroomPhotos: room.washroomPhotos,
    })),
    property: {
      exteriorPhotos: data.property.exteriorPhotos,
      commonPhotos: data.property.commonPhotos,
      washroomPhotos: data.property.washroomPhotos,
    },
  };
}

export function safeStringList(raw: string | null | undefined, max = 12): string[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, max)
      : [];
  } catch { return []; }
}

export function sanitizePhotoList(input: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of input) {
    const url = sanitizeSiteImageUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url); output.push(url);
    if (output.length >= ACCOMMODATION_GALLERY_MAX) break;
  }
  return output;
}

export function legacyRoomPhotos(dormName: string): string[] {
  return [...resolveRoomGallery(dormName)].slice(0, ACCOMMODATION_GALLERY_MAX);
}

export async function loadAccommodationContent(): Promise<{
  rooms: AccommodationRoomContent[];
  property: AccommodationPropertyContent;
}> {
  const data = await getAccommodationContentRows();
  const byDorm = new Map(data.content.map((row) => [row.dormId, row]));
  const mapped = new Set(data.mappings.filter((row) => row.isActive === 1).map((row) => row.dormId));
  const rooms = data.rooms.filter((room) => !room.deletedAt).map((room) => {
    const row = byDorm.get(room.id);
    return {
      dormId: room.id,
      operationalName: room.name,
      publicName: row?.publicName || room.name,
      description: row?.description || "",
      amenities: safeStringList(row?.amenities),
      roomPhotos: row ? sanitizePhotoList(safeStringList(row.roomPhotos, ACCOMMODATION_GALLERY_MAX)) : legacyRoomPhotos(room.name),
      washroomPhotos: row ? sanitizePhotoList(safeStringList(row.washroomPhotos, ACCOMMODATION_GALLERY_MAX)) : [],
      revision: row?.updatedAt || "missing",
      mapped: mapped.has(room.id),
    } satisfies AccommodationRoomContent;
  }).sort((a, b) => a.publicName.localeCompare(b.publicName));
  const property = data.property;
  return {
    rooms,
    property: {
      exteriorPhotos: sanitizePhotoList(safeStringList(property?.exteriorPhotos, ACCOMMODATION_GALLERY_MAX)),
      commonPhotos: sanitizePhotoList(safeStringList(property?.commonPhotos, ACCOMMODATION_GALLERY_MAX)),
      washroomPhotos: sanitizePhotoList(safeStringList(property?.washroomPhotos, ACCOMMODATION_GALLERY_MAX)),
      revision: property ? property.updatedAt : "missing",
    },
  };
}
