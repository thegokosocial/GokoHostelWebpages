import { SelfCheckinForm } from "@/components/forms/SelfCheckinForm";
import { Container } from "@/components/ui/Container";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Self Check-in",
  description: "Self check-in for guests at Goko Hostel, Gokarna.",
  path: "/self-checkin",
});

export default function SelfCheckinPage() {
  return (
    <section className="min-h-screen bg-gradient-to-b from-brand-sand via-white to-brand-sand/60 py-8 md:py-20">
      <Container>
        <div className="mx-auto mb-8 max-w-2xl text-center md:mb-10">
          <h1 className="font-display text-2xl font-bold text-brand-green md:text-display-md">
            Welcome to Goko Hostel
          </h1>
          <p className="mt-2 text-base text-brand-green-dark/80 md:mt-3 md:text-lg">
            Complete your self check-in below
          </p>
        </div>
        <SelfCheckinForm />
      </Container>
    </section>
  );
}
