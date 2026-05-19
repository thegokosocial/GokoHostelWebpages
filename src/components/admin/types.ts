export type Role = "admin" | "manager";

export type AdminSection = "dashboard" | "beds" | "timeline" | "records" | "history" | "setup" | "stats";

export type BedStatus = "available" | "occupied" | "cleanup";

export type BedRow = {
  dormName: string;
  bedId: string;
  position: "Upper" | "Lower" | "Single";
  type: "Bunk" | "Bunk2L1U" | "Single";
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

export function parseBedRow(row: string[]): BedRow {
  return {
    dormName: row[0] || "",
    bedId: row[1] || "",
    position: (row[2] || "Lower") as BedRow["position"],
    type: (row[3] || "Bunk") as BedRow["type"],
    status: (row[4] || "available") as BedRow["status"],
    guestName: row[5] || "",
    guestContact: row[6] || "",
    checkinDate: row[7] || "",
    expectedCheckout: row[8] || "",
    stayingDays: row[9] || "",
  };
}

export const CHECKIN_COLUMNS = [
  "Submitted At", "Arrival Date", "Arrival Time", "Name", "Persons",
  "Contact", "Days", "Coming From", "Nationality", "Emergency Contact",
  "Emergency Phone", "ID Type", "ID Card", "Visa", "Verified",
];
