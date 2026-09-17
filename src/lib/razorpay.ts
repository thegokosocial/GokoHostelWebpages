import { z } from "zod";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Native fetch/Web Crypto work in both Next.js and Cloudflare; no gateway SDK needed.
function workerEnv(): Record<string, string | undefined> {
  try {
    const { env } = getCloudflareContext();
    return { ...process.env, ...(env as unknown as Record<string, string | undefined>) };
  } catch {
    return process.env;
  }
}
function basicAuth(keyId: string, keySecret: string) {
  // Test keys are ASCII; btoa is available in Workers and Node test runners.
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}
function fetchSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal?.timeout === "function") return AbortSignal.timeout(ms);
  return undefined;
}
const paise = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const razorpayId = (prefix: "order" | "pay" | "rfnd") => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`)).max(80);
const notes = z.record(z.string()).or(z.array(z.unknown()).length(0)).optional();
export const razorpayOrderSchema = z.object({
  entity: z.literal("order"), id: razorpayId("order"), amount: paise,
  currency: z.literal("INR"), receipt: z.string(),
  status: z.enum(["created", "attempted", "paid"]), notes,
});
export const razorpayPaymentSchema = z.object({
  entity: z.literal("payment"), id: razorpayId("pay"), order_id: razorpayId("order"),
  amount: paise, currency: z.literal("INR"),
  status: z.enum(["created", "authorized", "captured", "refunded", "failed"]),
  captured: z.boolean(), amount_refunded: paise,
}).refine((p) => p.amount > 0 && p.amount_refunded <= p.amount &&
  p.captured === ["captured", "refunded"].includes(p.status) &&
  (p.captured || p.amount_refunded === 0) &&
  (p.status !== "refunded" || p.amount_refunded === p.amount), "Inconsistent payment evidence");
export const razorpayRefundSchema = z.object({
  entity: z.literal("refund"), id: razorpayId("rfnd"), payment_id: razorpayId("pay"),
  amount: paise, currency: z.literal("INR"), receipt: z.string().nullable(),
  status: z.enum(["pending", "processed", "failed"]), notes,
});
export type RazorpayPayment = z.infer<typeof razorpayPaymentSchema>;
export type RazorpayRefund = z.infer<typeof razorpayRefundSchema>;

export class RazorpayError extends Error {
  constructor(public code: "CONFIGURATION" | "REJECTED" | "UNAVAILABLE" | "INVALID_RESPONSE" | "MISMATCH" | "SIGNATURE", public httpStatus = 503) {
    super(code === "CONFIGURATION" ? "Razorpay test integration is not configured" :
      code === "REJECTED" ? "Razorpay test API credentials were rejected. Re-check Worker secrets match Razorpay Test mode keys." :
      code === "SIGNATURE" ? "Payment signature verification failed" :
      code === "MISMATCH" ? "Gateway evidence does not match the stored payment" :
      "Unable to verify the gateway result. Reconcile before trying again.");
    this.name = "RazorpayError";
  }
}

export function testRazorpayCredentials(env: Record<string, string | undefined> = workerEnv()) {
  const keyId = env.RAZORPAY_TEST_KEY_ID || "";
  const keySecret = env.RAZORPAY_TEST_KEY_SECRET || "";
  if (!/^rzp_test_[A-Za-z0-9_]+$/.test(keyId) || !keySecret.trim() || keySecret !== keySecret.trim() || /[^\x21-\x7e]/.test(keySecret)) {
    throw new RazorpayError("CONFIGURATION");
  }
  return { keyId, keySecret };
}

export async function verifyRazorpaySignature(message: Uint8Array | string, signature: string, secret: string): Promise<boolean> {
  if (!secret.trim() || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g)!, (hex) => parseInt(hex, 16));
  const payload = typeof message === "string" ? new TextEncoder().encode(message) : message;
  // Copy to ArrayBuffer for consistent Workers/Node BufferSource typing.
  return crypto.subtle.verify("HMAC", key, bytes, Uint8Array.from(payload));
}

export async function verifyCheckoutSignature(storedOrderId: string, paymentId: string, signature: string) {
  razorpayId("order").parse(storedOrderId); razorpayId("pay").parse(paymentId);
  return verifyRazorpaySignature(`${storedOrderId}|${paymentId}`, signature, testRazorpayCredentials().keySecret);
}

async function request(path: string, method: "GET" | "POST" = "GET", body?: object): Promise<unknown> {
  const { keyId, keySecret } = testRazorpayCredentials();
  try {
    const signal = fetchSignal(10000);
    const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method, cache: "no-store", redirect: "manual", ...(signal ? { signal } : {}),
      headers: {
        Authorization: basicAuth(keyId, keySecret),
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "GokoWeb-RazorpayTest/1",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Do not forward gateway descriptions, headers, auth or PII to clients/logs.
    if (res.status === 401 || res.status === 403) throw new RazorpayError("REJECTED");
    if (!res.ok) throw new RazorpayError("UNAVAILABLE");
    return await res.json();
  } catch (error) {
    if (error instanceof RazorpayError) throw error;
    throw new RazorpayError("UNAVAILABLE");
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RazorpayError("INVALID_RESPONSE");
  return result.data;
}
const collection = <T>(schema: z.ZodType<T>) => z.object({ entity: z.literal("collection"), items: z.array(schema).max(100) });

export async function createRazorpayTestOrder(receipt: string, attemptId: string) {
  z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).parse(receipt);
  return parse(razorpayOrderSchema, await request("orders", "POST", {
    amount: 100, currency: "INR", receipt, partial_payment: false,
    notes: { goko_preview_attempt: z.string().uuid().parse(attemptId) },
  }));
}
export async function findRazorpayTestOrders(receipt: string) {
  const items = parse(collection(razorpayOrderSchema), await request(`orders?receipt=${encodeURIComponent(receipt)}&count=100`)).items;
  if (items.length === 100) throw new RazorpayError("INVALID_RESPONSE");
  return items;
}
export async function fetchRazorpayTestPayment(paymentId: string) {
  return parse(razorpayPaymentSchema, await request(`payments/${razorpayId("pay").parse(paymentId)}`));
}
export async function fetchRazorpayTestOrderPayments(orderId: string) {
  // Preview orders are never deliberately reused for a retry. A full page is
  // treated as ambiguous rather than claiming a complete reconciliation.
  const items = parse(collection(razorpayPaymentSchema), await request(`orders/${razorpayId("order").parse(orderId)}/payments`)).items;
  if (items.length === 100) throw new RazorpayError("INVALID_RESPONSE");
  return items;
}
export async function createRazorpayTestRefund(paymentId: string, receipt: string, refundId: string) {
  return parse(razorpayRefundSchema, await request(`payments/${razorpayId("pay").parse(paymentId)}/refund`, "POST", {
    amount: 100, speed: "normal", receipt,
    notes: { goko_preview_refund: z.string().uuid().parse(refundId) },
  }));
}
export async function fetchRazorpayTestRefunds(paymentId: string) {
  const items = parse(collection(razorpayRefundSchema), await request(`payments/${razorpayId("pay").parse(paymentId)}/refunds?count=100`)).items;
  if (items.length === 100) throw new RazorpayError("INVALID_RESPONSE");
  return items;
}
export async function fetchRazorpayTestRefund(refundId: string) {
  return parse(razorpayRefundSchema, await request(`refunds/${razorpayId("rfnd").parse(refundId)}`));
}
export async function checkRazorpayTestConnectivity() {
  parse(collection(razorpayOrderSchema), await request("orders?count=1"));
  return { authenticated: true, environment: "test" as const, nativeCheckoutReady: false as const };
}
