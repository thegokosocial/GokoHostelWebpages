import { FaqAccordion } from "@/components/faq/FaqAccordion";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { faqCategories, faqHero, faqStillHaveQuestions } from "@/content/faqs";
import { buildMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata = buildMetadata({
  title: "FAQs",
  description:
    "Frequently asked questions about Goko Hostel in Gokarna. Find answers about bookings, facilities, location, and more.",
  path: "/faqs",
});

export default function FaqsPage() {
  return (
    <>
      <PageRibbon
        title={faqHero.title}
        subtitle={faqHero.subtitle}
        image="/legacy-images/62f5bf7bfc22850018b36726-62f5bf7bfc228579eab3678c_home_faq.webp"
        imageAlt=""
      />
      <section className="py-16 md:py-24">
        <Container>
          <FaqAccordion categories={faqCategories} />

          <div className="mx-auto mt-16 max-w-xl rounded-3xl border border-brand-mist bg-brand-sand/50 p-8 text-center shadow-soft md:p-10">
            <h2 className="font-display text-xl font-bold text-brand-green-dark md:text-2xl">
              {faqStillHaveQuestions.title}
            </h2>
            <p className="mt-3 text-sm text-brand-green-dark/90 md:text-base">
              {faqStillHaveQuestions.body}
            </p>
            <div className="mt-6 flex justify-center">
              <ButtonLink href={site.whatsAppUrl} external>
                {faqStillHaveQuestions.ctaLabel}
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
