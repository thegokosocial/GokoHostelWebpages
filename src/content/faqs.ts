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
  title: "Frequently Asked Questions",
  subtitle: "Everything you need to know about staying at Goko Hostel in Gokarna",
};

export const faqStillHaveQuestions = {
  title: "Still have questions?",
  body: "Can't find the answer you're looking for? Our friendly team is here to help!",
  ctaLabel: "💬 Chat with Us on WhatsApp",
};

export const faqCategories: FaqCategory[] = [
  {
    title: "Booking & Reservations",
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
          "Free cancellation up to 7 days before check-in. Cancellations made less than 7 days before check-in or no-shows will be charged the full amount of the first night's stay.",
        ],
      },
      {
        question: "What are your check-in and check-out times?",
        paragraphs: [
          "Check-in: 12:00 noon to 11:00 PM\nCheck-out: 10:00 AM\n\nFeel free to arrive earlier. You're welcome to use the community areas (lounge and shared spaces) anytime while you wait for your reserved room to be ready at check-in.\n\nEarly check-in and late check-out are subject to availability. Please contact us in advance if you need flexible timing.",
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
    title: "Rooms & Facilities",
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
          "All beds come with private fan, lockers, and charging points.",
        ],
      },
      {
        question: "What amenities are included?",
        paragraphs: ["All our rooms include:"],
        bullets: [
          "Free high-speed WiFi throughout the property",
          "Individual fan at each bed — we don't have air conditioning in the dorms",
          "Individual lockers with locks (bring your own padlock)",
          "Charging sockets at each bed",
          "Clean bed linens and towels",
        ],
      },
      {
        question: "Are towels and linens provided?",
        paragraphs: [
          "Yes! Clean bed linens are provided and changed regularly. Towels are available at the reception on request for a small rental fee—ask staff for current rates.",
        ],
      },
      {
        question: "Do you have private rooms?",
        paragraphs: [
          "Currently, we only offer shared dormitories. However, our dorms are designed for maximum comfort and privacy with personal lockers. We focus on creating a community atmosphere while respecting personal space.",
        ],
      },
    ],
  },
  {
    title: "Location & Transportation",
    items: [
      {
        question: "Where is Goko Hostel located?",
        paragraphs: [
          "We're right on Gokarna Main Beach in Gokarna, Karnataka—step outside and you're on the sand. From here it's still easy to reach Om Beach, Kudle Beach, Paradise Beach, and the famous Mahabaleshwar Temple.",
        ],
      },
      {
        question: "How do I get to Goko Hostel from the train/bus station?",
        paragraphs: [
          "From Gokarna Road Railway Station: Take an auto-rickshaw (₹400-500, 15-20 minutes) or bus to Gokarna town.\n\nFrom Gokarna Bus Stand: We're about 10 minutes by auto-rickshaw (₹150-250) or a pleasant 15-minute walk.\n\nShare your arrival details with us, and we'll help coordinate your transport!",
        ],
      },
      {
        question: "What beaches are nearby?",
        paragraphs: ["All of Gokarna's famous beaches are easily accessible:"],
        bullets: [
          "Gokarna Main Beach: on the beach—Goko Hostel is here",
          "Kudle Beach: 10 minutes by auto",
          "Om Beach: 20 minutes by auto or trek via Kudle Beach",
          "Paradise Beach & Half Moon Beach: Accessible via trek or boat",
        ],
      },
    ],
  },
  {
    title: "Policies & Rules",
    items: [
      {
        question: "What is your age policy?",
        paragraphs: [
          "Guests must be aged 18–35 to stay at Goko Hostel. Valid government-issued ID is required at check-in.",
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
    title: "Food & Dining",
    items: [
      {
        question: "Do you serve food at the hostel?",
        paragraphs: [
          "Yes. We have a restaurant at the hostel where you can order delicious food from a varied menu.",
        ],
      },
    ],
  },
  {
    title: "Activities & Services",
    items: [
      {
        question: "What activities do you organize?",
        paragraphs: ["We organize various activities and events:"],
        bullets: [
          "Bonfires and BBQ nights",
          "Movie nights and game evenings",
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
