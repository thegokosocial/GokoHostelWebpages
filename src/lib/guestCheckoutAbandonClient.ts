/** Browser helper: release unpaid checkout hold on leave/refresh (not after paid confirm). */

type Session = { checkoutId: string; ownerToken: string };

let unpaid: Session | null = null;

export function armUnpaidCheckoutAbandon(session: Session) {
  unpaid = session;
}

export function clearUnpaidCheckoutAbandon() {
  unpaid = null;
}

export function abandonUnpaidCheckoutBeacon() {
  if (!unpaid) return;
  const session = unpaid;
  unpaid = null;
  const body = JSON.stringify(session);
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.("/api/guest-booking/abandon", blob)) {
      return;
    }
  } catch { /* fall through */ }
  void fetch("/api/guest-booking/abandon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    cache: "no-store",
  }).catch(() => {});
}

/** Call once from checkout UIs that arm abandon. */
export function bindUnpaidCheckoutPageHide() {
  if (typeof window === "undefined") return () => {};
  const onPageHide = () => abandonUnpaidCheckoutBeacon();
  window.addEventListener("pagehide", onPageHide);
  return () => window.removeEventListener("pagehide", onPageHide);
}
