/** Order Summary → Place Order guest handoff (Order More). */

export type OrderMorePrefillGuest = {
  guestType: "hostel" | "walkin" | "table";
  checkinId?: number;
  guestName: string;
  guestPhone?: string;
  roomInfo?: string;
};

export type OrderMoreHostelStub = {
  id: number;
  name: string;
  contact: string;
  arrivalDate: string;
  stayingDays: string;
  bedInfo: string;
};

export function tableNumberFromPrefill(prefill: OrderMorePrefillGuest): number | null {
  if (prefill.guestType !== "table") return null;
  return Number(prefill.roomInfo?.match(/Table (\d+)/i)?.[1]) || null;
}

export function hostelStubFromPrefill(prefill: OrderMorePrefillGuest): OrderMoreHostelStub | null {
  if (prefill.guestType !== "hostel" || !prefill.checkinId) return null;
  return {
    id: prefill.checkinId,
    name: prefill.guestName,
    contact: prefill.guestPhone || "",
    arrivalDate: "",
    stayingDays: "",
    bedInfo: prefill.roomInfo || "",
  };
}

export function prefillTypeLabel(prefill: OrderMorePrefillGuest): string {
  if (prefill.guestType === "hostel") return "Hostel guest";
  if (prefill.guestType === "table") return "Cafe table";
  return "Walk-in";
}

export function prefillDetailText(prefill: OrderMorePrefillGuest): string | undefined {
  if (prefill.guestType === "hostel") return prefill.roomInfo || prefill.guestPhone || undefined;
  if (prefill.guestType === "table") return prefill.roomInfo || prefill.guestName || undefined;
  return prefill.guestPhone || undefined;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Load active guests; when a checkinId is expected, retry a few times if the
 * match is missing (transient empty/partial list). Never clears Order More
 * identity — caller already has a stub from the prefill.
 */
export async function loadActiveGuestsWithMatch<T extends { id: number }>(
  fetchGuests: () => Promise<T[] | null>,
  checkinId: number | undefined,
  opts?: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<{ guests: T[]; match: T | null }> {
  const retries = opts?.retries ?? 2;
  const delayMs = opts?.delayMs ?? 350;
  const sleep = opts?.sleep ?? defaultSleep;
  let lastGuests: T[] = [];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const guests = await fetchGuests();
    if (guests) {
      lastGuests = guests;
      if (checkinId == null) return { guests, match: null };
      const match = guests.find((g) => g.id === checkinId) || null;
      if (match) return { guests, match };
    }
    if (attempt < retries) await sleep(delayMs);
  }

  return {
    guests: lastGuests,
    match: checkinId != null ? lastGuests.find((g) => g.id === checkinId) || null : null,
  };
}
