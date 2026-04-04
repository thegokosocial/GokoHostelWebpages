export const homeHero = {
  title: "Your home by the sea, where waves meet music and Adventure",
  subtitle:
    "Goko is all about connection, creativity and unforgettable memories. More than a hostel — a vibe, a tribe, and a world where fun meets freedom.",
  ctaBook: "Book now",
  heroImage: "/images/IMG_7403.jpg",
  heroImageAlt: "Goko Hostel community by the sea in Gokarna",
};

export const homeIntro = {
  title: "A community for conscious travelers seeking rest, relaxation and good vibes.",
  paragraphs: [
    "It's more than a hostel — it's a feeling. At Goko you don't just check-in, you belong from the moment you set foot on the sand. Our space isn't like other hostels because we put our people first. 6000+ previous guests from over 12 countries have visited looking for meaningful connections, a comfortable bed, and a place to call home.",
    "Our space is where friendships form faster than footprints wash away and where no two days ever feel the same.",
    "Whether your stay is for a few days, or a few months, the bonds you create here will last a lifetime...",
  ],
  image: "/images/IMG_3346.jpg",
  imageAlt: "Goko community",
};

/** Legacy `section-home-yards` — neighbourhood & F&B framing. */
export const homeNeighborhood = {
  title: "Goko Hostel",
  paragraphs: [
    "Goko Hostel is open to the neighborhood and our guests. We've curated a community of shops, restaurants, cafes and saloons to facilitate friendship and bonding between staff, locals, and guests.",
    "Enjoy award-winning burgers, mouth-watering salads, authentic Japanese street food, and more at Goko Hostel.",
  ],
  image: "/images/IMG_7403.jpg",
  imageAlt: "Goko Hostel & community space",
};

/** Legacy `section-home-direction`. */
export const homeLocation = {
  title: "Convenience, community and connection.",
  body:
    "Experience Gokarna like a local — serene beaches meet sacred temples. Goko Hostel is just a 5-minute walk from Kudle Beach and a 10-minute ride to the famous Mahabaleshwar Temple, one of Karnataka's most revered spiritual sites.",
};

/** Legacy `section-home-info` FAQ teaser. */
export const homeFaqTeaser = {
  title: "Frequently asked questions",
  items: [
    { question: "How far is it from the airport?", href: "/faqs" },
    { question: "Can I work remotely from Goko?", href: "/faqs" },
  ],
  cta: { label: "See all FAQs", href: "/faqs" },
};

export const homeStats = [
  { value: "6,000+", label: "Previous guests" },
  { value: "4.9/5", label: "Average rating" },
  { value: "Since 2023", label: "Welcoming travelers" },
];

export type RoomTab = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  images: string[];
  accent: "blue" | "green" | "orange";
};

export const homeRooms: RoomTab[] = [
  {
    id: "mixed",
    name: "Mixed dorms",
    tagline: "Comfy & spacious · 12 beds",
    description:
      "Looking for new friends? Stay in our mixed shared dorms with 12 other travelers. Lower beds are cozy doubles—perfect for couples or extra space—while upper beds are singles ideal for solo travelers. There are 2 spacious washrooms in each dorm. Each bed has its own fan — we're a non-AC property.",
    images: [
      "/images/stay/mixed-dorm-12bed/mixed-dorm1.jpg",
      "/images/stay/mixed-dorm-12bed/mixed-dorm2.jpg",
      "/images/stay/mixed-dorm-12bed/mixed-dorm3.jpg",
    ],
    accent: "blue",
  },
  {
    id: "female",
    name: "Female dorms",
    tagline: "Safe & clean · 6 beds",
    description:
      "Looking for new friends? Stay in our female shared dorms with 6 other travelers. Ensuite washroom in dorm — safe, spacious and clean. Most of the time we have a female host and volunteer on property. Each bed has its own fan — we're a non-AC property.",
    images: [
      "/images/stay/female-dorm-6bed/mixed-dorm1.jpg",
      "/images/stay/female-dorm-6bed/mixed-dorm2.jpg",
      "/images/stay/female-dorm-6bed/mixed-dorm3.jpg",
    ],
    accent: "green",
  },
  {
    id: "luxury",
    name: "Luxury mixed dorms",
    tagline: "Fun & affordable · 8 beds",
    description:
      "Stay in our 8-bed mixed shared dorms with fellow travelers. Your space includes a private curtained bed, private locker, reading light, individual fan at your bed, WiFi, and our unique open roof washroom — we're a non-AC property. A perfect blend of privacy and community!",
    images: [
      "/images/stay/luxury-dorm-8bed/mixed-dorm1.jpg",
      "/images/stay/luxury-dorm-8bed/mixed-dorm2.jpg",
      "/images/stay/luxury-dorm-8bed/mixed-dorm3.jpg",
    ],
    accent: "orange",
  },
];

