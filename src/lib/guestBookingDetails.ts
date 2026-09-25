import { stayNights } from "@/lib/inventoryAvailability";
import { calculateNativeCancellationRefund } from "@/lib/nativeBookingQuote";
import { readWebsiteBookingSettings, type WebsiteBookingSettings } from "@/lib/websiteBookingSettings";

export type GuestRoomLine = {
  dormId: number;
  type: "Double" | "Bed";
  quantity: number;
  label: string;
  subtotalRupees: number;
};

export type GuestBookingDetails = {
  rooms: GuestRoomLine[];
  nights: number;
  persons: number | null;
  roomType: string | null;
  beforeTaxRupees: number | null;
  taxRupees: number | null;
  taxPercent: number | null;
  paymentChoice: string | null;
  gatewayEnvironment: string | null;
  amountRefunded: number | null;
  canCancel: boolean;
  canModify: boolean;
  cancellationDeadlineAt: string | null;
};

type QuoteJson = {
  checkinDate?: string;
  checkoutDate?: string;
  taxBasisPoints?: number;
  paymentChoice?: string;
  beforeTaxRupees?: number;
  taxRupees?: number;
  totalRupees?: number;
  units?: { key: string; nightlyRates: { date: string; rupees: number }[] }[];
};

function maskContact(value: string) {
  const v = value.trim();
  if (!v) return "";
  if (v.includes("@")) return v.replace(/(^.).*(@.*$)/, "$1***$2");
  if (v.length <= 4) return "***";
  return `${v.slice(0, 2)}***${v.slice(-2)}`;
}

export function maskGuestEmail(email: string) {
  return maskContact(email);
}

export function maskGuestPhone(phone: string) {
  return maskContact(phone);
}

function unitTypeFromKey(key: string): "Double" | "Bed" {
  return key.includes(":double:") ? "Double" : "Bed";
}

function dormIdFromKey(key: string): number {
  return Number(key.split(":")[0]) || 0;
}

/** Guest-safe room lines from live bed assignments (no physical bed IDs).
 * Callers must pass one entry per sellable unit (doubles deduped), not per physical bed. */
export function roomLinesFromAssignments(
  assignments: Array<{ dormId: number; dormName?: string | null; status?: string | null; bedLabel?: string | null }>,
  dormNames: Map<number, string>,
  amountBeforeTax: number | null,
): GuestRoomLine[] {
  const active = assignments.filter((a) => (a.status ?? "assigned") === "assigned");
  if (active.length === 0) return [];
  const grouped = new Map<string, GuestRoomLine>();
  for (const a of active) {
    const dormId = a.dormId;
    const labelHint = `${a.dormName || ""} ${a.bedLabel || ""}`.toLowerCase();
    const type: "Double" | "Bed" = labelHint.includes("double") ? "Double" : "Bed";
    const key = `${dormId}:${type}`;
    const dorm = a.dormName || dormNames.get(dormId) || `Dorm ${dormId}`;
    const bedLabel = type === "Double" ? "Whole double bed" : "Single dorm bed";
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.label = `${existing.quantity} × ${dorm} · ${bedLabel}`;
    } else {
      grouped.set(key, {
        dormId, type, quantity: 1, subtotalRupees: 0,
        label: `1 × ${dorm} · ${bedLabel}`,
      });
    }
  }
  const rooms = [...grouped.values()];
  const unitSlots = Math.max(1, rooms.reduce((n, r) => n + r.quantity, 0));
  if (amountBeforeTax != null && amountBeforeTax > 0) {
    let allocated = 0;
    rooms.forEach((room, i) => {
      if (i === rooms.length - 1) room.subtotalRupees = amountBeforeTax - allocated;
      else {
        room.subtotalRupees = Math.round((amountBeforeTax * room.quantity) / unitSlots);
        allocated += room.subtotalRupees;
      }
    });
  }
  return rooms;
}

/** Build guest-facing room lines from an accepted quote + dorm names. */
export function roomLinesFromQuote(
  quoteJson: string | null | undefined,
  dormNames: Map<number, string>,
): { rooms: GuestRoomLine[]; nights: number; beforeTaxRupees: number | null; taxRupees: number | null; taxPercent: number | null; paymentChoice: string | null } {
  if (!quoteJson) {
    return { rooms: [], nights: 0, beforeTaxRupees: null, taxRupees: null, taxPercent: null, paymentChoice: null };
  }
  let quote: QuoteJson;
  try { quote = JSON.parse(quoteJson) as QuoteJson; }
  catch { return { rooms: [], nights: 0, beforeTaxRupees: null, taxRupees: null, taxPercent: null, paymentChoice: null }; }
  const nights = quote.checkinDate && quote.checkoutDate
    ? stayNights(quote.checkinDate, quote.checkoutDate).length
    : 0;
  const grouped = new Map<string, GuestRoomLine>();
  for (const unit of quote.units || []) {
    const dormId = dormIdFromKey(unit.key);
    const type = unitTypeFromKey(unit.key);
    const key = `${dormId}:${type}`;
    const subtotal = unit.nightlyRates.reduce((s, n) => s + n.rupees, 0);
    const dorm = dormNames.get(dormId) || `Dorm ${dormId}`;
    const bedLabel = type === "Double" ? "Whole double bed" : "Single dorm bed";
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.subtotalRupees += subtotal;
      existing.label = `${existing.quantity} × ${dorm} · ${bedLabel}`;
    } else {
      grouped.set(key, {
        dormId, type, quantity: 1, subtotalRupees: subtotal,
        label: `1 × ${dorm} · ${bedLabel}`,
      });
    }
  }
  return {
    rooms: [...grouped.values()],
    nights,
    beforeTaxRupees: quote.beforeTaxRupees ?? null,
    taxRupees: quote.taxRupees ?? null,
    taxPercent: quote.taxBasisPoints != null ? quote.taxBasisPoints / 100 : null,
    paymentChoice: quote.paymentChoice ?? null,
  };
}

