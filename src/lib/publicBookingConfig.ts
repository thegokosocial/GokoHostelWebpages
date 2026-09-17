import { getGuestBookingConfig } from "@/db/queries";
import { bookingDestination, BOOKING_ENQUIRY_PATH, type BookingDestination } from "@/lib/bookingDestination";

export async function publicBookingConfig(): Promise<BookingDestination & { nativeCheckoutReady: boolean; configurationAvailable: boolean }> {
  try {
    const config = await getGuestBookingConfig();
    return { ...bookingDestination(config?.bookingEngineUrl, config?.apiBaseUrl), nativeCheckoutReady: false, configurationAvailable: true };
  } catch {
    // Existing bad links or database outages must not resurrect the old provider.
    return { mode: "enquiry", url: BOOKING_ENQUIRY_PATH, nativeCheckoutReady: false, configurationAvailable: false };
  }
}
