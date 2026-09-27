"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  mapFoodQrAttemptToUi,
  mapFoodQrEnsureResponse,
  shouldNotifyFoodQrPaid,
  type FoodBillQrUiState,
} from "@/lib/foodBillQrUi";

export type { FoodBillQrUiState };

function newRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Ensure + poll a Razorpay food-bill QR for unpaid order ids.
 * Guest: /api/food/bills/qr · Admin: /api/admin/food-payments ensureFoodQr
 */
export function useFoodBillDynamicQr(opts: {
  enabled: boolean;
  orderIds: number[];
  phone?: string;
  token?: string;
  password?: string;
  username?: string;
  /** When true, use admin food-payments route */
  admin?: boolean;
  /** Fired once when UI enters paid (ensure or poll). Reload orders so Pay/Pending catch up. */
  onPaid?: () => void;
}) {
  const orderKey = useMemo(
    () => [...opts.orderIds].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b).join(","),
    [opts.orderIds],
  );
  const [state, setState] = useState<FoodBillQrUiState>({ status: "idle" });
  const requestKeyRef = useRef(newRequestKey());
  const attemptIdRef = useRef<string | null>(null);
  const onPaidRef = useRef(opts.onPaid);
  onPaidRef.current = opts.onPaid;
  const paidNotifiedRef = useRef(false);

  const commitState = useCallback((next: FoodBillQrUiState) => {
    setState(next);
    if (shouldNotifyFoodQrPaid(paidNotifiedRef.current, next.status)) {
      paidNotifiedRef.current = true;
      onPaidRef.current?.();
    }
  }, []);

  const applyAttempt = useCallback((attempt: Parameters<typeof mapFoodQrAttemptToUi>[0]) => {
    const next = mapFoodQrAttemptToUi(attempt);
    if (next.status === "active") attemptIdRef.current = next.attemptId;
    else if (next.status === "paid") attemptIdRef.current = attempt?.attemptId || attempt?.id || null;
    commitState(next);
  }, [commitState]);

  const ensure = useCallback(async () => {
    if (!opts.enabled || !orderKey) {
      commitState(opts.enabled ? { status: "idle" } : { status: "static" });
      return;
    }
    commitState({ status: "loading" });
    try {
      const orderIds = orderKey.split(",").map((s) => Number(s));
      let res: Response;
      if (opts.admin) {
        // Admin SPA clears the password after login; empty string uses the session cookie
        // (same as /api/admin/food-orders). Do not require a non-empty password here.
        const body: Record<string, unknown> = {
          action: "ensureFoodQr",
          password: opts.password || "",
          requestKey: requestKeyRef.current,
          orderIds,
        };
        if (opts.username) body.username = opts.username;
        res = await fetch("/api/admin/food-payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        if (!opts.token) throw new Error("Missing bill share token");
        res = await fetch("/api/food/bills/qr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ensure",
            requestKey: requestKeyRef.current,
            orderIds,
            token: opts.token,
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      const next = mapFoodQrEnsureResponse({ ok: res.ok, status: res.status, body: data });
      if (next.status === "active") attemptIdRef.current = next.attemptId;
      commitState(next);
    } catch (e: unknown) {
      commitState({ status: "error", message: e instanceof Error ? e.message : "Could not prepare payment QR" });
    }
  }, [commitState, opts.admin, opts.enabled, opts.password, opts.phone, opts.token, opts.username, orderKey]);

  const pollStatus = useCallback(async () => {
    const attemptId = attemptIdRef.current;
    if (!attemptId || !opts.enabled) return;
    try {
      let res: Response;
      if (opts.admin) {
        const body: Record<string, unknown> = {
          action: "reconcileFoodQrAttempt",
          password: opts.password || "",
          attemptId,
        };
        if (opts.username) body.username = opts.username;
        res = await fetch("/api/admin/food-payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        if (!opts.token) return;
        res = await fetch("/api/food/bills/qr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "status",
            requestKey: requestKeyRef.current,
            orderIds: orderKey.split(",").map((s) => Number(s)),
            attemptId,
            token: opts.token,
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.attempt) applyAttempt(data.attempt);
    } catch {
      /* ignore poll errors */
    }
  }, [applyAttempt, opts.admin, opts.enabled, opts.password, opts.phone, opts.token, opts.username, orderKey]);

  useEffect(() => {
    requestKeyRef.current = newRequestKey();
    attemptIdRef.current = null;
    paidNotifiedRef.current = false;
    if (!opts.enabled) {
      commitState({ status: "static" });
      return;
    }
    if (!orderKey) {
      commitState({ status: "idle" });
      return;
    }
    void ensure();
  }, [commitState, ensure, opts.enabled, orderKey]);

  useEffect(() => {
    if (state.status !== "active" && state.status !== "loading") return;
    const id = window.setInterval(() => { void pollStatus(); }, 8000);
    return () => window.clearInterval(id);
  }, [pollStatus, state.status]);

  return { state, refresh: ensure, pollStatus };
}