export function guestActionFlags(input: {
  checkoutState: string;
  bookingStatus: string | null | undefined;
  checkinDate: string | null | undefined;
  policy: WebsiteBookingSettings;
  nowEpochMs?: number;
}) {
  const now = input.nowEpochMs ?? Date.now();
  const statusOk = ["hold", "received"].includes(input.bookingStatus || "");
  const statusReceived = input.bookingStatus === "received";
  const checkoutOk = ["ready", "claimed", "fulfilled", "captured"].includes(input.checkoutState);
  let eligible = false;
  let cancellationDeadlineAt: string | null = null;
  if (input.checkinDate && statusOk) {
    const calc = calculateNativeCancellationRefund({
      checkinDate: input.checkinDate,
      policy: input.policy,
      nowEpochMs: now,
      lifecycle: input.bookingStatus === "hold" ? "provisional" : "received",
      reason: "guest_cancelled",
      capturedPaise: 0, processedRefundPaise: 0, reservedRefundPaise: 0,
    });
    eligible = calc.eligible;
    cancellationDeadlineAt = new Date(calc.deadlineEpochMs).toISOString();
  }
  const canAct = checkoutOk && statusOk && eligible;
  // canModify retained for internal amend helpers/tests; guest UI always hides self-serve edit.
  return { canCancel: canAct, canModify: canAct && statusReceived, cancellationDeadlineAt };
}

export function formatPaymentChoice(choice: string | null | undefined) {
  if (choice === "advance") return "Advance paid online";
  if (choice === "full") return "Paid in full online";
  if (choice === "property") return "Pay at property";
  return choice || "—";
}

/** Prefill text for WhatsApp / clipboard when a guest wants to change a stay. */
export function buildBookingChangeRequestText(input: {
  reference: string;
  guestName: string;
  checkinDate: string | null;
  checkoutDate: string | null;
  nights?: number | null;
  rooms?: { label: string }[];
  amountTotal?: number | null;
  amountPaid?: number | null;
  dueRupees?: number | null;
}) {
  const due = input.dueRupees ?? (
    input.amountTotal != null && input.amountPaid != null
      ? Math.max(0, input.amountTotal - input.amountPaid)
      : null
  );
  const roomLines = input.rooms?.length
    ? input.rooms.map((r) => `• ${r.label}`).join("\n")
    : "• (see confirmation page)";
  return [
    `Hi Goko, I'd like to change my booking ${input.reference}.`,
    "",
    `Guest: ${input.guestName}`,
    `Stay: ${input.checkinDate || "—"} → ${input.checkoutDate || "—"}${
      input.nights != null && input.nights > 0
        ? ` (${input.nights} ${input.nights === 1 ? "night" : "nights"})`
        : ""
    }`,
    "Rooms:",
    roomLines,
    input.amountTotal != null ? `Total: ₹${input.amountTotal}` : null,
    input.amountPaid != null ? `Paid: ₹${input.amountPaid}` : null,
    due != null && due > 0 ? `Due at property: ₹${due}` : null,
    "",
    "Please help me update dates or beds. Thank you!",
  ].filter((line): line is string => line != null).join("\n");
}

export function buildBookingEmailBody(input: {
  guestName: string;
  reference: string;
  checkinDate: string;
  checkoutDate: string;
  nights: number;
  rooms: { label: string; subtotalRupees?: number }[];
  persons?: number | null;
  beforeTaxRupees?: number | null;
  taxRupees?: number | null;
  taxPercent?: number | null;
  totalRupees: number;
  paidRupees: number;
  paymentChoice?: string | null;
  manageUrl: string;
  cancellationDeadlineAt?: string | null;
  amended?: boolean;
}) {
  const due = Math.max(0, input.totalRupees - input.paidRupees);
  const roomLines = input.rooms.length
    ? input.rooms.map((r) => `  • ${r.label}${r.subtotalRupees != null ? ` — ₹${r.subtotalRupees}` : ""}`)
    : ["  • See your confirmation page for room details"];
  const lines = [
    `Hi ${input.guestName},`,
    "",
    input.amended
      ? `Your Goko booking ${input.reference} has been updated.`
      : `Your Goko booking ${input.reference} is confirmed.`,
    "",
    "Stay",
    `  ${input.checkinDate} → ${input.checkoutDate} (${input.nights} ${input.nights === 1 ? "night" : "nights"})`,
    input.persons != null ? `  Guests: ${input.persons}` : null,
    "",
    "Rooms",
    ...roomLines,
    "",
    "Payment",
    input.paymentChoice ? `  ${formatPaymentChoice(input.paymentChoice)}` : null,
    input.beforeTaxRupees != null ? `  Subtotal: ₹${input.beforeTaxRupees}` : null,
    input.taxRupees != null
      ? `  Tax${input.taxPercent != null ? ` (${input.taxPercent}%)` : ""}: ₹${input.taxRupees}`
      : null,
    `  Total: ₹${input.totalRupees}`,
    `  Paid online: ₹${input.paidRupees}`,
    due ? `  Due at property: ₹${due}` : "  Balance due at property: ₹0",
    "",
    `View or manage your booking: ${input.manageUrl}`,
    input.cancellationDeadlineAt
      ? `Online changes/cancellation available until ${new Date(input.cancellationDeadlineAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.`
      : null,
    "",
  ].filter((line): line is string => line != null);
  return lines;
}

export function policyFromSettingsJson(raw: string | null | undefined) {
  return readWebsiteBookingSettings(raw ?? null);
}
