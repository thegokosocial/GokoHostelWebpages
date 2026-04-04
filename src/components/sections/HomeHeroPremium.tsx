"use client";

import { motion, useReducedMotion } from "framer-motion";
import { HeroBackdrop } from "@/components/media/HeroBackdrop";
import { BookNowButton } from "@/components/booking/BookNowButton";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/Container";
import { homeHero } from "@/content/home";
import { heroLoopVideo } from "@/lib/site";

const heroEase = [0.33, 1, 0.68, 1] as const;

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.06 * i, duration: 0.5, ease: heroEase },
  }),
};

export function HomeHeroPremium() {
  const reduce = useReducedMotion();

  return (
    <section className="relative flex min-h-[88vh] items-end overflow-hidden md:min-h-[92vh]">
      <div className="absolute inset-0 z-0 overflow-hidden">
        <HeroBackdrop
          image={homeHero.heroImage}
          imageAlt={homeHero.heroImageAlt}
          video={heroLoopVideo}
          priority
        />
      </div>
      <div
        className="absolute inset-0 z-[1] bg-gradient-to-t from-brand-green-dark via-brand-green-dark/65 to-brand-green/25"
        aria-hidden
      />
      <motion.div
        className="pointer-events-none absolute -right-20 top-1/4 z-[1] h-72 w-72 rounded-full bg-brand-red/20 blur-3xl motion-safe:animate-goko-gradient md:h-96 md:w-96"
        aria-hidden
        animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
        transition={
          reduce ? undefined : { duration: 14, repeat: Infinity, ease: "easeInOut" }
        }
      />
      <Container className="relative z-[2] pb-16 pt-28 md:pb-24 md:pt-36">
        {reduce ? (
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-white/80">
              Gokarna · Karnataka
            </p>
            <h1 className="mt-3 max-w-4xl font-display text-display-lg font-bold text-white [text-shadow:2px_2px_20px_rgba(0,0,0,0.35)]">
              {homeHero.title}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/95 md:text-xl">
              {homeHero.subtitle}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <BookNowButton>{homeHero.ctaBook}</BookNowButton>
              <ButtonLink
                href="/stay"
                variant="ctaOutline"
                className="!border-white/50 !bg-white/12 !text-white hover:!bg-white/20"
              >
                Explore rooms
              </ButtonLink>
            </div>
          </div>
        ) : (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
            }}
          >
            <motion.p
              className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-white/80"
              variants={fadeUp}
              custom={0}
            >
              Gokarna · Karnataka
            </motion.p>
            <motion.h1
              className="mt-3 max-w-4xl font-display text-display-lg font-bold text-white [text-shadow:2px_2px_20px_rgba(0,0,0,0.35)]"
              variants={fadeUp}
              custom={1}
            >
              {homeHero.title}
            </motion.h1>
            <motion.p
              className="mt-5 max-w-2xl text-lg leading-relaxed text-white/95 md:text-xl"
              variants={fadeUp}
              custom={2}
            >
              {homeHero.subtitle}
            </motion.p>
            <motion.div
              className="mt-8 flex flex-wrap gap-3"
              variants={fadeUp}
              custom={3}
            >
              <BookNowButton>{homeHero.ctaBook}</BookNowButton>
              <ButtonLink
                href="/stay"
                variant="ctaOutline"
                className="!border-white/50 !bg-white/12 !text-white hover:!bg-white/20"
              >
                Explore rooms
              </ButtonLink>
            </motion.div>
          </motion.div>
        )}
      </Container>
    </section>
  );
}
