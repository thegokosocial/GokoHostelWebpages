"use client";

import { useId, useState } from "react";
import type { FaqCategory } from "@/content/faqs";
import { cn } from "@/lib/utils";
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
          <ul className="mt-6 space-y-3">
            {cat.items.map((item, idx) => (
              <FaqItem key={`${slug(cat.title)}-${idx}`} entry={item} />
            ))}
          </ul>
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

function FaqItem({
  entry,
}: {
  entry: FaqCategory["items"][number];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const panelId = `${id}-panel`;
  const btnId = `${id}-btn`;

  return (
    <li className="rounded-2xl border border-brand-mist bg-white shadow-soft">
      <h3 className="text-base font-semibold text-brand-green-dark md:text-lg">
        <button
          type="button"
          id={btnId}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left focus-visible:goko-focus md:px-5 md:py-4"
          onClick={() => setOpen((o) => !o)}
        >
          <span>{entry.question}</span>
          <span
            className={cn(
              "mt-1 shrink-0 text-brand-green transition-transform duration-200",
              open && "rotate-180"
            )}
            aria-hidden
          >
            ▼
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={btnId}
        hidden={!open}
        className={cn(!open && "hidden")}
      >
        <div className="space-y-3 border-t border-brand-mist px-4 pb-5 pt-2 text-sm leading-relaxed text-brand-green-dark/90 md:px-5 md:text-base">
          {entry.paragraphs.map((p, i) => (
            <p key={`${entry.question}-${i}`} className="whitespace-pre-line">
              {p}
            </p>
          ))}
          {entry.bullets?.length ? (
            <ul className="list-inside list-disc space-y-1">
              {entry.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {entry.afterBullets?.map((p, i) => (
            <p key={`${entry.question}-after-${i}`} className="whitespace-pre-line">
              {p}
            </p>
          ))}
          {entry.answerLink ? (
            <p>
              {entry.answerLink.before}
              <Link
                href={entry.answerLink.href}
                className="font-semibold text-brand-green underline-offset-2 hover:underline"
              >
                {entry.answerLink.label}
              </Link>
              {entry.answerLink.after}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}
