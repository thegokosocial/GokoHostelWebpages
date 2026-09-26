/** Looping hero video with responsive mobile sources. WebM optional (CMS uploads are MP4-only). */
export type HeroLoopVideo = {
  poster: string;
  mp4: string;
  webm?: string;
  mobileMp4: string;
  mobileWebm?: string;
};

export const heroVideoA: HeroLoopVideo = {
  poster: "/videos/hero/poster-a.jpg",
  mp4: "/videos/hero/hero-a.mp4",
  webm: "/videos/hero/hero-a.webm",
  mobileMp4: "/videos/hero/hero-a-mobile.mp4",
  mobileWebm: "/videos/hero/hero-a-mobile.webm",
};

export const heroVideoB: HeroLoopVideo = {
  poster: "/videos/hero/poster-b.jpg",
  mp4: "/videos/hero/hero-b.mp4",
  webm: "/videos/hero/hero-b.webm",
  mobileMp4: "/videos/hero/hero-b-mobile.mp4",
  mobileWebm: "/videos/hero/hero-b-mobile.webm",
};

export const heroLoopVideo = heroVideoA;

export const site = {
  name: "Goko Hostel & Community Space",
  shortName: "Goko Hostel",
  description:
    "Your home away from home in Gokarna. Conscious travelers, rest, relaxation, and connection.",
  url: "https://www.gokohostel.com",
  bookingUrl: "/api/booking/destination",
  mapsUrl: "https://maps.app.goo.gl/t5Bgbrx66h1fsS9t7",
  googleBusinessUrl: "https://maps.app.goo.gl/t5Bgbrx66h1fsS9t7",
  ogImage: "/images/IMG_7403.jpg",
  whatsAppUrl: "https://wa.me/919833624363",
  contactEmail: "info@gokohostel.com",
  googleReviewsSearchUrl:
    "https://www.google.com/search?q=Goko+Hostel+Gokarna+reviews",
  /** Google Tag Manager container ID */
  googleTagManagerId: "GTM-WM3M8ZKP",
} as const;

export const social = {
  instagram: "https://www.instagram.com/gokohostel/",
  facebook: "https://www.facebook.com/gokohostel",
} as const;
