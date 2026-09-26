import { describe, expect, it } from "vitest";
import { formatTimeSince } from "@/lib/formatTimeSince";

const now = Date.parse("2026-09-26T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("formatTimeSince", () => {
  it("uses minutes under one hour", () => {
    expect(formatTimeSince(ago(30_000), now)).toBe("<1m");
    expect(formatTimeSince(ago(5 * 60_000), now)).toBe("5m");
    expect(formatTimeSince(ago(59 * 60_000), now)).toBe("59m");
  });

  it("uses hours and minutes under 24 hours", () => {
    expect(formatTimeSince(ago(60 * 60_000), now)).toBe("1h");
    expect(formatTimeSince(ago(90 * 60_000), now)).toBe("1h 30m");
    expect(formatTimeSince(ago(23 * 60 * 60_000 + 57 * 60_000), now)).toBe("23h 57m");
  });

  it("switches to days and hours at 24 hours and beyond (no minutes)", () => {
    expect(formatTimeSince(ago(24 * 60 * 60_000), now)).toBe("1d");
    expect(formatTimeSince(ago(25 * 60 * 60_000), now)).toBe("1d 1h");
    expect(formatTimeSince(ago(111 * 60 * 60_000 + 28 * 60_000), now)).toBe("4d 15h");
    expect(formatTimeSince(ago(48 * 60 * 60_000 + 5 * 60_000), now)).toBe("2d");
    expect(formatTimeSince(ago(327 * 60 * 60_000 + 19 * 60_000), now)).toBe("13d 15h");
  });

  it("treats invalid or future timestamps as under one minute", () => {
    expect(formatTimeSince("not-a-date", now)).toBe("<1m");
    expect(formatTimeSince(new Date(now + 60_000).toISOString(), now)).toBe("<1m");
  });
});
