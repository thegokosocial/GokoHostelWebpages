import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rooms = readFileSync("src/components/sections/StayRoomsLive.tsx", "utf8");
const card = readFileSync("src/components/sections/CardWithModal.tsx", "utf8");

describe("mobile stay room recovery", () => {
  it("keeps the static room cards visible while optional CMS content refreshes", () => {
    expect(rooms).toContain("useState<StayCard[]>(fallbackRooms)");
    expect(rooms).not.toContain("<Reveal");
    expect(rooms).toContain("Showing saved room details while live updates reconnect.");
    expect(rooms).toContain("Retry");
  });

  it("uses a native room trigger and a bottom-sheet detail view on phones", () => {
    expect(card).toContain("View photos and details for ${room.name}");
    expect(card).toContain("<button type=\"button\"");
    expect(card).toContain("bottom-0");
    expect(card).toContain("max-h-[92dvh]");
    expect(card).toContain("Book this room");
    expect(card).toContain('className="w-full sm:w-auto"');
  });
});
