import { BookNowBare } from "@/components/booking/BookNowButton";
import { BookingEnquiryForm } from "@/components/forms/BookingEnquiryForm";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Container } from "@/components/ui/Container";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Booking Enquiry",
  description:
    "Questions before you book? Send Goko Hostel a WhatsApp or email — we are happy to help.",
  path: "/booking-enquiry",
});

export default function BookingEnquiryPage() {
  return (
    <>
      <PageRibbon
        title="Booking enquiry"
        subtitle="Tell us your dates and vibe — we’ll help you choose the right bed."
        image="/images/IMG_3345.jpg"
        imageAlt="Goko Hostel beds and community space"
      />
      <section className="py-12 md:py-16">
        <Container>
          <p className="mx-auto max-w-2xl text-center text-brand-green-dark/90">
            For questions before you book, reach out — we read every message.
          </p>
          <p className="mx-auto mt-6 max-w-2xl text-center text-brand-green-dark/90">
            Prefer instant confirmation? You can still{" "}
            <BookNowBare className="inline bg-transparent p-0 font-inherit font-semibold text-brand-red underline underline-offset-2 hover:opacity-90">
              book directly
            </BookNowBare>{" "}
            anytime.
          </p>
          <div className="mt-12">
            <BookingEnquiryForm />
          </div>
        </Container>
      </section>
    </>
  );
}
