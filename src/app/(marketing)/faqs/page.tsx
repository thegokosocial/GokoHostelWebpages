import { FaqAccordion } from "@/components/faq/FaqAccordion";
import { PageRibbon } from "@/components/layout/PageRibbon";
import { Reveal } from "@/components/motion/Reveal";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/button";
import { faqCategories, faqHero, faqStillHaveQuestions } from "@/content/faqs";
import { buildMetadata } from "@/lib/seo";
import { heroVideoB, site } from "@/lib/site";

export const dynamic = "force-static";

export const metadata = buildMetadata({
  title: "FAQs",
  description:
    "Frequently asked questions about Goko Hostel in Gokarna. Find answers about bookings, facilities, location, and more.",
  path: "/faqs",
});

export default function FaqsPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqCategories.flatMap((cat) =>
      cat.items.map((item) => ({
        "@type": "Question" as const,
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer" as const,
          text: [
            ...item.paragraphs,
            ...(item.bullets?.map((b) => `• ${b}`) ?? []),
            ...(item.afterBullets ?? []),
          ].join("\n"),
        },
      }))
    ),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <PageRibbon
        title={faqHero.title}
        subtitle={faqHero.subtitle}
        image="/legacy-images/62f5bf7bfc22850018b36726-62f5bf7bfc228579eab3678c_home_faq.webp"
        imageAlt="Goko Hostel common area where guests relax and connect"
        heroVideo={heroVideoB}
        pageKey="faqs"
      />
      <section className="py-16 md:py-24">
        <Container>
          <Reveal>
            <FaqAccordion categories={faqCategories} />
          </Reveal>

          <div className="goko-border-gradient mx-auto mt-16 max-w-xl rounded-3xl bg-brand-sand/60 p-8 text-center shadow-soft md:p-10">
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
