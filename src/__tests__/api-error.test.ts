import { describe, expect, it } from "vitest";
import { apiErrorBody, codeForStatus, normalizeApiError, retryableForCode, serializeSafeErrorDetails } from "@/lib/apiError";

describe("API error diagnostics", () => {
  it("maps HTTP statuses without changing the legacy error message", () => {
    const body = apiErrorBody({
      error: "City and dates are required",
      code: "VALIDATION_ERROR",
      requestId: "req-1",
      action: "startRateScrape",
      stage: "request_validation",
      field: "startDate",
    });

    expect(body).toMatchObject({
      error: "City and dates are required",
      code: "VALIDATION_ERROR",
      requestId: "req-1",
      action: "startRateScrape",
      stage: "request_validation",
      field: "startDate",
      retryable: false,
    });
    expect(codeForStatus(503)).toBe("UPSTREAM_ERROR");
  });

  it("normalizes response headers and legacy booking debug fields", () => {
    const response = new Response(null, { status: 500, headers: { "x-goko-request-id": "req-2" } });
    const error = normalizeApiError({
      response,
      data: { error: "Database temporarily unavailable.", debug: { stage: "database_read" } },
      action: "getCalendarData",
      endpoint: "/api/admin/bookings",
    });

    expect(error).toMatchObject({
      message: "Database temporarily unavailable.",
      code: "INTERNAL_ERROR",
      action: "getCalendarData",
      stage: "database_read",
      requestId: "req-2",
      status: 500,
      endpoint: "/api/admin/bookings",
      retryable: true,
    });
  });

  it("classifies network failures as retryable", () => {
    const error = normalizeApiError({ error: new TypeError("Failed to fetch"), action: "createBooking" });
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.retryable).toBe(true);
    expect(retryableForCode("VALIDATION_ERROR")).toBe(false);
  });

  it("serializes only normalized safe diagnostics", () => {
    const serialized = serializeSafeErrorDetails({
      message: "Nope",
      code: "INTERNAL_ERROR",
      retryable: false,
      details: { operation: "read", count: 2 },
    });
    expect(serialized).toContain('"code":"INTERNAL_ERROR"');
    expect(serialized).not.toContain("password");
  });
});
