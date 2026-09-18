/**
 * Status for admin manual createBooking when the stay started before today.
 * Same-day / future stays stay `received` (desk check-in unchanged).
 * Checkout is exclusive: checkout <= today means all nights are past.
 */
export function manualCreateStatus(
  checkinDate: string,
  checkoutDate: string,
  today: string,
  nowIso: string,
): {
  status: "received" | "checked_in" | "checked_out";
  checkedInAt?: string;
  checkedOutAt?: string;
} {
  if (checkinDate >= today) return { status: "received" };
  if (checkoutDate <= today) {
    return { status: "checked_out", checkedInAt: nowIso, checkedOutAt: nowIso };
  }
  return { status: "checked_in", checkedInAt: nowIso };
}
