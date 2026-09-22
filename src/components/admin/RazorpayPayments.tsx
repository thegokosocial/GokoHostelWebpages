"use client";

import { useState } from "react";
import { WebsitePaymentsLedger } from "@/components/admin/WebsitePaymentsLedger";
import {
  managementSectionTabActiveClass,
  managementSectionTabClass,
  managementSectionTabsClass,
  managementSectionTabInactiveClass,
} from "./managementSectionTabs";

type PaymentTab = "room" | "food";

export function RazorpayPayments({ password, username }: { password: string; username?: string }) {
  const [tab, setTab] = useState<PaymentTab>("room");

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-display text-xl font-bold text-brand-green md:text-2xl">Razorpay payments</h3>
        <p className="mt-1 text-sm text-muted-foreground">Payment records by business area.</p>
      </div>
      <nav aria-label="Razorpay payment tabs" className={managementSectionTabsClass}>
        {([['room', 'Room'], ['food', 'Food']] as const).map(([id, label]) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`${managementSectionTabClass} ${tab === id ? managementSectionTabActiveClass : managementSectionTabInactiveClass}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "room" ? (
        <WebsitePaymentsLedger password={password} username={username} />
      ) : (
        <section className="rounded-xl border border-border p-6 text-center">
          <h4 className="font-semibold text-foreground">Food payments</h4>
          <p className="mt-1 text-sm text-muted-foreground">Food payment records will be available here soon.</p>
        </section>
      )}
    </div>
  );
}
