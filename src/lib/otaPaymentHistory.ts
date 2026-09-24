/** Redundant booking_history actions superseded by booking_payment_events in Booking Detail. */
export const OTA_MONEY_HISTORY_ACTIONS = [
  "OTA Payment Collected",
  "OTA Payment Refunded",
  "OTA Payment Corrected",
] as const;

export type OtaMoneyHistoryAction = (typeof OTA_MONEY_HISTORY_ACTIONS)[number];

export function isRedundantOtaMoneyHistoryAction(action: string | null | undefined): boolean {
  return OTA_MONEY_HISTORY_ACTIONS.includes(action as OtaMoneyHistoryAction);
}
