import type { ReactNode } from "react";
import { BookingGateProvider } from "@/components/booking/BookingGateProvider";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { BackToTop } from "./BackToTop";
import { WhatsAppFloat } from "./WhatsAppFloat";
import { ShellWrapper } from "./ShellWrapper";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <BookingGateProvider>
      <ShellWrapper
        header={
          <>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-soft"
            >
              Skip to content
            </a>
            <Header />
          </>
        }
        footer={
          <>
            <Footer />
            <BackToTop />
            <WhatsAppFloat />
          </>
        }
      >
        {children}
      </ShellWrapper>
    </BookingGateProvider>
  );
}
