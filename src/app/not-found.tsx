import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { SiteShell } from "@/components/layout/SiteShell";

export default function NotFound() {
  return (
    <SiteShell>
      <section className="flex min-h-[70vh] items-center py-16">
        <Container className="text-center">
          <p className="font-display text-sm font-semibold uppercase tracking-wide text-brand-green">
            404
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold text-brand-green-dark md:text-4xl">
            Page not found
          </h1>
          <p className="mx-auto mt-4 max-w-md text-brand-green-dark/80">
            That link does not match a page on Goko Hostel. Head home or check the menu.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex min-h-12 items-center rounded-xl goko-gradient-cta px-6 py-3 text-sm font-semibold text-white"
          >
            Back to home
          </Link>
        </Container>
      </section>
    </SiteShell>
  );
}
