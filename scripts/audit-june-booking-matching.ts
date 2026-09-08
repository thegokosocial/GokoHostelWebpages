import assert from "node:assert/strict";

type Booking = {
  id: number;
  property: string;
  checkinDate: string;
  checkoutDate: string;
  persons: number;
  bookingRef: string;
  gokoBookingId?: string;
  contact: string;
};

type Checkin = {
  label: string;
  property: string;
  arrivalDate: string;
  platform: string;
  bookingId: string;
  contact: string;
  reportedPersons: number;
};

type Result = { kind: "linked"; bookingId: number } | { kind: "standalone" | "unmatched" | "ambiguous" };

const normalizedPhone = (value: string) => value.replace(/\D/g, "").slice(-10);
const withinStay = (checkin: Checkin, booking: Booking) =>
  checkin.arrivalDate >= booking.checkinDate && checkin.arrivalDate < booking.checkoutDate;

function match(checkin: Checkin, bookings: Booking[]): Result {
  if (checkin.platform === "Walk-in") return { kind: "standalone" };

  const eligible = bookings.filter((booking) =>
    booking.property === checkin.property && withinStay(checkin, booking)
  );
  const collectedId = checkin.bookingId.trim().toUpperCase();

  if (collectedId) {
    const exact = eligible.filter((booking) =>
      [booking.bookingRef, booking.gokoBookingId]
        .filter(Boolean)
        .some((candidate) => candidate!.trim().toUpperCase() === collectedId)
    );
    if (exact.length === 1) return { kind: "linked", bookingId: exact[0].id };
    if (exact.length > 1) return { kind: "ambiguous" };
  }

  if (checkin.platform === "Offline booking") {
    const phone = normalizedPhone(checkin.contact);
    const byPhone = eligible.filter((booking) => phone && normalizedPhone(booking.contact) === phone);
    if (byPhone.length === 1) return { kind: "linked", bookingId: byPhone[0].id };
    if (byPhone.length > 1) return { kind: "ambiguous" };
  }

  return { kind: "unmatched" };
}

const bookings: Booking[] = [
  { id: 1, property: "goko_hostel", checkinDate: "2026-06-04", checkoutDate: "2026-06-14", persons: 1, bookingRef: "6761188994", contact: "9000000001" },
  { id: 2, property: "goko_hostel", checkinDate: "2026-06-10", checkoutDate: "2026-06-13", persons: 2, bookingRef: "PAIR-JUNE", contact: "9000000002" },
  { id: 3, property: "goko_hostel", checkinDate: "2026-06-13", checkoutDate: "2026-06-17", persons: 5, bookingRef: "GROUP-FIVE", contact: "9000000003" },
  { id: 4, property: "goko_hostel", checkinDate: "2026-06-20", checkoutDate: "2026-06-22", persons: 1, bookingRef: "REPEAT-A", contact: "9000000004" },
  { id: 5, property: "goko_hostel", checkinDate: "2026-06-25", checkoutDate: "2026-06-27", persons: 1, bookingRef: "REPEAT-B", contact: "9000000004" },
  { id: 6, property: "goko_hostel", checkinDate: "2026-06-28", checkoutDate: "2026-06-30", persons: 2, bookingRef: "DUPLICATE", contact: "9000000006" },
  { id: 7, property: "goko_hostel", checkinDate: "2026-06-28", checkoutDate: "2026-06-30", persons: 2, bookingRef: "DUPLICATE", contact: "9000000007" },
];

const cases: Array<{ checkin: Checkin; expected: Result; reason: string }> = [
  {
    checkin: { label: "actual June OTA shape", property: "goko_hostel", arrivalDate: "2026-06-04", platform: "Booking.com", bookingId: "6761188994", contact: "9993921560", reportedPersons: 1 },
    expected: { kind: "linked", bookingId: 1 },
    reason: "exact OTA reference",
  },
  ...Array.from({ length: 5 }, (_, index) => ({
    checkin: { label: `five-person group guest ${index + 1}`, property: "goko_hostel", arrivalDate: index === 4 ? "2026-06-14" : "2026-06-13", platform: "Booking.com", bookingId: "GROUP-FIVE", contact: `811111111${index}`, reportedPersons: [5, 1, 2, 1, 5][index] },
    expected: { kind: "linked", bookingId: 3 } as Result,
    reason: "same booking reference; distinct guest phone",
  })),
  {
    checkin: { label: "two-person booking guest 1", property: "goko_hostel", arrivalDate: "2026-06-10", platform: "Offline booking", bookingId: "PAIR-JUNE", contact: "8222222221", reportedPersons: 2 },
    expected: { kind: "linked", bookingId: 2 },
    reason: "optional offline reference supplied",
  },
  {
    checkin: { label: "two-person booking guest 2", property: "goko_hostel", arrivalDate: "2026-06-10", platform: "Offline booking", bookingId: "PAIR-JUNE", contact: "8222222222", reportedPersons: 1 },
    expected: { kind: "linked", bookingId: 2 },
    reason: "optional offline reference supplied",
  },
  {
    checkin: { label: "offline booking holder without reference", property: "goko_hostel", arrivalDate: "2026-06-13", platform: "Offline booking", bookingId: "", contact: "9000000003", reportedPersons: 5 },
    expected: { kind: "linked", bookingId: 3 },
    reason: "unique phone/date fallback",
  },
  {
    checkin: { label: "offline group member without reference", property: "goko_hostel", arrivalDate: "2026-06-13", platform: "Offline booking", bookingId: "", contact: "8333333333", reportedPersons: 1 },
    expected: { kind: "unmatched" },
    reason: "own phone cannot identify booking holder's reservation",
  },
  {
    checkin: { label: "returning phone on first stay", property: "goko_hostel", arrivalDate: "2026-06-20", platform: "Offline booking", bookingId: "", contact: "9000000004", reportedPersons: 1 },
    expected: { kind: "linked", bookingId: 4 },
    reason: "stay date separates repeated phone",
  },
  {
    checkin: { label: "wrong OTA reference", property: "goko_hostel", arrivalDate: "2026-06-13", platform: "Booking.com", bookingId: "NOT-A-BOOKING", contact: "8444444444", reportedPersons: 5 },
    expected: { kind: "unmatched" },
    reason: "never fall back to OTA phone/name",
  },
  {
    checkin: { label: "duplicate reference", property: "goko_hostel", arrivalDate: "2026-06-28", platform: "Booking.com", bookingId: "DUPLICATE", contact: "8555555555", reportedPersons: 2 },
    expected: { kind: "ambiguous" },
    reason: "never choose between duplicate candidates",
  },
  {
    checkin: { label: "walk-in", property: "goko_hostel", arrivalDate: "2026-06-12", platform: "Walk-in", bookingId: "GOKO20260612MOCK", contact: "8666666666", reportedPersons: 3 },
    expected: { kind: "standalone" },
    reason: "walk-ins do not create or link bookings",
  },
];

for (const testCase of cases) assert.deepEqual(match(testCase.checkin, bookings), testCase.expected, testCase.checkin.label);

const counts = cases.reduce<Record<string, number>>((result, testCase) => {
  const kind = match(testCase.checkin, bookings).kind;
  result[kind] = (result[kind] || 0) + 1;
  return result;
}, {});

console.log(`Validated ${cases.length} mock June check-ins: ${JSON.stringify(counts)}`);
for (const testCase of cases) {
  const result = match(testCase.checkin, bookings);
  console.log(`${testCase.checkin.label}: ${result.kind}${result.kind === "linked" ? ` → booking ${result.bookingId}` : ""} (${testCase.reason})`);
}
