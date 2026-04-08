import Image from "next/image";
import Link from "next/link";
import { BookNowBare } from "@/components/booking/BookNowButton";
import { site, social } from "@/lib/site";

type FooterLink =
  | { label: string; href: string; external?: boolean }
  | { label: string; bookNow: true };

const footerCols: { title: string; links: FooterLink[] }[] = [
  {
    title: "About",
    links: [
      { label: "Our story", href: "/story" },
      { label: "Events", href: "/events" },
    ],
  },
  {
    title: "Gokarna",
    links: [
      { label: "Stay", href: "/stay" },
      { label: "Community area", href: "/community-area" },
      { label: "Directions", href: site.mapsUrl, external: true },
      { label: "FAQs", href: "/faqs" },
      { label: "Reviews", href: "/reviews" },
      { label: "Book", bookNow: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-16 bg-brand-green text-white">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-sm">
            <Link
              href="/"
              className="inline-flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white p-2 shadow-md ring-1 ring-white/20">
                <Image
                  src="/logo.png"
                  alt={`${site.shortName} logo`}
                  width={40}
                  height={40}
                  className="h-10 w-10 object-contain"
                  unoptimized
                />
              </span>
              <span className="font-display text-xl font-bold text-white">
                Goko Hostel
              </span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-white/85">
              Conscious travel, beach mornings, and a community that lasts beyond
              checkout.
            </p>
          </div>
          <div className="flex flex-wrap gap-12">
            {footerCols.map((col) => (
              <div key={col.title}>
                <p className="font-display text-sm font-bold uppercase tracking-widest text-white/70">
                  {col.title}
                </p>
                <ul className="mt-3 space-y-2">
                  {col.links.map((l) => {
                    if ("bookNow" in l && l.bookNow) {
                      return (
                        <li key={`${col.title}-${l.label}`}>
                          <BookNowBare className="text-sm text-white/90 underline-offset-4 hover:underline">
                            {l.label}
                          </BookNowBare>
                        </li>
                      );
                    } else {
                      const { href, label, external } = l as Extract<
                        FooterLink,
                        { href: string }
                      >;
                      return (
                        <li key={`${col.title}-${label}`}>
                          {external ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-white/90 underline-offset-4 hover:underline"
                            >
                              {label}
                            </a>
                          ) : (
                            <Link
                              href={href}
                              className="text-sm text-white/90 underline-offset-4 hover:underline"
                            >
                              {label}
                            </Link>
                          )}
                        </li>
                      );
                    }
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-6 border-t border-white/15 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-3">
            <a
              href={social.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-white/25 px-4 py-2 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              Instagram
            </a>
            <a
              href={social.facebook}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-white/25 px-4 py-2 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              Facebook
            </a>
            <a
              href={site.googleBusinessUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-white/25 px-4 py-2 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              Google Maps
            </a>
            <a
              href={`mailto:${site.contactEmail}?subject=${encodeURIComponent("Goko Hostel")}`}
              className="rounded-full border border-white/25 px-4 py-2 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              Email
            </a>
            <a
              href={site.whatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-white/25 px-4 py-2 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              WhatsApp
            </a>
          </div>
          <p className="text-sm text-white/60">© 2023 – Goko Hostel</p>
        </div>
      </div>

      <div className="border-t border-white/10 bg-brand-green-dark/40">
        <div className="mx-auto flex max-w-6xl justify-center px-4 py-4 md:px-6">
          <BookNowBare className="goko-gradient-cta inline-flex min-h-11 items-center justify-center rounded-full px-8 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-white shadow-md">
            Book now
          </BookNowBare>
        </div>
      </div>
    </footer>
  );
}
