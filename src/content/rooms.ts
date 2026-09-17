/** Shared room marketing copy and gallery paths for /stay, /book, and homepage tabs. */

export const mixedDormImages = [
  "/images/stay/mixed-dorm-12bed/mixed-dorm1.jpg",
  "/images/stay/mixed-dorm-12bed/mixed-dorm2.jpg",
  "/images/stay/mixed-dorm-12bed/mixed-dorm3.jpg",
] as const;

export const femaleDormImages = [
  "/images/stay/female-dorm-6bed/mixed-dorm1.jpg",
  "/images/stay/female-dorm-6bed/mixed-dorm2.jpg",
  "/images/stay/female-dorm-6bed/mixed-dorm3.jpg",
] as const;

export const luxuryDormImages = [
  "/images/stay/luxury-dorm-8bed/mixed-dorm1.jpg",
  "/images/stay/luxury-dorm-8bed/mixed-dorm2.jpg",
  "/images/stay/luxury-dorm-8bed/mixed-dorm3.jpg",
] as const;

export type GokoStayRoom = {
  id: string;
  name: string;
  description: string;
  features: readonly string[];
  images: readonly string[];
};

/** Marketing room cards on /stay; dorm names in book resolve to the same image sets. */
export const gokoStayRooms: readonly GokoStayRoom[] = [
  {
    id: "mixed-dorm-12bed",
    name: "12 bed mixed dorm",
    description:
      "Spacious mixed dormitory with two shared bathrooms. Lower beds are doubles; upper beds are singles — ideal for solo travellers and couples.",
    features: [
      "12 beds",
      "2 shared bathrooms",
      "Private lockers",
      "Charging points",
      "Fan at each bed (no AC)",
    ],
    images: mixedDormImages,
  },
  {
    id: "female-dorm-6bed",
    name: "Female dorm",
    description:
      "Safe, clean female-only dorm with ensuite washroom — a peaceful space built for women travellers.",
    features: [
      "6 beds",
      "Ensuite washroom",
      "Private lockers",
      "Charging points",
      "Fan at each bed (no AC)",
    ],
    images: femaleDormImages,
  },
  {
    id: "luxury-dorm-8bed",
    name: "8 bed luxury mixed dorm",
    description:
      "Premium mixed dorm with curtained beds, lockers, reading lights, and our open roof washroom.",
    features: [
      "8 beds",
      "Open roof washroom",
      "Private lockers",
      "Charging points",
      "Fan at each bed (no AC)",
    ],
    images: luxuryDormImages,
  },
  {
    id: "double-bed-dorm",
    name: "Double bed dorm",
    description:
      "Whole double beds in a shared dorm. Book one side for a solo guest or the full double when travelling together.",
    features: [
      "Whole double beds",
      "Private lockers",
      "Charging points",
      "Fan at each bed (no AC)",
      "Shared bathrooms",
    ],
    images: mixedDormImages,
  },
];

/** Map a PMS dorm name from guest booking to the representative photo set. */
export function resolveRoomGallery(dormName: string): readonly string[] {
  const name = dormName.toLowerCase();
  if (name.includes("female")) return femaleDormImages;
  if (name.includes("luxury") || name.includes("shiva")) return luxuryDormImages;
  return mixedDormImages;
}
