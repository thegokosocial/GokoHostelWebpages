"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Button } from "@/components/ui/button";
import type { previewSnapshot, listPreviewAttempts, listPreviewWebhooks } from "@/lib/razorpayPreview";

type Snapshot = Awaited<ReturnType<typeof previewSnapshot>>;
type Attempt = Awaited<ReturnType<typeof listPreviewAttempts>>[number];
type Hook = Awaited<ReturnType<typeof listPreviewWebhooks>>[number];
type Callback = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type CheckoutOptions = { key: string; order_id: string; amount: number; currency: string; name: string; description: string;
  retry: { enabled: boolean }; handler: (response: Callback) => void; modal: { ondismiss: () => void };
};
declare global { interface Window { Razorpay?: new (options: CheckoutOptions) => { open(): void; on(event: string, callback: () => void): void }; } }
const STORAGE_KEY = "gokoRazorpayTestRequestV1";

export function RazorpayTestPreview({ password, username }: { password: string; username?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [message, setMessage] = useState("");
  const [savedRequest, setSavedRequest] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const generation = useRef(0);
  const callbackReceived = useRef(false);
  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch("/api/admin/booking-payments", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, password, username, ...extra }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Gateway request could not be verified");
    return result;
  }, [password, username]);
  const refresh = useCallback(async (attemptId?: string) => {
    const result = await call("listTestAttempts");
    setAttempts(result.attempts); setHooks(result.webhooks); setEnabled(result.previewEnabled);
    const id = attemptId ?? snapshot?.attempt.id;
    if (!id) return null;
    const current = await call("getTestAttempt", { attemptId: id });
    setSnapshot(current);
    return current;
  }, [call, snapshot?.attempt.id]);
  useEffect(() => {
    let active = true;
    const requestSequence = generation; // Stable ref object; cancel the latest request on cleanup.
    setSnapshot(null); setEnabled(false); setAttempts([]); setHooks([]);
    // Request keys, never credentials, survive a lost response or refresh.
    try { setSavedRequest(Boolean(localStorage.getItem(STORAGE_KEY))); } catch { setSavedRequest(true); }
    call("listTestAttempts").then((result) => { if (active) { setAttempts(result.attempts); setHooks(result.webhooks); setEnabled(result.previewEnabled); } })
      .catch((error) => { if (active) setMessage(error.message); });
    return () => { active = false; requestSequence.current++; };
  }, [call]);
  function snapshotMessage(result: Snapshot) {
    const captured = result.payments.find((p) => p.captured);
    if (captured) return `Captured payment recorded (${captured.id}).`;
    if (result.payments.length) return `Payment on record: ${result.payments[0].status}. Review before retrying.`;
    if (result.attempt.checkoutStartedAt && !result.checkout) {
      return "Checkout was already opened for this order and cannot be reopened. Start a fresh ₹1 test below.";
    }
    if (result.checkout) return "Ready to open test checkout.";
    return "Reconciled — no payment evidence found on this attempt yet.";
  }
  async function run(action: string, extra: Record<string, unknown> = {}, isSnapshot = true) {
    const token = ++generation.current;
    setBusy(true); setMessage("");
    try {
      const result = await call(action, extra);
      if (token !== generation.current) return;
      if (isSnapshot) {
        setSnapshot(result);
        setMessage(snapshotMessage(result));
      } else {
        setMessage(result.authenticated ? "Test credentials authenticated. This does not certify webhooks, settlement or live checkout." : "Webhook retry completed.");
      }
      await refresh(isSnapshot ? result.attempt.id : undefined);
    } catch (error) {
      if (token === generation.current) setMessage(`${error instanceof Error ? error.message : "Verification unavailable"}. Do not charge or refund again while the result is unknown.`);
    } finally { if (token === generation.current) setBusy(false); }
  }
  async function create(fresh = false) {
    let requestKey: string;
    try {
      if (fresh) localStorage.removeItem(STORAGE_KEY);
      requestKey = fresh ? crypto.randomUUID() : localStorage.getItem(STORAGE_KEY) || crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, requestKey); setSavedRequest(true);
    } catch { setMessage("Persistent browser storage is unavailable. Test creation is blocked so an unknown request cannot be lost."); return; }
    await run("createTestAttempt", { requestKey });
  }
  async function recoverRequest() {
    try {
      const requestKey = localStorage.getItem(STORAGE_KEY);
      if (!requestKey) { setMessage("No saved test request key. Select the original attempt from the ledger."); return; }
      await run("getTestRequest", { requestKey });
    } catch { setMessage("Browser recovery storage unavailable. Select the original attempt from the server ledger."); }
  }
  const canNewTest = snapshot && snapshot.payments.length > 0 && !snapshot.payments.some((p) => ["created", "authorized"].includes(p.status)) &&
    !snapshot.refunds.some((r) => ["submitting", "unknown", "pending"].includes(r.state));
  function newTest() {
    if (!canNewTest) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) && localStorage.getItem(STORAGE_KEY) !== snapshot!.attempt.requestKey) {
        setMessage("A different saved request still needs recovery. Recover it before clearing browser recovery state."); return;
      }
      localStorage.removeItem(STORAGE_KEY); setSavedRequest(false); setSnapshot(null);
    }
    catch { setMessage("Unable to clear the completed test request safely"); }
  }
  async function pay() {
    if (!snapshot?.checkout || !window.Razorpay || checkoutOpen || busy) return;
    const attemptId = snapshot.attempt.id;
    const token = ++generation.current;
    setBusy(true); setMessage("");
    let claimed: Snapshot;
    try {
      claimed = await call("claimTestCheckout", { attemptId });
      if (token !== generation.current) return;
      setSnapshot({ ...claimed, checkout: null });
    } catch (error) {
      if (token === generation.current) {
        setSnapshot((current) => current ? { ...current, checkout: null } : current);
        setMessage(`${error instanceof Error ? error.message : "Checkout claim unresolved"}. Reconcile this attempt; do not reopen the same order.`);
      }
      return;
    } finally { if (token === generation.current) setBusy(false); }
    if (!claimed.checkout) return;
    callbackReceived.current = false; setCheckoutOpen(true); setMessage("Test checkout open. Closing it is not evidence that payment failed.");
    try {
    const checkout = new window.Razorpay({ ...claimed.checkout, name: "Goko TEST ONLY", description: "₹1 simulated payment — no booking or real money",
      retry: { enabled: false },
      handler: (response) => { callbackReceived.current = true; setCheckoutOpen(false);
        void run("verifyTestCallback", { attemptId, paymentId: response.razorpay_payment_id, orderId: response.razorpay_order_id, signature: response.razorpay_signature }); },
      modal: { ondismiss: () => { setCheckoutOpen(false); if (!callbackReceived.current) void run("reconcileTestAttempt", { attemptId }); } },
    });
    checkout.on("payment.failed", () => { void run("reconcileTestAttempt", { attemptId }); });
    checkout.open();
    } catch { setCheckoutOpen(false); setMessage("Test checkout could not open. Reconcile before retrying."); }
  }
  return <div className="rounded-lg border p-4 text-sm space-y-4">
    <h3 className="font-semibold">Razorpay authenticated test checkout</h3>
    <p>Fixed ₹1 simulated transaction using test keys only. No room is reserved, no PMS amount is changed, and no bank receipt is created. Live guest checkout remains blocked.</p>
    <p>After the reviewed test-ledger migration, set <code>RAZORPAY_TEST_PREVIEW_ENABLED=true</code> to enable creation/refunds. Reconciliation remains available after disabling new tests.</p>
    {enabled && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={() => setMessage("Checkout script unavailable. Reconcile existing tests rather than assuming failure.")} />}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy || checkoutOpen} onClick={() => void run("checkTestConnectivity", {}, false)}>Check test API connectivity</Button>
      <Button type="button" disabled={!enabled || busy || checkoutOpen} onClick={() => void create()}>{savedRequest ? "Retry original test request" : "Create ₹1 test order"}</Button>
      {savedRequest && <Button type="button" variant="outline" disabled={busy || checkoutOpen} onClick={() => void recoverRequest()}>Recover saved request (no new order)</Button>}
      <Button type="button" variant="outline" disabled={busy || checkoutOpen} onClick={() => {
        setBusy(true); setMessage("");
        void refresh().then((current) => setMessage(current ? snapshotMessage(current) : "Ledger refreshed."))
          .catch((e) => setMessage(e instanceof Error ? e.message : "Could not refresh ledger"))
          .finally(() => setBusy(false));
      }}>Refresh ledger</Button>
      <Button type="button" variant="outline" disabled={!enabled || busy || checkoutOpen} onClick={() => void create(true)}>Start fresh ₹1 test</Button>
      {canNewTest && <Button type="button" variant="outline" disabled={busy || checkoutOpen} onClick={newTest}>Start another test</Button>}
    </div>
    {message && <p role="status" className="rounded border p-3">{message}</p>}
    {snapshot && <div className="space-y-3 rounded border p-3">
      <p className="break-all">Attempt: {snapshot.attempt.id}<br />Order state: {snapshot.attempt.state}<br />Order: {snapshot.attempt.orderId || "Unresolved — do not create another payment"}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!enabled || !scriptReady || !snapshot.checkout || busy || checkoutOpen} onClick={() => void pay()}>Open TEST checkout</Button>
        <Button type="button" variant="outline" disabled={busy || checkoutOpen} onClick={() => void run("reconcileTestAttempt", { attemptId: snapshot.attempt.id })}>Reconcile this attempt</Button>
      </div>
      {!snapshot.checkout && <p className="text-xs text-muted-foreground">
        {!enabled ? "Test preview is disabled on the server." :
          !scriptReady ? "Loading Razorpay checkout script…" :
          snapshot.attempt.checkoutStartedAt ? "Checkout already opened for this order — use Start fresh ₹1 test." :
          snapshot.payments.length ? "This attempt already has payment evidence." :
          "Checkout is not available for this attempt."}
      </p>}
      {snapshot.payments.map((p) => <div key={p.id} className="border-t pt-2">
        <p className="break-all">{p.id}: {p.status}; capture verified: {p.captured ? "yes" : "no"}; provider refund amount: {p.refundedPaise} paise</p>
        {snapshot.refunds.filter((r) => r.paymentId === p.id).map((r) => <p key={r.id}>Refund reservation: {r.state} — {r.providerId || "provider result unresolved"}</p>)}
        <Button type="button" variant="outline" disabled={!enabled || busy || checkoutOpen || !p.captured || p.status !== "captured" || p.refundedPaise > 0 || snapshot.refunds.some((r) => r.paymentId === p.id)}
          onClick={() => { if (window.confirm("Refund this simulated ₹1 test payment? No real money is involved.")) void run("refundTestPayment", { attemptId: snapshot.attempt.id, paymentId: p.id }); }}>Refund TEST payment</Button>
      </div>)}
    </div>}
    {attempts.length > 0 && <div><h4 className="font-semibold">Recent test attempts</h4><div className="mt-2 flex flex-wrap gap-2">{attempts.map((a) => <Button type="button" key={a.id} size="sm" variant="outline" disabled={busy || checkoutOpen} onClick={() => void run("getTestAttempt", { attemptId: a.id })}>{a.receipt.slice(-8)} · {a.state}</Button>)}</div></div>}
    {hooks.length > 0 && <div><h4 className="font-semibold">Recent test webhooks</h4>{hooks.map((h) => <p key={h.eventId} className="mt-2 break-all">{h.eventType}: {h.state} · {h.eventId}{!["processed", "ignored"].includes(h.state) && <Button type="button" size="sm" variant="outline" className="ml-2" disabled={busy || checkoutOpen} onClick={() => void run("retryTestWebhook", { eventId: h.eventId }, false)}>Retry saved event</Button>}</p>)}</div>}
  </div>;
}
