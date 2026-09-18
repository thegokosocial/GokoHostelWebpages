import { todayIST } from "@/lib/utils";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Shared Goko booking reference: GOKO + YYYYMMDD (IST) + 6 alphanumeric. */
export function generateGokoBookingId(): string {
  const dateStr = todayIST().replace(/-/g, "");
  let random = "";
  for (let i = 0; i < 6; i++) random += CHARS[Math.floor(Math.random() * CHARS.length)];
  return `GOKO${dateStr}${random}`;
}

/** 256-bit hex token for owner / guest access proofs (never stored plaintext). */
export function generateGuestAccessToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
