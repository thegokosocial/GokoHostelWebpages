export const thingsToDoHero = {
  title: "✨ Things to Do in Gokarna",
  subtitle: "Explore the best beaches, temples, and adventures around Goko Hostel!",
};

/** One image per place (path under /public). See /images/things-to-do/ATTRIBUTION.txt for sources. */
export type PlacePhoto = { src: string; alt: string };

export const beachesIntro =
  "Gokarna is blessed with some of India's most pristine beaches. From the iconic OM-shaped beach to hidden paradise coves, there's a beach for every mood.";

export const beaches = [
  {
    name: "🛕 Gokarna Main Beach",
    distance: "You are here",
    description:
      "Our home beach. A stunning crescent-shaped stretch of golden sand, perfect for watching breathtaking sunsets. Relatively quiet with a few beach shacks for food and drinks. The closest beach to Goko Hostel.",
    photos: [
      {
        src: "/images/things-to-do/gokarna-main-beach.jpg",
        alt: "Gokarna main beach — golden sand and shoreline",
      },
    ],
  },
  {
    name: "🌅 Kudle Beach",
    distance: "10 mins from Goko",
    description:
      "Kudle sits in a wide sandy bay between the headlands — swim in clear water, stretch out on the arc of sand, or grab a seat at a cliffside café. The path down from the road sets the mood before you reach the shoreline; evenings often turn into low-key music and long goodbyes to the sun.",
    photos: [
      {
        src: "/images/things-to-do/kudle-beach.jpg",
        alt: "Wide sandy bay at Kudle Beach, Gokarna",
      },
    ],
  },
  {
    name: "🕉️ Om Beach",
    distance: "20 mins from Goko",
    description:
      "Named after its OM-shaped curve when viewed from above. The most popular beach in Gokarna with water sports (banana boat, jet ski, kayaking), cafes, and vibrant energy. Perfect for adventure seekers!",
    photos: [
      {
        src: "/images/things-to-do/om-beach.jpg",
        alt: "Boats and curved shoreline at Om Beach, Gokarna",
      },
    ],
  },
  {
    name: "🌙 Half Moon Beach",
    distance: "30 min trek from Om Beach",
    description:
      "A secluded crescent-shaped cove accessible only by trek or boat. Crystal clear waters ideal for swimming. Minimal shacks maintain its pristine beauty. Best for those seeking tranquility.",
    photos: [
      {
        src: "/images/things-to-do/half-moon-beach.jpg",
        alt: "Rocky Gokarna coastline near the temple — typical coastal scenery on the trek circuit",
      },
    ],
  },
  {
    name: "🏝️ Paradise Beach",
    distance: "45 min trek from Half Moon",
    description:
      "The most secluded and pristine beach in Gokarna — truly paradise! Accessible by a scenic jungle trek or boat ride. Perfect for snorkeling, camping, and disconnecting from the world.",
    photos: [
      {
        src: "/images/things-to-do/paradise-beach.jpg",
        alt: "Calm sands at Gokarna Beach on the pilgrim coast",
      },
    ],
  },
];

export const beachTrekTips = [
  "The classic trek: Om Beach → Half Moon → Paradise (2–3 hours one way).",
  "Start early morning to avoid the midday heat and catch the best light.",
  "Carry water, sunscreen, and wear comfortable shoes.",
  "Boat rides available from Om Beach to Paradise Beach (₹300–500 per person).",
];

export const templesIntro =
  "Gokarna is one of India's most sacred pilgrimage sites. The town's spiritual heritage dates back centuries with temples dedicated to Lord Shiva.";

export const temples = [
  {
    name: "🙏 Mahabaleshwar Temple",
    meta: "15 min auto from Goko · 4th-century AD",
    description:
      "One of the seven Mukti Sthalas (places of salvation) in Karnataka. Houses the famous Atmalinga of Lord Shiva. Ancient Dravidian architecture and deeply spiritual atmosphere. Remove footwear before entering.",
    photos: [
      {
        src: "/images/things-to-do/mahabaleshwar-temple.jpg",
        alt: "Main entry and stone architecture of Mahabaleshwar Temple, Gokarna",
      },
    ],
  },
  {
    name: "🐘 Maha Ganapati Temple",
    meta: "Adjacent to Mahabaleshwar Temple",
    description:
      "Dedicated to Lord Ganesha, this temple must be visited before Mahabaleshwar Temple as per tradition. Beautiful idol of Ganapati facing the Shiva temple. An important stop on the pilgrimage circuit.",
    photos: [
      {
        src: "/images/things-to-do/ganapati-temple-gokarna.jpg",
        alt: "Entrance to Shri Ganesh (Maha Ganapati) Temple, Gokarna",
      },
    ],
  },
  {
    name: "🔱 Bhadrakali Temple",
    meta: "Near Gokarna Bus Stand",
    description:
      "Ancient temple dedicated to Goddess Bhadrakali. Located on a hill offering panoramic views of Gokarna town. Local devotees visit regularly. Beautiful at sunset with golden light on the temple.",
    photos: [
      {
        src: "/images/things-to-do/gokarna-bus-stand-bhadrakali-area.jpg",
        alt: "Gokarna town near the bus stand — Bhadrakali Temple sits on a rise in this area",
      },
    ],
  },
  {
    name: "💧 Koti Tirtha",
    meta: "Near Mahabaleshwar Temple",
    description:
      "A sacred tank (temple pond) where pilgrims take ritual baths before visiting the main temple. Surrounded by beautiful old buildings and temples. Peaceful spot for reflection and photography.",
    photos: [
      {
        src: "/images/things-to-do/koti-tirtha.jpg",
        alt: "Koti Tirtha sacred tank in Gokarna",
      },
    ],
  },
];

export const dayTripsIntro =
  "The region around Gokarna is packed with incredible natural wonders and historic sites — and you can comfortably pair two highlights in a single day. Pick an itinerary, rent a ride or join a cab, and make the most of your coastal escape.";

export const dayTrips = [
  {
    name: "🪨 Yana Caves & 💦 Vibhooti Falls",
    meta: "One full day from Gokarna · forest & falls",
    badge: "Must visit",
    description:
      "Do both in one trip: head inland to Yana’s towering black-limestone rock pillars and the small cave temple, then cool off at Vibhooti Falls — tiered, misty, and best after monsoon (roughly July–October). It’s a full day of trekking, views, and swimming holes; start early, carry water, and plan ~1.5 hours’ drive from Gokarna to the Yana side plus hops between the two.",
    photos: [
      {
        src: "/images/things-to-do/yana-great-shiva-rock.jpg",
        alt: "The Great Shiva Rock (Bhairaveshwara Shikhara) at Yana, Karnataka",
      },
    ],
  },
  {
    name: "🛕 Murdeshwar & 🌊 Honnavar",
    meta: "One full day · temple town & estuary",
    badge: "Coast & culture",
    description:
      "Combine Murdeshwar’s iconic seaside Shiva temple and huge statue with Honnavar’s laid-back harbour and Sharavathi estuary views — fishing boats, bridges, and golden-hour light on the water. It’s an easy cultural-and-coast loop north of Gokarna; allow a full day for driving, temple time, lunch, and a relaxed stroll or sunset stop in Honnavar.",
    photos: [
      {
        src: "/images/things-to-do/murdeshwar-temple.jpg",
        alt: "Murdeshwar Temple and Arabian Sea coastline, Karnataka",
      },
    ],
  },
];
