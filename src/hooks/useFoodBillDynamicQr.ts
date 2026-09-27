"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  mapFoodQrAttemptToUi,
  mapFoodQrEnsureResponse,
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
}) {
  const orderKey = useMemo(
    () => [...opts.orderIds].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b).join(","),
    [opts.orderIds],
  );
  const [state, setState] = useState<FoodBillQrUiState>({ status: "idle" });
  const requestKeyRef = useRef(newRequestKey());
  const attemptIdRef = useRef<string | null>(null);

  const applyAttempt = useCallback((attempt: Parameters<typeof mapFoodQrAttemptToUi>[0]) => {
    const next = mapFoodQrAttemptToUi(attempt);
    if (next.status === "active") attemptIdRef.current = next.attemptId;
    else if (next.status === "paid") attemptIdRef.current = attempt?.attemptId || attempt?.id || null;
    setState(next);
  }, []);

  const ensure = useCallback(async () => {
    if (!opts.enabled || !orderKey) {
      setState(opts.enabled ? { status: "idle" } : { status: "static" });
      return;
    }
    setState({ status: "loading" });
    try {
      const orderIds = orderKey.split(",").map((s) => Number(s));
      let res: Response;
      if (opts.admin) {
        if (!opts.password) throw new Error("Missing admin credentials");
        const body: Record<string, unknown> = {
          action: "ensureFoodQr",
          password: opts.password,
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
      setState(next);
    } catch (e: unknown) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Could not prepare payment QR" });
    }
  }, [opts.admin, opts.enabled, opts.password, opts.phone, opts.token, opts.username, orderKey]);

  const pollStatus = useCallback(async () => {
    const attemptId = attemptIdRef.current;
    if (!attemptId || !opts.enabled) return;
    try {
      let res: Response;
      if (opts.admin) {
        if (!opts.password) return;
        const body: Record<string, unknown> = {
          action: "reconcileFoodQrAttempt",
          password: opts.password,
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
    if (!opts.enabled) {
      setState({ status: "static" });
      return;
    }
    if (!orderKey) {
      setState({ status: "idle" });
      return;
    }
    void ensure();
  }, [ensure, opts.enabled, orderKey]);

  useEffect(() => {
    if (state.status !== "active" && state.status !== "loading") return;
    const id = window.setInterval(() => { void pollStatus(); }, 8000);
    return () => window.clearInterval(id);
  }, [pollStatus, state.status]);

  return { state, refresh: ensure, pollStatus };
}
