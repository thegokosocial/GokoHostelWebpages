/** Shape for the narrated walk block on how-to-reach. */
export type WalkingRouteVideo = {
  src: string;
  title: string;
  description: string;
};

/** One checkpoint on the walking route (optional image per step). */
export type WalkingRouteStep = {
  title: string;
  text: string;
  /** Optional still or animated GIF, e.g. `/images/how-to-reach/route/01….gif` */
  image?: string;
  imageAlt?: string;
  /** Short label above the title, e.g. “Parking” */
  badge?: string;
  /** Small caption under the photo */
  caption?: string;
};
