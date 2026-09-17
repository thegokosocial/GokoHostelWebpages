import { gokoStayRooms } from "@/content/rooms";

export const stayHero = {
  title: "Stay at Goko Hostel",
  subtitle:
    "Comfortable, clean, and community-focused accommodation in the heart of Gokarna. Your home away from home!",
  image:
    "/legacy-images/62f5bf7bfc22850018b36726-63021b52b4a9f5776b671ae4_home_video-thumbnail_2.webp",
};

export const stayRoomSummaries = gokoStayRooms.map(({ id, name, description, features }) => ({
  id,
  name,
  description,
  features,
}));

export const stayAmenities = [
  {
    icon: "bed",
    title: "Comfortable beds",
    description:
      "Charging points and an individual fan at every bed — we're a non-AC hostel.",
  },
  {
    icon: "lock",
    title: "Secure lockers",
    description: "Private lockers in every room for your belongings.",
  },
  {
    icon: "shower",
    title: "Clean bathrooms",
    description: "Well-maintained shared and ensuite bathrooms with hot water.",
  },
  {
    icon: "wifi",
    title: "Free WiFi",
    description: "High-speed WiFi across the hostel.",
  },
  {
    icon: "waves",
    title: "Beach access",
    description: "A short walk to Gokarna’s beaches and sacred temples.",
  },
];

export const stayWhy = {
  title: "Why choose Goko Hostel?",
  paragraphs: [
    "Located in the heart of Gokarna on the beach, Goko Hostel offers the perfect blend of comfort, community, and adventure.",
    "Our rooms are designed with your comfort in mind — private lockers, charging points, and a fan at every bed (no AC). Clean, secure, and welcoming.",
    "What truly sets us apart is our community. Meet travelers from around the world, share stories, and create memories that last a lifetime.",
  ],
};
