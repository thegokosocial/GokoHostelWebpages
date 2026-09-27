import { describe, it, expect } from "vitest";
import {
  parseBillQrMode,
  effectiveMode,
  environmentFromMode,
  qrModeReadiness,
  BILL_QR_MODE_KEY,
} from "@/lib/foodBillQrMode";

describe("parseBillQrMode", () => {
  it("returns static for null/undefined/empty", () => {
    expect(parseBillQrMode(null)).toBe("static");
    expect(parseBillQrMode(undefined)).toBe("static");
    expect(parseBillQrMode("")).toBe("static");
  });

  it("parses valid modes", () => {
    expect(parseBillQrMode("static")).toBe("static");
    expect(parseBillQrMode("razorpay_test")).toBe("razorpay_test");
    expect(parseBillQrMode("razorpay_live")).toBe("razorpay_live");
  });

  it("is case-insensitive", () => {
    expect(parseBillQrMode("RAZORPAY_TEST")).toBe("razorpay_test");
    expect(parseBillQrMode("Razorpay_Live")).toBe("razorpay_live");
    expect(parseBillQrMode("STATIC")).toBe("static");
  });

  it("trims whitespace", () => {
    expect(parseBillQrMode("  razorpay_test  ")).toBe("razorpay_test");
  });

  it("falls back to static for unknown values", () => {
    expect(parseBillQrMode("stripe")).toBe("static");
    expect(parseBillQrMode("razorpay")).toBe("static");
    expect(parseBillQrMode("live")).toBe("static");
  });
});

describe("environmentFromMode", () => {
  it("returns null for static", () => {
    expect(environmentFromMode("static")).toBeNull();
  });
  it("returns test for razorpay_test", () => {
    expect(environmentFromMode("razorpay_test")).toBe("test");
  });
  it("returns live for razorpay_live", () => {
    expect(environmentFromMode("razorpay_live")).toBe("live");
  });
});

describe("effectiveMode", () => {
  const testEnv = { RAZORPAY_TEST_KEY_ID: "rzp_test_abc123", RAZORPAY_TEST_KEY_SECRET: "secret123" };
  const liveEnv = { RAZORPAY_LIVE_KEY_ID: "rzp_live_xyz789", RAZORPAY_LIVE_KEY_SECRET: "livesecret" };

  it("static always stays static", () => {
    expect(effectiveMode("static", {})).toBe("static");
    expect(effectiveMode("static", testEnv)).toBe("static");
  });

  it("razorpay_test with valid credentials stays", () => {
    expect(effectiveMode("razorpay_test", testEnv)).toBe("razorpay_test");
  });

  it("razorpay_test without credentials falls back to static", () => {
    expect(effectiveMode("razorpay_test", {})).toBe("static");
    expect(effectiveMode("razorpay_test", { RAZORPAY_TEST_KEY_ID: "bad" })).toBe("static");
  });

  it("razorpay_live with valid credentials stays", () => {
    expect(effectiveMode("razorpay_live", liveEnv)).toBe("razorpay_live");
  });

  it("razorpay_live without credentials falls back to static", () => {
    expect(effectiveMode("razorpay_live", {})).toBe("static");
  });

  it("razorpay_test with live creds still falls back (wrong prefix)", () => {
    expect(effectiveMode("razorpay_test", liveEnv)).toBe("static");
  });
});

describe("qrModeReadiness", () => {
  it("static always ready", () => {
    expect(qrModeReadiness({}).static).toBe(true);
  });

  it("reflects test credentials", () => {
    const r = qrModeReadiness({ RAZORPAY_TEST_KEY_ID: "rzp_test_x", RAZORPAY_TEST_KEY_SECRET: "s" });
    expect(r.razorpay_test).toBe(true);
    expect(r.razorpay_live).toBe(false);
  });

  it("reflects live credentials", () => {
    const r = qrModeReadiness({ RAZORPAY_LIVE_KEY_ID: "rzp_live_x", RAZORPAY_LIVE_KEY_SECRET: "s" });
    expect(r.razorpay_test).toBe(false);
    expect(r.razorpay_live).toBe(true);
  });
});

describe("BILL_QR_MODE_KEY", () => {
  it("equals food_bill_qr_mode", () => {
    expect(BILL_QR_MODE_KEY).toBe("food_bill_qr_mode");
  });
});
