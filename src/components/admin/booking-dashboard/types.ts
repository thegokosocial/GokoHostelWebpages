import type { CalendarNightStatus, NightAvailability } from "@/lib/inventoryAvailability";
export type BookingStatus = "received" | "checked_in" | "checked_out" | "hold" | "guest_declined" | "no_show" | "cancelled" | "modified";

export type BookingPlatform = "booking_com" | "makemytrip" | "goibibo" | "hostelworld" | "booking_engine" | "walkin" | "direct" | "channel_manager";

export type DashboardBooking = {
  id: number;
  bookingCycle: number;
  guestName: string;
  contact: string;
  email: string;
  platform: string;
  bookingRef: string;
  cmBookingId: string;
  gokoBookingId: string;
  checkinDate: string;
  checkoutDate: string;
  roomType: string;
  ratePlan: string;
  persons: number;
  status: BookingStatus;
  source: string;
  property: string;
  specialRequests: string;
  amountBeforeTax: number;
  amountTax: number;
  amountTotal: number;
  amountPaid: number;
  paymentStatus: string;
  otaPaymentTerms?: string | null;
  otaCurrency?: string | null;
  paymentMethod?: string;
  cashReceived?: number;
  changeGiven?: number;
  amountRefunded?: number;
  refundMethod?: string;
  refundCash?: number;
  nightlyRate: number;
  currency: string;
  holdExpiresAt: string;
  cancelledAt: string;
  cancelledBy: string;
  checkedInAt: string;
  checkedInBy: string;
  checkedOutAt: string;
  checkedOutBy: string;
  noShowPmsStatus?: "not_required" | "sent" | "failed";
  noShowPmsError?: string;
  noShowPmsAttemptedAt?: string;
  createdAt: string;
  nights: number;
  balance: number;
  requestedRoomCodes?: string[];
  requestedDormIds?: number[];
  requestedDormNames?: string[];
  requestedBedCount?: number;
  requestedUnitCount?: number;
  requestedNeedLabels?: string;
  requestedNeeds?: Array<{ dormId: number; count: number; units?: number; name: string }>;
  rawData?: string;
};

export type BedAssignment = {
  id: number;
  bookingId: number;
  bedId: number;
  dormId: number;
  dormName: string;
  bedLabel: string;
  checkinDate: string;
  checkoutDate: string;
  status: "assigned" | "unassigned" | "cancelled";
  assignedBy: string;
  assignedAt: string;
  /** Assigned physical slots in this sellable unit (1 if partial double, 2 if full). */
  capacity?: number;
  physicalBedIds?: number[];
};

export type BookingHistoryEntry = {
  id: number;
  bookingId: number;
  action: string;
  details: string;
  performedBy: string;
  performedAt: string;
};

export type CalendarDorm = {
  id: number;
  name: string;
  collapsed: boolean;
  availability?: Record<string, NightAvailability>;
  beds: CalendarBed[];
};

export type CalendarBed = {
  id: number;
  bedId: string;
  dormId: number;
  dormName: string;
  availability?: Record<string, CalendarNightStatus>;
  type?: "Double" | "Bed";
  capacity?: number;
  physicalBedIds?: number[];
};

export type DateRange = {
  startDate: string;
  endDate: string;
  mode: "week" | "10days" | "30days" | "custom";
};
