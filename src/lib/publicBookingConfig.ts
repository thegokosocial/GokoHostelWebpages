import { getGuestBookingConfig } from "@/db/queries";
import { bookingDestination, BOOKING_ENQUIRY_PATH, type BookingDestination } from "@/lib/bookingDestination";
import { evaluateNativeCheckoutReadiness } from "@/lib/nativeCheckoutReadiness";

export async function publicBookingConfig(): Promise<BookingDestination & {
  nativeCheckoutReady: boolean; configurationAvailable: boolean;
  paymentOptions?: { advancePercent: number; allowFullPayment: boolean; allowPayAtProperty: boolean } | null;
}> {
  try {
    const config = await getGuestBookingConfig();
    const destination = bookingDestination(config?.bookingEngineUrl, config?.apiBaseUrl);
    let nativeCheckoutReady = false;
    let paymentOptions = null as { advancePercent: number; allowFullPayment: boolean; allowPayAtProperty: boolean } | null;
    try {
      const readiness = await evaluateNativeCheckoutReadiness();
      nativeCheckoutReady = readiness.nativeCheckoutReady && destination.mode === "native";
      paymentOptions = readiness.paymentOptions;
    } catch { /* keep false */ }
    return { ...destination, nativeCheckoutReady, configurationAvailable: true, paymentOptions };
  } catch {
    return { mode: "enquiry", url: BOOKING_ENQUIRY_PATH, nativeCheckoutReady: false, configurationAvailable: false, paymentOptions: null };
  }
}
