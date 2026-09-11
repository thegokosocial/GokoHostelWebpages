export type Role = "admin" | "manager" | "staff";
import { permissionEnabled } from "@/lib/actionPermissions";

export type AdminSection = "dashboard" | "bookings" | "beds" | "timeline" | "inventory" | "records" | "foodOrders" | "expenditure" | "splits" | "reviews" | "management";

export type ManagementTab = "dorms" | "users" | "backup" | "audit" | "logs" | "health" | "history" | "rates" | "menu" | "foodSettings" | "bulkUpload" | "qrGenerator" | "accountSettings" | "attendance" | "serverSync" | "channelManager" | "website" | "analytics" | "quickLinks";

export type BedStatus = "available" | "occupied" | "cleanup";

export type BedRow = {
  id: number;
  dormName: string;
  bedId: string;
  position: "Upper" | "Lower" | "Single";
  type: "Bunk" | "Bunk2L1U" | "Double" | "Single";
  status: BedStatus;
  guestName: string;
  guestContact: string;
  checkinDate: string;
  expectedCheckout: string;
  stayingDays: string;
};

export function parseBedRow(row: string[]): BedRow {
  return {
    id: parseInt(row[10] || "0", 10),
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

export function hasPermission(role: Role, permissions: Record<string, boolean>, key: string): boolean {
  if (role === "admin") return true;
  return permissionEnabled(permissions, key);
}

export const CHECKIN_COLUMNS = [
  "Submitted At", "Arrival Date", "Arrival Time", "Name", "Persons",
  "Contact", "Days", "Coming From", "Nationality", "Emergency Contact",
  "Emergency Phone", "Platform", "Booking ID", "ID Type", "ID Card",
  "Visa", "Verified",
];
