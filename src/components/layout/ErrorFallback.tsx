"use client";

import { Container } from "@/components/ui/Container";

export function ErrorFallback({ reset }: { reset: () => void }) {
  return (
    <section className="flex min-h-[70vh] items-center py-16">
      <Container className="text-center">
        <h1 className="font-display text-3xl font-bold text-brand-green-dark md:text-4xl">
          Something went wrong
        </h1>
        <p className="mx-auto mt-4 max-w-md text-brand-green-dark/80">
          Please try again. If this keeps happening, message us on WhatsApp.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-8 inline-flex min-h-12 items-center rounded-xl goko-gradient-cta px-6 py-3 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </Container>
    </section>
  );
}
