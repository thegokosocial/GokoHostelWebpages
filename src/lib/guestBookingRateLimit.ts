/** Simple in-memory IP rate limit for guest booking POSTs (Cloudflare isolate scope). */
const hits = new Map<string, { count: number; resetAt: number }>();

export function guestBookingRateLimit(ip: string, limit = 20, windowMs = 60_000): boolean {
  const key = ip || "unknown";
  const now = Date.now();
  const row = hits.get(key);
  if (!row || row.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (row.count >= limit) return false;
  row.count += 1;
  return true;
}

export async function readGuestJsonBody(req: Request, maxBytes = 8192): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw Object.assign(new Error("Missing request"), { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw Object.assign(new Error("Request too large"), { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.length; });
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function guestApiHeaders() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}

export function assertGuestOrigin(req: Request & { nextUrl: URL }) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    throw Object.assign(new Error("Invalid request origin"), { status: 403 });
  }
}
