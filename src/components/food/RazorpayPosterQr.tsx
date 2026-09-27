"use client";

import { razorpayPosterCropImgStyle } from "@/lib/razorpayPosterCrop";

/** Square viewport showing only the QR module from Razorpay's tall branded poster. */
export function RazorpayPosterQr({
  src,
  label = "Payment QR",
  maxPx = 280,
}: {
  src: string;
  label?: string;
  maxPx?: number;
}) {
  const sizeCss = `min(70vw, ${maxPx}px)`;
  return (
    <div
      className="mx-auto overflow-hidden bg-white"
      style={{ width: sizeCss, height: sizeCss, maxWidth: "100%" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Razorpay CDN poster; CSS-cropped */}
      <img
        src={src}
        alt={label}
        decoding="async"
        className="pointer-events-none select-none"
        style={razorpayPosterCropImgStyle()}
      />
    </div>
  );
}
