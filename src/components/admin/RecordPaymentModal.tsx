"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { BanknoteIcon, SmartphoneIcon, XIcon } from "lucide-react";

type PaymentTab = "cash" | "online" | "split";
type AmountUnit = "paise" | "rupees";
type ReceiptAccount = { id: number; name: string; nickname: string; isActive: number };

export function RecordPaymentModal({
  totalAmount,
  guestName,
  initialMethod,
  initialCash,
  onConfirm,
  onClose,
  mode = "collect",
  zClass = "z-[60]",
  amountUnit = "paise",
  password,
  username,
  receiptKind,
  allowPartial = false,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  totalAmount: number;
  guestName: string;
  initialMethod?: string;
  initialCash?: number;
  onConfirm: (method: string, cashReceived: number, changeGiven: number, onlineAccountId?: number, receiptId?: string, amountToApply?: number, operationId?: string, note?: string) => void | boolean | Promise<void | boolean>;
  onClose: () => void;
  mode?: "collect" | "refund" | "correction";
  zClass?: string;
  /** Food orders are paise. Bookings calendar amounts are rupees. */
  amountUnit?: AmountUnit;
  password?: string;
  username?: string;
  receiptKind?: "food" | "room";
  allowPartial?: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => boolean | void | Promise<boolean | void>;
}) {
  const refund = mode === "refund";
  const correction = mode === "correction";
  const scale = amountUnit === "rupees" ? 1 : 100;
  const toStored = (rupeeValue: number) => amountUnit === "rupees"
    ? Math.round(rupeeValue * 100) / 100
    : Math.round(rupeeValue * scale);
  const amountDigits = amountUnit === "rupees" ? 2 : 0;
  const defaultTab: PaymentTab = initialMethod === "cash" ? "cash" : initialMethod === "split" ? "split" : "online";
  const [activeTab, setActiveTab] = useState<PaymentTab>(defaultTab);
  const defaultCash = initialCash && initialCash > 0 ? (initialCash / scale).toString() : (totalAmount / scale).toString();
  const [cashInput, setCashInput] = useState(defaultCash);
  const [splitCash, setSplitCash] = useState("");
  const [splitOnline, setSplitOnline] = useState((totalAmount / scale).toString());
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<ReceiptAccount[]>([]);
  const [onlineAccountId, setOnlineAccountId] = useState("");
  const [partialAmount, setPartialAmount] = useState(totalAmount > 0 ? (totalAmount / scale).toFixed(2) : "0.00");
  const [note, setNote] = useState("");
  const [operationId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    // After login the admin UI clears the password and authenticates API calls
    // with the admin session cookie, so an empty password is valid here.
    if (!receiptKind) return;
    const payload: Record<string, string> = { password: password || "" };
    if (username) payload.username = username;
    const roomAccountList = receiptKind === "room";
    payload.action = roomAccountList ? "getRoomReceiptAccounts" : "getFoodReceiptAccounts";
    void fetch(roomAccountList ? "/api/admin/bookings" : "/api/admin/account-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then((r) => r.ok ? r.json() : null).then((data) => {
        if (!data) return;
        setAccounts((data.accounts || []).filter((a: ReceiptAccount) => a.isActive));
        setOnlineAccountId(String(receiptKind === "food" ? data.foodOnlineReceiptAccountId || "" : data.roomOnlineReceiptAccountId || ""));
      }).catch(() => {});
  }, [password, username, receiptKind]);

  const totalRupees = totalAmount / scale;
  const amountRupees = allowPartial ? (Number(partialAmount) || 0) : totalRupees;
  const cashValue = Number(cashInput) || 0;
  const changeDue = cashValue - amountRupees;
  const splitCashVal = Number(splitCash) || 0;
  const splitOnlineVal = Number(splitOnline) || 0;
  const splitTotal = splitCashVal + splitOnlineVal;
  const splitExact = Math.round(splitTotal * 100) === Math.round(amountRupees * 100);

  useEffect(() => {
    const online = amountRupees - splitCashVal;
    setSplitOnline(online > 0 ? online.toString() : "0");
  }, [splitCash, amountRupees, splitCashVal]);

  useEffect(() => {
    if (allowPartial) setCashInput(amountRupees.toFixed(2));
  }, [allowPartial, amountRupees]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (activeTab === "cash") {
        if (correction) {
          await onConfirm("cash", toStored(amountRupees), 0, undefined, operationId, toStored(amountRupees), operationId, note.trim());
        } else if (refund) {
          await onConfirm("cash", toStored(amountRupees), 0, undefined, operationId, toStored(amountRupees), operationId, note.trim());
        } else {
          const received = toStored(cashValue);
          const change = changeDue > 0 ? toStored(changeDue) : 0;
          await onConfirm("cash", received, change, undefined, operationId, toStored(amountRupees), operationId, note.trim());
        }
      } else if (activeTab === "online") {
        await onConfirm("online", 0, 0, Number(onlineAccountId) || undefined, operationId, toStored(amountRupees), operationId, note.trim());
      } else {
        await onConfirm("split", toStored(splitCashVal), 0, Number(onlineAccountId) || undefined, operationId, toStored(amountRupees), operationId, note.trim());
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSecondaryAction = async () => {
    if (saving || !onSecondaryAction) return;
    setSaving(true);
    try { await onSecondaryAction(); } finally { setSaving(false); }
  };

  const canSave = (() => {
    if (saving || !(amountRupees > 0 && amountRupees <= totalRupees) || (correction && !note.trim())) return false;
    if (activeTab === "cash") return refund ? true : cashValue >= amountRupees;
    if (activeTab === "online") return !receiptKind || !!onlineAccountId;
    if (activeTab === "split") {
      if (!(splitCashVal > 0 && splitOnlineVal > 0)) return false;
      return (refund ? splitExact : Math.round(splitTotal * 100) === Math.round(amountRupees * 100)) && (!receiptKind || !!onlineAccountId);
    }
    return false;
  })();

  const tabs: { id: PaymentTab; label: string; icon: React.ReactNode }[] = [
    { id: "cash", label: "Cash", icon: <BanknoteIcon className="h-4 w-4 shrink-0" /> },
    { id: "online", label: "Online", icon: <SmartphoneIcon className="h-4 w-4 shrink-0" /> },
    { id: "split", label: "Split", icon: <><BanknoteIcon className="h-3.5 w-3.5 shrink-0" /><span className="text-[10px]">+</span><SmartphoneIcon className="h-3.5 w-3.5 shrink-0" /></> },
  ];

  return (
    <div className={cn("fixed inset-0 flex items-center justify-center overflow-y-auto p-4", zClass)}>
      <div className="absolute inset-0 bg-black/40" onClick={() => !saving && onClose()} />
      <div className="relative w-full min-w-0 max-w-sm rounded-2xl bg-white dark:bg-card shadow-2xl dark:shadow-none animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-brand-mist px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-brand-green-dark">{correction ? "Correct Payment Entry" : refund ? "Record Refund" : "Record Payment"}</h3>
            <p className="truncate text-xs text-brand-green-dark/50">{guestName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="shrink-0 rounded-lg p-1.5 hover:bg-brand-sand disabled:opacity-40">
            <XIcon className="h-5 w-5 text-brand-green-dark/60" />
          </button>
        </div>

        <div className="bg-brand-sand/40 px-5 py-3 text-center">
          <p className="text-xs text-brand-green-dark/60">{allowPartial ? correction ? "Maximum correctable amount" : refund ? "Refundable amount" : "Balance available" : refund ? "Refund Total" : "Bill Total"}</p>
          <p className="text-2xl font-bold text-brand-green">₹{totalRupees.toFixed(allowPartial || amountDigits === 2 ? 2 : 0)}</p>
        </div>

        <div className="flex w-full min-w-0 gap-1 border-b border-brand-mist px-3 pt-3 pb-0 sm:px-5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-t-lg px-2 py-2 text-xs font-medium transition-colors sm:gap-1.5 sm:px-4 sm:text-sm",
                activeTab === t.id
                  ? "border-b-2 border-brand-green bg-brand-green/[0.06] text-brand-green"
                  : "text-brand-green-dark/50 hover:text-brand-green-dark/70"
              )}
            >
              {t.icon} <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>

        <div className="px-5 py-4">
          {allowPartial && (
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-brand-green-dark/70">{correction ? "Amount to correct (₹)" : refund ? "Amount to refund (₹)" : "Amount to collect (₹)"}</label>
              <input type="number" inputMode="decimal" min="0.01" max={totalRupees} step="0.01" value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-brand-mist px-3 py-2.5 text-lg font-semibold text-brand-green-dark focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green" />
              <button type="button" onClick={() => setPartialAmount(totalRupees.toFixed(2))} className="mt-1 text-xs font-medium text-blue-600 underline">{correction ? "Correct full remaining amount" : refund ? "Refund full amount" : "Collect full balance"}</button>
            </div>
          )}
          {activeTab === "cash" && (
            correction ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-center dark:border-amber-800 dark:bg-amber-950/30">
                <BanknoteIcon className="mx-auto mb-2 h-8 w-8 text-amber-700" />
                <p className="text-sm text-amber-900 dark:text-amber-200">Reverse <span className="font-bold">₹{amountRupees.toFixed(2)}</span> from the original cash entry?</p>
              </div>
            ) : refund ? (
              <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 px-4 py-4 text-center">
                <BanknoteIcon className="mx-auto mb-2 h-8 w-8 text-green-600" />
                <p className="text-sm text-green-800 dark:text-green-300">
                  Give <span className="font-bold">₹{amountRupees.toFixed(allowPartial ? 2 : 0)}</span> cash?
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-brand-green-dark/70">Cash Received (₹)</label>
                  <input
                    type="number"
                    inputMode={allowPartial || amountDigits === 2 ? "decimal" : "numeric"}
                    step={allowPartial || amountDigits === 2 ? "0.01" : "1"}
                    className="w-full min-w-0 rounded-lg border border-brand-mist px-3 py-2.5 text-lg font-semibold text-brand-green-dark focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                    value={cashInput}
                    onChange={(e) => setCashInput(e.target.value)}
                    autoFocus
                  />
                </div>
                {cashValue > 0 && changeDue > 0 && (
                  <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 px-3 py-2">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-400">Change Due: ₹{changeDue.toFixed(allowPartial || amountDigits === 2 ? 2 : 0)}</p>
                  </div>
                )}
                {cashValue > 0 && changeDue < 0 && (
                  <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-3 py-2 space-y-1">
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">Remaining: ₹{Math.abs(changeDue).toFixed(allowPartial || amountDigits === 2 ? 2 : 0)}</p>
                    <button
                      type="button"
                      onClick={() => { setActiveTab("split"); setSplitCash(cashInput); }}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
                    >
                      Record remaining as Online
                    </button>
                  </div>
                )}
              </div>
            )
          )}

          {activeTab === "online" && (
            <div className="space-y-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-4 py-4 text-center">
              <SmartphoneIcon className="mx-auto mb-2 h-8 w-8 text-blue-500" />
              <p className="text-sm text-blue-800 dark:text-blue-300">
                {refund ? "Mark " : "Mark "}
                <span className="font-bold">₹{amountRupees.toFixed(allowPartial || amountDigits === 2 ? 2 : 0)}</span>
                {correction ? " from the original online entry?" : refund ? " as refunded online?" : " as paid online?"}
              </p>
              {receiptKind && <label className="block text-left text-xs font-medium text-blue-900 dark:text-blue-200">Received in
                <select value={onlineAccountId} onChange={(e) => setOnlineAccountId(e.target.value)} className="mt-1 w-full rounded border border-blue-200 bg-white px-2 py-2 text-sm text-brand-green-dark"><option value="">Select bank…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}</option>)}</select>
              </label>}
            </div>
          )}

          {activeTab === "split" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/70">Cash Amount (₹)</label>
                <input
                  type="number"
                  inputMode={allowPartial || amountDigits === 2 ? "decimal" : "numeric"}
                  step={allowPartial || amountDigits === 2 ? "0.01" : "1"}
                  className="w-full min-w-0 rounded-lg border border-brand-mist px-3 py-2.5 text-base font-semibold text-brand-green-dark focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                  value={splitCash}
                  onChange={(e) => setSplitCash(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-brand-green-dark/70">Online Amount (₹)</label>
                <input
                  type="number"
                  inputMode={allowPartial || amountDigits === 2 ? "decimal" : "numeric"}
                  step={allowPartial || amountDigits === 2 ? "0.01" : "1"}
                  readOnly
                  className="w-full min-w-0 rounded-lg border border-brand-mist bg-brand-sand/40 px-3 py-2.5 text-base font-semibold text-brand-green-dark/70 focus:outline-none"
                  value={splitOnline}
                  placeholder="0"
                />
              </div>
              <div className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium",
                (refund ? splitExact : Math.round(splitTotal * 100) === Math.round(amountRupees * 100))
                  ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
                  : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400"
              )}>
                Total: ₹{splitTotal.toFixed(allowPartial ? 2 : 0)} / ₹{amountRupees.toFixed(allowPartial ? 2 : 0)}
                {splitTotal < amountRupees && <span className="ml-1 text-xs">(₹{(amountRupees - splitTotal).toFixed(allowPartial ? 2 : 0)} short)</span>}
              </div>
              {receiptKind && <label className="block text-xs font-medium text-brand-green-dark/70">Online amount received in
                <select value={onlineAccountId} onChange={(e) => setOnlineAccountId(e.target.value)} className="mt-1 w-full rounded border border-input bg-white px-2 py-2 text-sm"><option value="">Select bank…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}</option>)}</select>
              </label>}
            </div>
          )}
          {allowPartial && (
            <label className="mt-4 block text-xs font-medium text-brand-green-dark/70">{correction ? "Reason (required)" : "Note (optional)"}
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} className="mt-1 w-full rounded-lg border border-brand-mist px-3 py-2 text-sm" placeholder="Advance received by phone…" />
            </label>
          )}
        </div>

        <div className="flex gap-2 border-t border-brand-mist px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-w-0 flex-1 rounded-lg border border-brand-mist px-4 py-2.5 text-sm font-medium text-brand-green-dark/70 hover:bg-brand-sand disabled:opacity-40"
          >
            Cancel
          </button>
          {secondaryActionLabel && onSecondaryAction && (
            <button type="button" onClick={handleSecondaryAction} disabled={saving}
              className="min-w-0 flex-1 rounded-lg border border-amber-300 px-3 py-2.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-40">
              {secondaryActionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="min-w-0 flex-1 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-40"
          >
            {saving ? "Saving..." : correction ? "Save correction" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PaymentDetailLabel({
  method, total, cashReceived, changeGiven, amountUnit = "paise",
}: {
  method: string; total: number; cashReceived: number; changeGiven: number; amountUnit?: AmountUnit;
}) {
  const fmt = (n: number) => amountUnit === "rupees"
    ? `₹${(n || 0).toLocaleString("en-IN")}`
    : `₹${((n || 0) / 100).toFixed(0)}`;
  if (method === "cash") {
    if (cashReceived > 0) {
      return <span className="text-green-700 dark:text-green-400">Cash — Received {fmt(cashReceived)}{changeGiven > 0 ? `, Change ${fmt(changeGiven)}` : ""}</span>;
    }
    return <span className="text-green-700 dark:text-green-400">Cash — {fmt(total)}</span>;
  }
  if (method === "online") {
    return <span className="text-blue-700 dark:text-blue-400">Online — {fmt(total)}</span>;
  }
  if (method === "split") {
    const cashAfterChange = cashReceived - (changeGiven || 0);
    const onlinePart = total - cashAfterChange;
    if (onlinePart <= 0) {
      return <span className="text-green-700 dark:text-green-400">Cash — Received {fmt(cashReceived)}{changeGiven > 0 ? `, Change ${fmt(changeGiven)}` : ""}</span>;
    }
    return <span className="text-purple-700 dark:text-purple-400">Split — Cash {fmt(cashAfterChange)} + Online {fmt(onlinePart)}</span>;
  }
  return <span>{method}</span>;
}
