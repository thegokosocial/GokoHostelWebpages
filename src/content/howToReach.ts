import type { WalkingRouteStep, WalkingRouteVideo } from "@/types/walking-route";

export type { WalkingRouteStep, WalkingRouteVideo } from "@/types/walking-route";

export const howToReachHero = {
  title: "🗺️ How to Reach Us",
  subtitle: "Your complete travel guide to finding paradise in Gokarna",
};

export const transportModes = [
  {
    title: "By flight",
    icon: "✈️",
    body: [
      "Nearest airport: Dabolim (GOI), Goa — ~140 km, 3–4 hours by road. Pre-booked taxi, or bus to Margao then train/bus to Gokarna.",
      "Alternative: Hubli (HBX) — ~150 km, fewer flights.",
    ],
  },
  {
    title: "By train",
    icon: "🚂",
    body: [
      "Nearest station: Gokarna Road (GOK) — ~10 km from town. Connected to Mumbai, Mangalore, Bangalore. Auto/taxi available to the hostel.",
      "Tip: Konkan Railway trains offer scenic coastal views.",
    ],
  },
  {
    title: "By bus",
    icon: "🚌",
    body: [
      "Gokarna Bus Stand — direct buses from Bangalore (overnight), Goa, Mangalore, Hubli. KSRTC and private operators. Sleeper buses recommended overnight.",
      "From Goa: bus to Karwar, then local bus/auto to Gokarna.",
    ],
  },
  {
    title: "By road",
    icon: "🚗",
    body: [
      "Bangalore ~480 km (8–9 h via NH48). Goa (Panjim) ~140 km (3–4 h). Mangalore ~240 km (5–6 h).",
      "Coastal roads are scenic and winding near Gokarna.",
    ],
  },
];

export const localContacts = {
  intro: "Trusted autos and rentals — verify numbers before travel.",
  autos: [
    { name: "Raju Auto", phone: "+91 98765 43210", note: "24/7 · English · station pickup" },
    { name: "Ganesh Auto Service", phone: "+91 98765 43211", note: "Beach tours · full day" },
    { name: "Manoj Auto", phone: "+91 98765 43212", note: "Night pickups" },
  ],
  rentals: [
    { name: "Gokarna Bike Rentals", phone: "+91 98765 43213", note: "Scooters · ₹300–500/day · license required" },
    { name: "Beach Riders", phone: "+91 98765 43214", note: "Activa, Access, Bullet · weekly deals" },
  ],
};

export const parkingWalk = {
  title: "Walking route: Goko Hostel parking → Goko Hostel",
  intro:
    "A short walk on our own property trail — about two minutes. Follow the numbered steps and clips first; the full walkthrough video is at the bottom if you want to see the whole path in one go.",
  video: {
    src: "/videos/how-to-reach/goko-hostel-parking-walkthrough.mp4",
    title: "Video: parking to hostel entrance",
    description:
      "About 1 min 40 sec — filmed from Goko Hostel parking along the path to the Goko Hostel sign.",
  } satisfies WalkingRouteVideo,
  steps: [
    {
      badge: "Step 1",
      title: "Goko Hostel parking",
      text: "Begin here — guest parking and scooters along the red dirt path, same as in the video.",
      image: "/images/how-to-reach/route/01-goko-hostel-parking.gif",
      imageAlt: "Goko Hostel parking area at the start of the path",
    },
    {
      badge: "Step 2",
      title: "Cross the first fence",
      text: "Use the opening in the wire fence. Look for the post marked with a red ribbon — that’s the spot shown in the video.",
      image: "/images/how-to-reach/route/02-cross-the-first-fence.gif",
      imageAlt: "First fence on the path with a marked post",
    },
    {
      badge: "Step 3",
      title: "Take a left",
      text: "At this bend in the red-earth trail through the trees, turn left — keep straight once you’re on that branch.",
      image: "/images/how-to-reach/route/03-take-a-left.gif",
      imageAlt: "Junction on the path where you turn left",
    },
    {
      badge: "Step 4",
      title: "At the bridge, turn left",
      text: "When you see the bridge, take the left — do not go over the bridge. Then follow the path along the fields and backwaters.",
      image: "/images/how-to-reach/route/04-take-a-left-from-here.gif",
      imageAlt: "Bridge and path; stay left of the bridge along fields and water",
    },
    {
      badge: "Step 5",
      title: "Keep walking straight",
      text: "Stay on the path and keep walking for about another 100 metres straight — no turns until you see the hostel sign.",
      image: "/images/how-to-reach/route/05-keep-walking-straight.gif",
      imageAlt: "Straight stretch of the path along fields toward the hostel",
    },
    {
      badge: "Step 6",
      title: "Goko Hostel",
      text: "You’ve reached the entrance sign. Come on in — reception is just ahead from here.",
      image: "/images/how-to-reach/route/06-youve-reached-goko-hostel.gif",
      imageAlt: "Goko Hostel hanging sign and entrance",
    },
  ] satisfies WalkingRouteStep[],
  tips: [
    "Travel light — the path is unpaved sand and red earth; wheels can be awkward.",
    "Tell drivers “Goko Hostel parking” so you’re dropped at the right lot, not the beach lot.",
    "Lost on the trail? WhatsApp +91 98336 24363 and we’ll guide you live.",
  ],
};
