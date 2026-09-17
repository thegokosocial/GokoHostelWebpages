import { site } from "@/lib/site";

export const NATIVE_BOOKING_PATH = "/book";
export const BOOKING_ENQUIRY_PATH = "/booking-enquiry";
export const NATIVE_BOOKING_URL = `${site.url}${NATIVE_BOOKING_PATH}`;

export type BookingDestination = {
  mode: "native" | "external" | "enquiry";
  url: string;
};

/** Only administrator-saved guest destinations, never a request query or Host header. */
export function bookingDestination(raw: unknown, apiBaseUrl?: string | null): BookingDestination {
  if (raw == null || raw === "") return { mode: "enquiry", url: BOOKING_ENQUIRY_PATH };
  if (typeof raw !== "string") throw new Error("Booking Engine URL must be a link");
  const value = raw.trim();
  if (!value) return { mode: "enquiry", url: BOOKING_ENQUIRY_PATH };
  if (value === NATIVE_BOOKING_PATH) return { mode: "native", url: NATIVE_BOOKING_PATH };
  // URL() silently normalizes controls, backslashes and malformed absolute URLs.
  if (!/^https:\/\/[^/]/i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Use /book for Goko, or a complete HTTPS guest booking link");
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Booking Engine URL is not valid"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error("Booking Engine URL must use HTTPS without embedded credentials");
  }
  if (parsed.hostname.endsWith(".")) {
    throw new Error("Use the normal booking hostname without a trailing dot");
  }
  if (apiBaseUrl) {
    let api: URL | undefined;
    try { api = new URL(apiBaseUrl); } catch { /* An invalid integration URL is unrelated to guest routing. */ }
    if (api && parsed.hostname === api.hostname.replace(/\.+$/, "") && parsed.port === api.port &&
        parsed.pathname.replace(/\/+$/, "") === api.pathname.replace(/\/+$/, "")) {
      throw new Error("Use the guest booking engine link, not the Aiosell API Base URL");
    }
  }
  const canonical = new URL(site.url);
  if (parsed.hostname === canonical.hostname || parsed.hostname === canonical.hostname.replace(/^www\./, "")) {
    if (parsed.origin !== canonical.origin || parsed.pathname !== NATIVE_BOOKING_PATH || parsed.search || parsed.hash) {
      throw new Error(`For Goko booking, use /book or ${NATIVE_BOOKING_URL}`);
    }
    return { mode: "native", url: NATIVE_BOOKING_PATH };
  }
  // A guest engine is a public destination, not an API, intranet, or local machine.
  if (parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost") || parsed.hostname.endsWith(".local") || !parsed.hostname.includes(".") ||
      /^[\d.]+$/.test(parsed.hostname) || parsed.hostname.includes(":")) {
    throw new Error("Use a public guest booking engine link, not a local or API address");
  }
  return { mode: "external", url: parsed.href };
}
