export type EventItem = {
  date: string;
  title: string;
  description: string;
  tags: string[];
  past?: boolean;
  imageDir?: string;
  cover?: string;
  photos?: string[];
};

export const eventsHero = {
  title: "Events at Goko Hostel",
  subtitle:
    "Join our vibrant community for festivals, celebrations, and unforgettable experiences by the beach in Gokarna!",
  chips: ["🎊 Festivals", "🎵 Live music", "🌊 Beach parties", "🪔 Cultural events"],
};

export const upcomingEvents: EventItem[] = [
  {
    date: "September 2026",
    title: "Ganesha Chaturthi Celebration",
    description:
      "Honor Lord Ganesha with traditional puja, modak making workshop, devotional music, and beach immersion ceremony. Experience authentic Indian spirituality!",
    tags: ["Puja ceremony", "Modak workshop", "Devotional music"],
    cover: "/images/mahabaleshwar_temple.jpg",
    photos: ["/images/mahabaleshwar_temple.jpg"],
  },
  {
    date: "Monthly",
    title: "Full Moon Beach Parties",
    description:
      "Monthly celebration under the full moon! Dance barefoot on the beach with live DJ, bonfire, beach games, and magical moon energy. Every full moon, we celebrate!",
    tags: ["Live DJ", "Bonfire", "Beach games"],
    cover: "/images/IMG_3347.jpg",
    photos: ["/images/IMG_3347.jpg"],
  },
  {
    date: "October 31, 2026",
    title: "Halloween Spooktacular",
    description:
      "Get spooky at Goko! Costume contest, horror movie marathon, pumpkin carving, themed cocktails, and a haunted beach walk. Best costume wins a prize!",
    tags: ["Costume contest", "Pumpkin carving", "Movie marathon"],
    cover: "/images/goko-haloween-2024/IMG_7128.jpg",
    photos: ["/images/goko-haloween-2024/IMG_7128.jpg"],
  },
  {
    date: "December 31, 2026",
    title: "New Year's Eve Beach Party",
    description:
      "Ring in the new year with your Goko family! Countdown on the beach with DJ, fireworks, dancing, and unlimited good vibes. Let's welcome 2027 together!",
    tags: ["Fireworks", "DJ night", "Cocktails"],
    cover: "/images/goko-haloween-2024/IMG_7257.jpg",
    photos: ["/images/goko-haloween-2024/IMG_7257.jpg"],
  },
];

export const eventsPastCta = {
  title: "Don't miss out!",
  body:
    "Want to join our next celebration? Book your stay at Goko Hostel and be part of our amazing community events!",
};

export const pastEvents: EventItem[] = [
  {
    date: "March 8, 2024",
    title: "Holi 2024 - Epic Color Battle!",
    description:
      "Our first Holi celebration was absolutely epic! Over 80 guests joined for an unforgettable color festival. The beach turned into a rainbow paradise!",
    tags: ["80+ participants", "Huge success"],
    past: true,
    imageDir: "goko-holi-2024",
    cover: "/images/goko-holi-2024/IMG_6046.jpg",
    photos: ["/images/goko-holi-2024/IMG_6046.jpg"],
  },
  {
    date: "November 12, 2023",
    title: "Diwali - Festival of Lights",
    description:
      "Our inaugural Diwali celebration! Decorated the entire hostel with diyas, hosted a traditional puja, shared sweets, and lit up the beach with sparklers. Magical night!",
    tags: ["Traditional puja", "Sparklers", "Sweets"],
    past: true,
    imageDir: "goko-deepawali-2024",
    cover: "/images/goko-deepawali-2024/IMG_3985.jpg",
    photos: ["/images/goko-deepawali-2024/IMG_3985.jpg"],
  },
  {
    date: "December 25, 2023",
    title: "Christmas 2023 Beach Celebration",
    description:
      "Celebrated Christmas with our international hostel family! Palm tree decorations, beach bonfire, carol singing, Secret Santa gifts, and a feast to remember.",
    tags: ["Secret Santa", "Beach bonfire", "Carol singing"],
    past: true,
    cover: "/images/goko-deepawali-2024/IMG_5486.jpg",
    photos: ["/images/goko-deepawali-2024/IMG_5486.jpg"],
  },
  {
    date: "September 19, 2023",
    title: "Ganesha Chaturthi 2023",
    description:
      "Beautiful celebration honoring Lord Ganesha! Morning puja, made eco-friendly clay idols, cooked modaks together, and did a peaceful beach immersion ceremony.",
    tags: ["Traditional puja", "Beach immersion", "Eco-friendly"],
    past: true,
    cover: "/images/mahabaleshwar_temple.jpg",
    photos: ["/images/mahabaleshwar_temple.jpg"],
  },
  {
    date: "October 31, 2023",
    title: "Halloween 2023 - Spooky Beach Night",
    description:
      "Our first Halloween was a scream! Amazing costumes, spooky decorations, thriller dance performance, pumpkin carving competition, and ghostly beach tales.",
    tags: ["Best costume award", "Thriller dance", "Ghost stories"],
    past: true,
    imageDir: "goko-haloween-2024",
    cover: "/images/goko-haloween-2024/FullSizeRender.jpg",
    photos: ["/images/goko-haloween-2024/FullSizeRender.jpg"],
  },
  {
    date: "August 15, 2023",
    title: "Independence Day Celebration",
    description:
      "Celebrated India's Independence Day with flag hoisting, cultural performances, traditional games, Indian breakfast feast, and stories about freedom fighters!",
    tags: ["Flag hoisting", "Cultural show", "Indian feast"],
    past: true,
    cover: "/images/IMG_3413.jpg",
    photos: ["/images/IMG_3413.jpg"],
  },
];
