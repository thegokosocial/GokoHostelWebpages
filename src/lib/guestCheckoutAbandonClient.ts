/** Browser helper: unpaid abandon on leave + sync leave-guard for confirmation navigate. */

type Session = { checkoutId: string; ownerToken: string };

let unpaid: Session | null = null;
let leaveGuardDisarmed = false;

export function armUnpaidCheckoutAbandon(session: Session) {
  unpaid = session;
  leaveGuardDisarmed = false;
}

export function clearUnpaidCheckoutAbandon() {
  unpaid = null;
}

/** Call synchronously before location.replace so beforeunload does not fire. */
export function disarmCheckoutLeaveGuard() {
  leaveGuardDisarmed = true;
}

export function isCheckoutLeaveGuardDisarmed() {
  return leaveGuardDisarmed;
}

export function armCheckoutLeaveGuard() {
  leaveGuardDisarmed = false;
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

/** Uncertain verify timeout: release without fulfil — never use abandon beacon after pay attempt. */
export async function releaseUncertainCheckout(checkoutId: string, ownerToken: string) {
  clearUnpaidCheckoutAbandon();
  await fetch("/api/guest-booking/abandon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkoutId, ownerToken, uncertain: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  }).catch(() => {});
}

/** Call once from checkout UIs that arm abandon. */
export function bindUnpaidCheckoutPageHide() {
  if (typeof window === "undefined") return () => {};
  const onPageHide = () => abandonUnpaidCheckoutBeacon();
  window.addEventListener("pagehide", onPageHide);
  return () => window.removeEventListener("pagehide", onPageHide);
}
