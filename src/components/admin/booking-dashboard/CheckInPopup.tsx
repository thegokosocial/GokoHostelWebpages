"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { overlayVariants, modalVariants } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { CreditCardIcon, ClockIcon } from "lucide-react";
import { formatCurrency, collectionCopy } from "./utils";
import { stayDueAtHotel } from "@/lib/stayPayment";
import { RecordPaymentModal } from "@/components/admin/RecordPaymentModal";
import type { DashboardBooking } from "./types";

export function CheckInPopup({
  booking,
  password,
  username,
  onConfirm,
  onCancel,
}: {
  booking: DashboardBooking;
  password: string;
  username?: string;
  onConfirm: (collectPayment: boolean, extra?: Record<string, unknown>) => Promise<boolean | void>;
  onCancel: () => void;
}) {
  const [showPay, setShowPay] = useState(false);
  const due = stayDueAtHotel(booking.paymentStatus, booking.amountTotal, booking.amountPaid, booking.amountRefunded);
  const collection = collectionCopy(booking.paymentStatus, due);
  const offerCollect = due > 0;
  const paymentDone = !!collection && !collection.due;

  return (
    <AnimatePresence>
      <motion.div
        key="checkin-overlay"
        variants={overlayVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/30 p-4 backdrop-blur-sm"
        onClick={onCancel}
      >
        <motion.div
          key="checkin-modal"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="w-full min-w-0 max-w-sm rounded-2xl border border-border bg-popover p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="font-heading text-base font-medium text-foreground">Check In Guest</h3>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {booking.guestName}
          </p>

          {paymentDone && collection ? (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-center dark:border-green-800 dark:bg-green-900/20">
              <p className="text-xs text-green-600 dark:text-green-400">{collection.label}</p>
              <p className="mt-1 break-words text-lg font-semibold text-green-700 dark:text-green-300">{collection.value}</p>
              {collection.value === "Prepaid" && (
                <p className="mt-1 text-[11px] text-green-600 dark:text-green-400">Adds to stay revenue on check-in</p>
              )}
            </div>
          ) : offerCollect ? (
            <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-center dark:border-orange-800 dark:bg-orange-900/20">
              <p className="text-xs text-orange-600 dark:text-orange-400">{collection?.label || "Balance Due"}</p>
              <p className="mt-1 break-words text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-300">
                {formatCurrency(due)}
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-center dark:border-green-800 dark:bg-green-900/20">
              <p className="text-sm font-medium text-green-700 dark:text-green-300">Fully Paid</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {offerCollect && (
              <Button
                className="min-w-0 flex-1"
                size="sm"
                onClick={() => setShowPay(true)}
              >
                <CreditCardIcon className="size-3.5" />
                Collected
              </Button>
            )}
            <Button
              className="min-w-0 flex-1"
              size="sm"
              variant={offerCollect ? "outline" : "default"}
              onClick={() => onConfirm(false)}
            >
              {offerCollect ? (
                <>
                  <ClockIcon className="size-3.5" />
                  Later
                </>
              ) : (
                "Check In"
              )}
            </Button>
          </div>

          <button
            type="button"
            onClick={onCancel}
            className="mt-3 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </motion.div>
      </motion.div>

      {showPay && (
        <RecordPaymentModal
          totalAmount={due}
          guestName={booking.guestName}
          amountUnit="rupees"
          zClass="z-[70]"
          password={password} username={username} receiptKind="room"
          onConfirm={async (method, cashReceived, changeGiven, onlineAccountId, receiptId, _amount, operationId) => {
            const ok = await onConfirm(true, { paymentMethod: method, cashReceived, changeGiven, onlineAccountId, receiptId, operationId });
            if (ok) setShowPay(false);
            return ok;
          }}
          onClose={() => setShowPay(false)}
        />
      )}
    </AnimatePresence>
  );
}
