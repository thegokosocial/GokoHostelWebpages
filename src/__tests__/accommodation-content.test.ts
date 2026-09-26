import { describe, expect, it } from "vitest";
import SQLite from "better-sqlite3";
import { readFileSync } from "node:fs";
import { legacyRoomPhotos, propertyContentInputSchema, publicAccommodationContent, roomContentInputSchema, safeStringList, sanitizePhotoList } from "@/lib/accommodationContent";
import { directBookingRate } from "@/lib/bookingPricing";

describe("accommodation content validation", () => {
  it("sanitizes, de-duplicates and caps guest-facing galleries", () => {
    expect(sanitizePhotoList(["/images/a.jpg", "/images/a.jpg", "javascript:bad", "/api/media/rooms/b.jpg"])).toEqual(["/images/a.jpg", "/api/media/rooms/b.jpg"]);
  });
  it("keeps legacy room photos until a room has saved content", () => {
    expect(legacyRoomPhotos("Female dorm")[0]).toContain("female-dorm");
  });
  it("publishes only mapped guest content and strips internal metadata", () => {
    const result = publicAccommodationContent({
      rooms: [
        { dormId: 1, operationalName: "Internal A", publicName: "Guest A", description: "A", amenities: [], roomPhotos: ["/images/a.jpg"], washroomPhotos: [], revision: "secret-a", mapped: true },
        { dormId: 2, operationalName: "Internal B", publicName: "Guest B", description: "B", amenities: [], roomPhotos: [], washroomPhotos: [], revision: "secret-b", mapped: false },
      ],
      property: { exteriorPhotos: [], commonPhotos: [], washroomPhotos: [], revision: "secret-property" },
    });
    expect(result.rooms).toEqual([{ publicName: "Guest A", description: "A", amenities: [], roomPhotos: ["/images/a.jpg"], washroomPhotos: [] }]);
    expect(JSON.stringify(result)).not.toMatch(/Internal|revision|secret|dormId/);
  });
  it("rounds direct rates per night and preserves a minimum ₹1 rate", () => {
    expect(directBookingRate(999, 10)).toBe(899);
    expect(directBookingRate(1, 80)).toBe(1);
    expect(directBookingRate(500, 0)).toBe(500);
  });
  it("validates bounded room and property drafts", () => {
    expect(roomContentInputSchema.safeParse({ dormId: 1, publicName: "Female dorm", description: "Quiet", amenities: ["Locker"], roomPhotos: [], washroomPhotos: [], revision: "missing" }).success).toBe(true);
    expect(roomContentInputSchema.safeParse({ dormId: 1, publicName: "Room", description: "", amenities: [], roomPhotos: Array(9).fill("/images/a.jpg"), washroomPhotos: [], revision: "missing" }).success).toBe(false);
    expect(propertyContentInputSchema.safeParse({ exteriorPhotos: [], commonPhotos: [], washroomPhotos: [], revision: "missing" }).success).toBe(true);
    expect(safeStringList("not-json")).toEqual([]);
  });
  it("applies the accommodation migration to a production-shaped database", () => {
    const sqlite = new SQLite(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec("CREATE TABLE dorms (id INTEGER PRIMARY KEY NOT NULL)");
    sqlite.exec("INSERT INTO dorms (id) VALUES (1)");
    sqlite.exec(readFileSync("migrations/0078_accommodation_content.sql", "utf8"));
    expect(sqlite.prepare("SELECT id, exterior_photos FROM site_property_content").get()).toEqual({ id: 1, exterior_photos: "[]" });
    sqlite.prepare("INSERT INTO site_room_content (dorm_id, amenities) VALUES (?, ?)").run(1, '["Locker"]');
    expect(() => sqlite.prepare("UPDATE site_room_content SET amenities = 'bad' WHERE dorm_id = 1").run()).toThrow();
    sqlite.close();
  });
});
