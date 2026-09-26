import { describe, expect, it } from "vitest";
import { isUniqueConstraintError, parseCreateIdempotencyKey } from "@/lib/createIdempotency";

describe("parseCreateIdempotencyKey", () => {
  it("requires a non-empty string", () => {
    expect(parseCreateIdempotencyKey(undefined)).toEqual({ error: "idempotencyKey required" });
    expect(parseCreateIdempotencyKey("")).toEqual({ error: "idempotencyKey required" });
    expect(parseCreateIdempotencyKey("   ")).toEqual({ error: "idempotencyKey required" });
  });

  it("rejects non-UUID strings", () => {
    expect(parseCreateIdempotencyKey("guest-key-1")).toEqual({ error: "idempotencyKey must be a UUID" });
  });

  it("accepts a UUID", () => {
    const key = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseCreateIdempotencyKey(key)).toEqual({ key });
  });
});

describe("isUniqueConstraintError", () => {
  it("detects UNIQUE messages", () => {
    expect(isUniqueConstraintError(new Error("UNIQUE constraint failed: food_orders.idempotency_key"))).toBe(true);
    expect(isUniqueConstraintError(new Error("D1_ERROR: unique"))).toBe(true);
    expect(isUniqueConstraintError(new Error("something else"))).toBe(false);
  });
});
