import { describe, expect, it } from "vitest";
import { checkinSchema, isForeignNationality } from "@/lib/checkinSchema";

const baseCheckin = {
  bookingPlatform: "Walk-in" as const,
  arrivalDate: "2026-09-11",
  arrivalTime: "12:00",
  firstName: "Jean",
  lastName: "Dupont",
  numberOfPersons: "1",
  contactNumber: "1234567890",
  stayingDays: "2",
  comingFrom: "Paris",
  nationality: "France",
  emergencyName: "Marie Dupont",
  emergencyPhone: "0987654321",
  idImages: [{ size: 1 }],
  visaImages: [{ size: 1 }],
  arrivedFromCountry: "France",
  purposeOfVisit: "Tourism",
};

describe("check-in nationality ID rules", () => {
  it("recognizes India case-insensitively", () => {
    expect(isForeignNationality("India")).toBe(false);
    expect(isForeignNationality("india")).toBe(false);
    expect(isForeignNationality("France")).toBe(true);
  });

  it("requires a booking platform but allows an optional booking ID", () => {
    const withoutBookingId = checkinSchema.safeParse({ ...baseCheckin, nationality: "India", idType: "aadhaar", bookingPlatform: "Booking.com", bookingId: "" });
    expect(withoutBookingId.success).toBe(true);

    const withoutPlatform = checkinSchema.safeParse({ ...baseCheckin, nationality: "India", idType: "aadhaar", bookingPlatform: undefined, bookingId: "" });
    expect(withoutPlatform.success).toBe(false);
    if (!withoutPlatform.success) expect(withoutPlatform.error.issues.some((issue) => issue.path[0] === "bookingPlatform")).toBe(true);
  });

  it("allows all supported ID types for Indian guests", () => {
    for (const idType of ["aadhaar", "driving_licence", "passport"] as const) {
      expect(checkinSchema.safeParse({ ...baseCheckin, nationality: "India", visaImages: [], idType }).success).toBe(true);
    }
  });

  it("allows a one-character last name", () => {
    expect(checkinSchema.safeParse({ ...baseCheckin, nationality: "India", idType: "aadhaar", visaImages: [], lastName: "S" }).success).toBe(true);
    expect(checkinSchema.safeParse({ ...baseCheckin, nationality: "India", idType: "aadhaar", visaImages: [], lastName: " " }).success).toBe(false);
  });

  it("requires a passport for non-Indian guests", () => {
    const result = checkinSchema.safeParse({ ...baseCheckin, idType: "aadhaar" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === "idType")).toBe(true);
  });

  it("accepts a passport for non-Indian guests", () => {
    expect(checkinSchema.safeParse({ ...baseCheckin, idType: "passport" }).success).toBe(true);
  });

  it("requires visa files for non-Indian guests", () => {
    const result = checkinSchema.safeParse({ ...baseCheckin, idType: "passport", visaImages: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === "visaImages")).toBe(true);
  });
});
