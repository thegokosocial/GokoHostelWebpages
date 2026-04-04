/** Copy from legacy `js/booking-modal.js` — shown before redirecting to StayFlexi. */

export const bookingGateCopy = {
  mainTitle: "Before You Book",
  pleaseNote: "Please Note:",
  notes: [
    {
      icon: "🎒",
      strong: "Solo Travelers & Small Groups (Max 4) Only.",
      rest: " We don't accommodate large groups.",
    },
    {
      icon: "🎂",
      strong: "Age Limit:",
      rest: " 18 to 35 years only.",
    },
    {
      icon: "🛏️",
      strong: "Dorm Allocation:",
      rest: " Subject to availability. We can't guarantee your group stays together.",
    },
    {
      icon: "🌿",
      strong: "Non-AC Property:",
      rest: " We don't have air conditioning, but each bed has an individual fan.",
    },
    {
      icon: "🚶",
      strong: "Parking & Access:",
      rest: " Hostel is 300m from parking via a scenic trail. Backpacks recommended—no luggage assistance available.",
    },
    {
      icon: "🚫",
      strong: "Strictly No:",
      rest: " Hard liquor, drugs, outside food & drinks.",
    },
  ] as const,
  checkInLabel: "Check-in:",
  checkInValue: "12:00 Noon",
  checkOutLabel: "Check-out:",
  checkOutValue: "10:00 AM",
  earlyLinkLabel: "Coming in before check-in time?",
  managementWarning:
    "Goko Management reserves the right to cancel any booking if terms and conditions are not met.",
  reachOutBefore:
    "If you don't meet any of these criteria but still wish to stay with us, please reach out on",
  whatsappLabel: "WhatsApp",
  agreeLabelBefore: "I agree to the ",
  termsInlineLabel: "terms and conditions",
  reserveCta: "Reserve My Spot",
  redirectNoteLine1: "You will be redirected to our trusted partner",
  redirectPartner: "StayFlexi",
  early: {
    title: "Coming in before check-in time?",
    body:
      "We don't have early check-in. But you could come early and use the common washroom and chill in the common area — we have beds, hammocks, and bean bags to relax. If the beds are available, then definitely we will try to accommodate early ✔️",
    amenities: [
      "Use Beds, Hammocks and Beanbags",
      "Enjoy Yummy food at the Café",
      "Relax",
    ],
    checkoutNote:
      "The same applies to checkout as well. You can keep your luggage 🎒 near the reception at the time of checkout and chill in the common area till you leave.",
    thanksCta: "Thanks for the cooperation 🙏",
  },
  terms: {
    title: "Terms & Conditions",
    lastUpdated: "Last Updated: April 2026",
    intro:
      "Welcome to Goko Hostel. We kindly ask you to review these Terms & Conditions prior to making a reservation or checking in. By booking with us or staying at our property, you confirm your acceptance of these terms.",
    sections: [
      {
        icon: "📋",
        title: "Who Can Stay",
        bullets: [
          "Our hostel welcomes solo adventurers and small groups of up to 4 people.",
          "We're unable to host large groups or party gatherings.",
          "Guests must be between 18 and 35 years of age.",
          "Unfortunately, we cannot accommodate children at the property.",
          "Bookings of multiple beds may be subject to additional policies and charges.",
          "No parties, celebrations, or loud events are permitted on premises.",
        ],
      },
      {
        icon: "🤝",
        title: "Guest Behavior & Expectations",
        bullets: [
          "Please be considerate of fellow travelers and our team members.",
          "Smoking, drinking alcohol in dorms, recreational drugs, and disruptive conduct are not tolerated.",
          "Any damage to hostel or café property will be the guest's financial responsibility.",
          "We cannot be held accountable for lost, stolen, or damaged personal items.",
          "We reserve the right to end a guest's stay immediately (without refund) for rule violations or inappropriate behavior.",
        ],
      },
      {
        icon: "💳",
        title: "Reservations & Payments",
        bullets: [
          "All reservations depend on bed availability and are subject to confirmation.",
          "We may decline any booking at our discretion without explanation.",
          "We accept UPI transfers and cash only — no card payments available.",
          "Room rates may fluctuate and are subject to change at any time.",
          "Government-issued photo ID is mandatory for all guests upon arrival.",
          "Arrival time: 12:00 PM onwards. Departure time: by 10:00 AM.",
        ],
      },
      {
        icon: "⚠️",
        title: "Safety & Responsibility",
        bullets: [
          "Ocean swimming is strictly forbidden due to dangerous currents in the area.",
          "While we prioritize guest safety, we cannot be liable for any accidents, injuries, or mishaps that occur during your stay.",
          "By choosing to stay with us, you acknowledge and accept all associated risks.",
          "This agreement releases Goko Hostel and its staff from any claims related to your visit.",
        ],
      },
    ],
    importantTitle: "Please Note:",
    importantBody:
      "These Terms & Conditions work alongside our Privacy Policy and House Rules. By reserving a bed or staying at Goko Hostel, you confirm that you've read, understood, and agree to everything outlined in these documents.",
    footerName: "Goko Hostel - Gokarna",
    footerTagline: "Community Living | Local Experiences | Traveler's Paradise",
    agreeCheckbox: "I have read and accept these terms",
    agreeCta: "Agree & Reserve My Spot",
  },
};
