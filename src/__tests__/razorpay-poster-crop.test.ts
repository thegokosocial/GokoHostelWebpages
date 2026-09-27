import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  RAZORPAY_POSTER_ASPECT_HW,
  RAZORPAY_POSTER_QR_CROP,
  RAZORPAY_POSTER_SAMPLE,
  razorpayPosterCropImgStyle,
  razorpayPosterCropIsSane,
} from "@/lib/razorpayPosterCrop";

describe("razorpayPosterCrop", () => {
  it("keeps calibrated crop inside the sample poster and sane", () => {
    expect(RAZORPAY_POSTER_SAMPLE.width).toBe(419);
    expect(RAZORPAY_POSTER_SAMPLE.height).toBe(1024);
    expect(RAZORPAY_POSTER_ASPECT_HW).toBeCloseTo(1024 / 419, 5);
    expect(razorpayPosterCropIsSane()).toBe(true);
    expect(RAZORPAY_POSTER_QR_CROP.width).toBeGreaterThan(0.5);
    expect(RAZORPAY_POSTER_QR_CROP.height).toBeLessThan(0.4);
  });

  it("emits cover-style margins so the QR module fills a square frame", () => {
    const style = razorpayPosterCropImgStyle();
    expect(style.width).toBe(`${100 / RAZORPAY_POSTER_QR_CROP.width}%`);
    expect(style.height).toBe("auto");
    expect(style.maxWidth).toBe("none");
    expect(parseFloat(style.marginLeft)).toBeLessThan(0);
    expect(parseFloat(style.marginTop)).toBeLessThan(0);
    // Horizontal: left edge of crop maps to frame origin.
    expect(parseFloat(style.marginLeft)).toBeCloseTo(
      (-100 * RAZORPAY_POSTER_QR_CROP.left) / RAZORPAY_POSTER_QR_CROP.width,
      5,
    );
  });

  it("rejects nonsense crop boxes", () => {
    expect(razorpayPosterCropIsSane({ left: -0.1, top: 0.3, width: 0.5, height: 0.3 })).toBe(false);
    expect(razorpayPosterCropIsSane({ left: 0.1, top: 0.1, width: 0.05, height: 0.3 })).toBe(false);
    expect(razorpayPosterCropIsSane({ left: 0.5, top: 0.5, width: 0.6, height: 0.6 })).toBe(false);
  });

  it("RazorpayPosterQr uses crop helper without canvas decode", () => {
    const src = readFileSync("src/components/food/RazorpayPosterQr.tsx", "utf8");
    expect(src).toContain("razorpayPosterCropImgStyle");
    expect(src).toContain("overflow-hidden");
    expect(src).not.toContain("jsQR");
    expect(src).not.toContain("crossOrigin");
  });
});
