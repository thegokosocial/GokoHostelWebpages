/**
 * CSS crop of Razorpay's branded tall QR poster down to the payable square module.
 * Calibrated on a live rzp.io poster (419×1024): white card QR ~16.7–82.8% × 38.1–65.1%.
 * Prefer notes.upiIntent / image_content when Razorpay enables qr_image_content.
 */

export const RAZORPAY_POSTER_SAMPLE = { width: 419, height: 1024 } as const;

/** height / width of the standard Razorpay UPI QR poster. */
export const RAZORPAY_POSTER_ASPECT_HW =
  RAZORPAY_POSTER_SAMPLE.height / RAZORPAY_POSTER_SAMPLE.width;

/** Fractional crop box in image space (0–1), inclusive of a small quiet-zone pad. */
export const RAZORPAY_POSTER_QR_CROP = {
  left: 0.167,
  top: 0.381,
  width: 0.661,
  height: 0.27,
} as const;

export type RazorpayPosterCropBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Inline styles for an <img> inside a square overflow-hidden frame. */
export function razorpayPosterCropImgStyle(
  crop: RazorpayPosterCropBox = RAZORPAY_POSTER_QR_CROP,
  aspectHW: number = RAZORPAY_POSTER_ASPECT_HW,
): {
  width: string;
  height: "auto";
  maxWidth: "none";
  marginLeft: string;
  marginTop: string;
  display: "block";
} {
  const w = crop.width > 0 ? crop.width : 1;
  // margin-% is relative to the containing block's width (the square frame).
  return {
    width: `${100 / w}%`,
    height: "auto",
    maxWidth: "none",
    marginLeft: `${(-100 * crop.left) / w}%`,
    marginTop: `${((-100 * crop.top) / w) * aspectHW}%`,
    display: "block",
  };
}

export function razorpayPosterCropIsSane(crop: RazorpayPosterCropBox = RAZORPAY_POSTER_QR_CROP): boolean {
  return crop.left >= 0 && crop.top >= 0
    && crop.width > 0.2 && crop.width <= 1
    && crop.height > 0.1 && crop.height <= 1
    && crop.left + crop.width <= 1.001
    && crop.top + crop.height <= 1.001;
}
