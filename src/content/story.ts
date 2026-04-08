export const storyHero = {
  title: "🌊 Our Story",
  subtitle: "How a dream by the sea became a home for travelers from around the world",
};

export const storyBegin = {
  title: "How It All Began",
  paragraphs: [
    "In 2023, four friends with a shared love for travel, community, and the ocean came together with a simple vision: create a space where strangers become family.",
    "After years of traveling the world and staying in countless hostels, we knew what made a place special. It wasn't just about clean beds and good WiFi—it was about the connections you make, the stories you share, and the feeling of belonging somewhere, even if just for a few nights.",
    "We chose Gokarna, Karnataka, not just for its stunning beaches and sacred temples, but for its unique blend of spirituality and adventure. Here, where the Arabian Sea meets ancient culture, we found the perfect place to build our dream.",
    "Goko Hostel was born from our belief that travel should be more than just seeing new places—it should be about experiencing new perspectives, making lasting friendships, and creating memories that stay with you forever.",
    "We care just as much about our neighbours as our guests: we hire locally, train team members in hospitality, and build roles that offer steady income and growth—so people in Gokarna and the wider region benefit from tourism through real employment and upliftment, not just passing footfall.",
  ],
};

export type Founder = { name: string; role: string; bio: string; image: string };

export const founders: Founder[] = [
  {
    name: "Pawan",
    role: "Co-Founder",
    bio: "A visionary entrepreneur with a passion for creating spaces where travelers connect and communities thrive. Pawan brings the dream of Goko to life with his dedication to building a home by the sea.",
    image:
      "/images/story/pawan/WhatsApp%20Image%202025-12-06%20at%2010.33.37%20PM.jpeg",
  },
  {
    name: "Sunny",
    role: "Co-Founder & Hostel Manager",
    bio: "The heartbeat of Goko, Sunny is always on-site ensuring every guest feels welcome. With his warm personality and hands-on approach, he creates the friendly atmosphere that makes Goko special.",
    image: "/images/story/sunny/sunny1.png",
  },
  {
    name: "Joyal",
    role: "Co-Founder",
    bio: "With a keen eye for detail and a love for sustainable tourism, Joyal ensures Goko operates smoothly while staying true to our values of community and environmental responsibility.",
    image: "/images/story/joyal/joyal1.png",
  },
  {
    name: "Hemanth",
    role: "Co-Founder",
    bio: "A beach enthusiast and community builder, Hemanth brings energy and creativity to Goko. His passion for creating memorable experiences ensures every day at the hostel is filled with adventure and fun.",
    image: "/images/story/hemanth/hemanth1.png",
  },
];

/** Portrait grid on /story (GOKO mural backdrop). Order matches on-page layout. */
export type StoryTeamPhoto = {
  name: string;
  role: string;
  image: string;
  imageAlt: string;
};

export const storyTeamPhotos: StoryTeamPhoto[] = [
  {
    name: "Yeshvant",
    role: "Master cook",
    image: "/images/story/staff/yeshvant.png",
    imageAlt: "Yeshvant in front of the hand-painted GOKO games mural",
  },
  {
    name: "Leelawati",
    role: "Housekeeping",
    image: "/images/story/staff/housekeeping-lead.png",
    imageAlt: "Leelawati in front of the GOKO mural",
  },
  {
    name: "Timmo",
    role: "Manager",
    image: "/images/story/staff/timmo.png",
    imageAlt: "Timmo in front of the GOKO mural",
  },
  {
    name: "Dilip",
    role: "Expert Cook",
    image: "/images/story/staff/dilip.png",
    imageAlt: "Dilip in front of the GOKO games mural",
  },
  {
    name: "Sunny & Sakhi",
    role: "Community Managers",
    image: "/images/story/staff/team-leads-sunny-sakhi.png",
    imageAlt: "Sunny and Sakhi together in front of the GOKO mural",
  },
  {
    name: "Vijay",
    role: "Maintenance",
    image: "/images/story/staff/bhaskar-maintenance.png",
    imageAlt: "Vijay in front of the GOKO mural",
  },
];

/** Group shot below individual founder cards (native aspect — avoid cropping faces). */
export const storyFoundersGroupPhoto = {
  image: "/images/story/staff/founders-group.png",
  width: 931,
  height: 1024,
  imageAlt:
    "Goko founders and team in front of the GOKO games mural on the sand",
  caption: "The crew behind Goko",
};

/** Names not shown in the portrait grid */
export const storyTeamAlso: { name: string; role: string }[] = [];

export const storyValues = [
  {
    icon: "🤝",
    title: "Community First",
    description:
      "We believe that the best travel experiences come from the connections you make. At Goko, you're joining a family, not just booking a bed.",
  },
  {
    icon: "🌿",
    title: "Slow Living",
    description:
      "We believe in easing the pace — unhurried mornings, real conversations, and space to breathe. At Goko, slow living means being present: savoring simple rituals, the beach, and community without the rush of constant doing.",
  },
  {
    icon: "🏖️",
    title: "Beach Life Balance",
    description:
      "Life's too short not to enjoy it. Whether you're here to relax, explore, or party, we create the perfect balance between adventure and chill vibes.",
  },
  {
    icon: "🎨",
    title: "Creativity & Expression",
    description:
      "From live music nights to art sessions, we encourage everyone to express themselves and share their talents with our community.",
  },
  {
    icon: "🌈",
    title: "Safe space & diversity",
    description:
      "Goko is a safe space for everyone. We celebrate diversity and create an environment where all travelers feel welcome and respected.",
  },
  {
    icon: "💚",
    title: "We don't just host — we care",
    description:
      "We don't just host—we care. Every interaction is personal, every recommendation is genuine, and every guest becomes part of our story.",
  },
];
