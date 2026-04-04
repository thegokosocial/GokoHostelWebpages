"use client";

import type { FaqCategory } from "@/content/faqs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import Link from "next/link";

type FaqAccordionProps = {
  categories: FaqCategory[];
};

export function FaqAccordion({ categories }: FaqAccordionProps) {
  return (
    <div className="space-y-12">
      {categories.map((cat) => (
        <section key={cat.title} aria-labelledby={slug(cat.title)}>
          <h2
            id={slug(cat.title)}
            className="font-display text-display-md font-bold text-brand-green"
          >
            {cat.title}
          </h2>
          <Accordion multiple className="mt-6 space-y-3">
            {cat.items.map((item, idx) => {
              const itemValue = `${slug(cat.title)}-${idx}`;
              return (
                <AccordionItem
                  key={itemValue}
                  value={itemValue}
                  className="rounded-2xl border border-brand-mist bg-white shadow-soft last:border-b"
                >
                  <AccordionTrigger className="px-4 py-4 text-base font-semibold text-brand-green-dark hover:no-underline md:px-5 md:text-lg">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-5 pt-0 text-sm leading-relaxed text-brand-green-dark/90 md:px-5 md:text-base">
                    <div className="space-y-3 border-t border-brand-mist pt-3">
                      {item.paragraphs.map((p, i) => (
                        <p key={`${item.question}-${i}`} className="whitespace-pre-line">
                          {p}
                        </p>
                      ))}
                      {item.bullets?.length ? (
                        <ul className="list-inside list-disc space-y-1">
                          {item.bullets.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      ) : null}
                      {item.afterBullets?.map((p, i) => (
                        <p key={`${item.question}-after-${i}`} className="whitespace-pre-line">
                          {p}
                        </p>
                      ))}
                      {item.answerLink ? (
                        <p>
                          {item.answerLink.before}
                          <Link
                            href={item.answerLink.href}
                            className="font-semibold text-brand-green underline-offset-2 hover:underline"
                          >
                            {item.answerLink.label}
                          </Link>
                          {item.answerLink.after}
                        </p>
                      ) : null}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </section>
      ))}
    </div>
  );
}

function slug(title: string) {
  return `faq-cat-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}
