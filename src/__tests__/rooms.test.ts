import { describe, expect, it } from "vitest";
import { gokoStayRooms, resolveRoomGallery } from "@/content/rooms";

describe("resolveRoomGallery", () => {
  it("maps female dorms to female gallery", () => {
    expect(resolveRoomGallery("Female dorm")[0]).toContain("female-dorm-6bed");
  });

  it("maps Shiva/luxury dorms to luxury gallery", () => {
    expect(resolveRoomGallery("Shiva dorm")[0]).toContain("luxury-dorm-8bed");
    expect(resolveRoomGallery("8 bed luxury mixed dorm")[0]).toContain("luxury-dorm-8bed");
  });

  it("maps standard mixed dorms and double beds to mixed gallery", () => {
    expect(resolveRoomGallery("Dorm 1")[0]).toContain("mixed-dorm-12bed");
    expect(resolveRoomGallery("Dorm 1 - double bed")[0]).toContain("mixed-dorm-12bed");
    expect(resolveRoomGallery("Dorm 2")[0]).toContain("mixed-dorm-12bed");
  });
});

describe("gokoStayRooms", () => {
  it("lists four room types with three photos each", () => {
    expect(gokoStayRooms).toHaveLength(4);
    for (const room of gokoStayRooms) {
      expect(room.images).toHaveLength(3);
    }
  });

  it("includes female dorm and double bed dorm cards", () => {
    const ids = gokoStayRooms.map((r) => r.id);
    expect(ids).toContain("female-dorm-6bed");
    expect(ids).toContain("double-bed-dorm");
  });
});
