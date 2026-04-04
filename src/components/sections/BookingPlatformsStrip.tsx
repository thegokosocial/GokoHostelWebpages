import Image from "next/image";
import { Reveal } from "@/components/motion/Reveal";

const logos: { src: string; label: string; width: number; height: number }[] = [
  {
    src: "/legacy-images/62f5bf7bfc22850018b36726-63021e8fa0f2840b08ce4ce1_hostel_world_v2.svg",
    label: "Hostelworld",
    width: 140,
    height: 32,
  },
  {
    src: "/legacy-images/62f5bf7bfc22850018b36726-63021e8fb7fffa58ea9fa818_agoda_v2.svg",
    label: "Agoda",
    width: 80,
    height: 28,
  },
  {
    src: "/legacy-images/62f5bf7bfc22850018b36726-63021e8ff4c9149dbc71829c_trip_advisor_v2.svg",
    label: "Tripadvisor",
    width: 120,
    height: 28,
  },
  {
    src: "/legacy-images/62f5bf7bfc22850018b36726-63021e8f09a3225129399c8c_google_v2.svg",
    label: "Google",
    width: 90,
    height: 30,
  },
  {
    src: "/legacy-images/62f5bf7bfc22850018b36726-63021e8f22ce746c53cdaebe_booking_v2.svg",
    label: "Booking.com",
    width: 120,
    height: 24,
  },
];

export function BookingPlatformsStrip() {
  return (
    <section className="relative border-y border-brand-mist/80 bg-white/80 py-10 backdrop-blur-sm">
      <div className="goko-wave-divider absolute inset-x-0 top-0 h-8 -translate-y-full opacity-50" aria-hidden />
      <Reveal>
        <p className="text-center font-display text-xs font-bold uppercase tracking-[0.25em] text-brand-green/70">
          Also discover us on
        </p>
        <div className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center justify-center gap-x-10 gap-y-8 opacity-90 grayscale transition-all duration-300 hover:grayscale-0">
          {logos.map((l) => (
            <div
              key={l.src}
              className="flex shrink-0 items-center justify-center transition-transform duration-300 hover:scale-105 motion-reduce:transform-none"
            >
              <Image
                src={l.src}
                alt={l.label}
                width={l.width}
                height={l.height}
                className="h-7 w-auto object-contain md:h-8"
              />
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
