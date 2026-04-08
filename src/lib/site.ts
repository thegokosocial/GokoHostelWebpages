/** Looping hero video (same asset family as legacy Webflow export: stay / community / home). */
export type HeroLoopVideo = {
  poster: string;
  mp4: string;
  webm: string;
};

export const heroLoopVideo: HeroLoopVideo = {
  poster:
    "https://cdn.prod.website-files.com/62f5bf7bfc22850018b36726/62fa10b918d02f40db7c33d3_yard3-2-poster-00001.jpg",
  mp4: "https://cdn.prod.website-files.com/62f5bf7bfc22850018b36726/62fa10b918d02f40db7c33d3_yard3-2-transcode.mp4",
  webm: "https://cdn.prod.website-files.com/62f5bf7bfc22850018b36726/62fa10b918d02f40db7c33d3_yard3-2-transcode.webm",
};

export const site = {
  name: "Goko Hostel & Community Space",
  shortName: "Goko Hostel",
  description:
    "Your home away from home in Gokarna. Conscious travelers, rest, relaxation, and connection.",
  url: "https://www.gokohostel.com",
  bookingUrl: "https://bookingengine.stayflexi.com/?hotel_id=30819",
  mapsUrl: "https://maps.app.goo.gl/t5Bgbrx66h1fsS9t7",
  googleBusinessUrl: "https://maps.app.goo.gl/t5Bgbrx66h1fsS9t7",
  ogImage: "/images/IMG_7403.jpg",
  whatsAppUrl: "https://wa.me/919833624363",
  contactEmail: "thegokosocial@gmail.com",
  googleReviewsSearchUrl:
    "https://www.google.com/search?q=Goko+Hostel+Gokarna+reviews",
  /** Google Tag Manager container ID */
  googleTagManagerId: "GTM-WM3M8ZKP",
} as const;

export const social = {
  instagram: "https://www.instagram.com/gokohostel/",
  facebook: "https://www.facebook.com/gokohostel",
} as const;
