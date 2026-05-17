export type Role = "admin" | "manager";

export type AdminSection = "dashboard" | "beds" | "timeline" | "records" | "history" | "setup";

export type BedStatus = "available" | "occupied" | "cleanup";

export type BedRow = {
  dormName: string;
  bedId: string;
  position: "Upper" | "Lower" | "Single";
  type: "Bunk" | "Single";
  status: BedStatus;
  guestName: string;
  guestContact: string;
  checkinDate: string;
  expectedCheckout: string;
  stayingDays: string;
};

export const BED_HEADERS = [
  "Dorm Name", "Bed ID", "Position", "Type", "Status",
  "Guest Name", "Guest Contact", "Check-in Date", "Expected Checkout", "Staying Days",
];

export const CHECKIN_COLUMNS = [
  "Submitted At", "Arrival Date", "Arrival Time", "Name", "Persons",
  "Contact", "Days", "Coming From", "Nationality", "Emergency Contact",
  "Emergency Phone", "ID Type", "ID Card", "Visa",
];
