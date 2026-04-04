export type FaqEntry = {
  question: string;
  paragraphs: string[];
  bullets?: string[];
  /** Rendered after bullet list (legacy order: intro → list → closing lines). */
  afterBullets?: string[];
  /** Inline link line (e.g. “Check our Events page…”) — matches legacy FAQ HTML. */
  answerLink?: { before: string; href: string; label: string; after: string };
};

export type FaqCategory = {
  title: string;
  items: FaqEntry[];
};

export const faqHero = {
  title: "❓ Frequently Asked Questions",
  subtitle: "Everything you need to know about staying at Goko Hostel in Gokarna",
};

export const faqStillHaveQuestions = {
  title: "Still have questions?",
  body: "Can't find the answer you're looking for? Our friendly team is here to help!",
  ctaLabel: "💬 Chat with Us on WhatsApp",
};

export const faqCategories: FaqCategory[] = [
  {
    title: "🏨 Booking & Reservations",
    items: [
      {
        question: "How do I make a reservation?",
        paragraphs: [
          'You can book directly through our website by clicking the "BOOK NOW" button. We use a secure booking system to ensure your reservation is confirmed instantly. You can also contact us via WhatsApp or email for assistance.',
        ],
      },
      {
        question: "What is your cancellation policy?",
        paragraphs: [
          "Free cancellation up to 48 hours before check-in. Cancellations made less than 48 hours before check-in or no-shows will be charged the full amount of the first night's stay.",
        ],
      },
      {
        question: "What are your check-in and check-out times?",
        paragraphs: [
          "Check-in: 12:00 noon onwards\nCheck-out: 10:00 AM\n\nEarly check-in and late check-out are subject to availability. Please contact us in advance if you need flexible timing.",
        ],
      },
      {
        question: "Do you accept walk-ins without reservation?",
        paragraphs: [
          "Yes, we accept walk-ins based on availability. However, we highly recommend booking in advance, especially during peak season (October to March) and holidays, as we often get fully booked.",
        ],
      },
    ],
  },
  {
    title: "🛏️ Rooms & Facilities",
    items: [
      {
        question: "What types of rooms do you offer?",
        paragraphs: ["We offer three types of accommodation:"],
        bullets: [
          "12 Bed Mixed Dorm: Spacious dorms with 2 shared bathrooms",
          "6 Bed Female Dorm: Safe and clean with ensuite washroom",
          "8 Bed Mixed Dorm (Luxury): Fun and affordable with open roof washroom",
        ],
        afterBullets: [
          "All beds come with private curtains, reading lights, private lockers, and charging points.",
        ],
      },
      {
        question: "What amenities are included?",
        paragraphs: ["All our rooms include:"],
        bullets: [
          "Free high-speed WiFi throughout the property",
          "Individual fan at each bed — we don't have air conditioning in the dorms",
          "Private curtained beds for privacy",
          "Individual lockers with locks (bring your own padlock)",
          "Reading lights and charging sockets",
          "Clean bed linens and towels",
          "24/7 hot water",
        ],
      },
      {
        question: "Are towels and linens provided?",
        paragraphs: [
          "Yes! Clean bed linens are provided and changed regularly. Towels are available upon request at the reception.",
        ],
      },
      {
        question: "Do you have private rooms?",
        paragraphs: [
          "Currently, we only offer shared dormitories. However, our dorms are designed for maximum comfort and privacy with curtained beds and personal lockers. We focus on creating a community atmosphere while respecting personal space.",
        ],
      },
    ],
  },
  {
    title: "📍 Location & Transportation",
    items: [
      {
        question: "Where is Goko Hostel located?",
        paragraphs: [
          "We're located in the heart of Gokarna, Karnataka, just 5 minutes walk from the main beach. Our location offers easy access to all major beaches (Om Beach, Kudle Beach, Paradise Beach) and the famous Mahabaleshwar Temple.",
        ],
      },
      {
        question: "How do I get to Goko Hostel from the train/bus station?",
        paragraphs: [
          "From Gokarna Road Railway Station: Take an auto-rickshaw (₹200-250, 15-20 minutes) or bus to Gokarna town.\n\nFrom Gokarna Bus Stand: We're about 10 minutes by auto-rickshaw (₹50-100) or a pleasant 15-minute walk.\n\nShare your arrival details with us, and we'll help coordinate your transport!",
        ],
      },
      {
        question: "What beaches are nearby?",
        paragraphs: ["All of Gokarna's famous beaches are easily accessible:"],
        bullets: [
          "Gokarna Main Beach: 5 minutes walk",
          "Kudle Beach: 15 minutes walk or 5 minutes by auto",
          "Om Beach: 20 minutes by auto or trek via Kudle Beach",
          "Paradise Beach & Half Moon Beach: Accessible via trek or boat",
        ],
      },
    ],
  },
  {
    title: "📋 Policies & Rules",
    items: [
      {
        question: "What is your age policy?",
        paragraphs: [
          "Guests must be 18 years or older to stay at Goko Hostel. Valid government-issued ID is required at check-in.",
        ],
      },
      {
        question: "Do you allow smoking?",
        paragraphs: [
          "Goko Hostel is a non-smoking property. Smoking is only permitted in designated outdoor areas. We appreciate your cooperation in keeping our common spaces and rooms smoke-free.",
        ],
      },
      {
        question: "Can I bring guests who are not staying at the hostel?",
        paragraphs: [
          "Outside guests are welcome in our common areas during the day (9 AM - 10 PM) but are not permitted in dormitories. For security reasons, all visitors must register at reception.",
        ],
      },
      {
        question: "Is there a curfew?",
        paragraphs: [
          "No strict curfew, but we request guests to be mindful of others. Our main door is accessible 24/7 with your room key. We ask that you keep noise levels down after 11 PM to respect other guests who may be sleeping.",
        ],
      },
    ],
  },
  {
    title: "🍽️ Food & Dining",
    items: [
      {
        question: "Do you serve food at the hostel?",
        paragraphs: [
          "We don't have a restaurant on-site, but we have a shared kitchen where you can cook your own meals. There are also numerous restaurants and cafes within walking distance serving delicious local and international cuisine.",
        ],
      },
      {
        question: "Is there a kitchen I can use?",
        paragraphs: [
          "Yes! We have a fully equipped shared kitchen available for all guests. Basic cooking equipment, utensils, and refrigerator space are provided. Please clean up after yourself to keep it pleasant for everyone.",
        ],
      },
      {
        question: "Are there good restaurants nearby?",
        paragraphs: [
          "Absolutely! Gokarna has amazing food options. You'll find beach shacks, local South Indian restaurants, cafes serving international cuisine, and fresh seafood restaurants—all within 5-10 minutes walk. We're happy to recommend our favorites!",
        ],
      },
    ],
  },
  {
    title: "🎯 Activities & Services",
    items: [
      {
        question: "What activities do you organize?",
        paragraphs: ["We organize various activities and events:"],
        bullets: [
          "Beach bonfires and BBQ nights",
          "Movie nights and game evenings",
          "Yoga and meditation sessions",
          "Festival celebrations (Holi, Christmas, Halloween, etc.)",
          "Beach volleyball and frisbee",
          "Group treks to nearby beaches",
        ],
        answerLink: {
          before: "Check our ",
          href: "/events",
          label: "Events page",
          after: " for upcoming activities!",
        },
      },
      {
        question: "Can you help arrange tours or activities?",
        paragraphs: ["Yes! Our team can help you arrange:"],
        bullets: [
          "Boat rides to beaches",
          "Scooter and bike rentals",
          "Surfing lessons",
          "Temple visits and local tours",
          "Day trips to nearby attractions",
        ],
        afterBullets: ["Just ask at reception and we'll be happy to assist!"],
      },
      {
        question: "Do you offer luggage storage?",
        paragraphs: [
          "Yes, we provide free luggage storage for our guests before check-in and after check-out. This is perfect if you want to explore Gokarna without carrying your bags!",
        ],
      },
      {
        question: "Is there laundry service available?",
        paragraphs: [
          "Yes, we can arrange laundry service through a local provider. Charges apply and typically take 24-48 hours. Ask at reception for current rates.",
        ],
      },
    ],
  },
];
