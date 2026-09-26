import { SelfCheckinFormIsland } from "@/components/forms/SelfCheckinFormIsland";
import { HeroBackdrop } from "@/components/media/HeroBackdrop";
import { Container } from "@/components/ui/Container";
import { homeHero } from "@/content/home";
import { buildMetadata } from "@/lib/seo";
import { heroLoopVideo } from "@/lib/site";

export const dynamic = "force-static";

export const metadata = buildMetadata({
  title: "Self Check-in",
  description: "Self check-in for guests at Goko Hostel, Gokarna.",
  path: "/self-checkin",
});

export default function SelfCheckinPage() {
  return (
    <section className="relative min-h-screen overflow-clip">
      <div className="absolute inset-0 z-0 overflow-hidden">
        <HeroBackdrop
          image={homeHero.heroImage}
          imageAlt={homeHero.heroImageAlt}
          video={heroLoopVideo}
          pageKey="self-checkin"
          priority
        />
      </div>
      <div
        className="absolute inset-0 z-[1] bg-gradient-to-t from-brand-green-dark/85 via-brand-green-dark/50 to-brand-green/25"
        aria-hidden
      />
      <Container className="relative z-[2] py-8 md:py-16">
        <div className="mx-auto mb-8 max-w-2xl text-center md:mb-10">
          <h1 className="goko-hero-title font-display text-2xl font-bold md:text-display-md">
            Welcome to Goko Hostel
          </h1>
          <p className="mt-2 text-base text-white/95 md:mt-3 md:text-lg">
            Complete your self check-in below
          </p>
        </div>
        <SelfCheckinFormIsland />
      </Container>
    </section>
  );
}
