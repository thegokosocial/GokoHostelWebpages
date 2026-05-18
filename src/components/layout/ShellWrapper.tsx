"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

const BARE_ROUTES = ["/admin", "/self-checkin"];

export function ShellWrapper({
  children,
  header,
  footer,
}: {
  children: ReactNode;
  header: ReactNode;
  footer: ReactNode;
}) {
  const pathname = usePathname();
  const isBare = BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  if (isBare) {
    return <main id="main-content">{children}</main>;
  }

  return (
    <>
      {header}
      <main id="main-content">{children}</main>
      {footer}
    </>
  );
}
