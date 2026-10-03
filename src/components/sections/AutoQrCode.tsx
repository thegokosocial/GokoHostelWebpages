"use client";

import { useEffect, useState } from "react";

type Props = {
  data: string;
  label: string;
  /** CSS max edge length in px (default 360). */
  maxPx?: number;
};

export async function foodBillQrDataUrl(data: string): Promise<string> {
  const { default: QRCodeStyling } = await import("qr-code-styling");
  const qr = new QRCodeStyling({ width: 600, height: 600, margin: 18, data,
    dotsOptions: { type: "rounded", color: "#1a3d2a" }, backgroundOptions: { color: "#ffffff" },
    cornersSquareOptions: { type: "extra-rounded" }, cornersDotOptions: { type: "dot" }, qrOptions: { errorCorrectionLevel: "H" } });
  const raw = await qr.getRawData("png");
  if (!raw) return "";
  const blob = raw instanceof Blob ? raw : new Blob([raw as unknown as ArrayBuffer]);
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : ""); reader.onerror = () => resolve(""); reader.readAsDataURL(blob); });
}

export function AutoQrCode({ data, label, maxPx = 360 }: Props) {
  const [src, setSrc] = useState("");
  const sizeCss = `min(70vw, ${maxPx}px)`;

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    import("qr-code-styling")
      .then(async ({ default: QRCodeStyling }) => {
        const qr = new QRCodeStyling({
          width: 600,
          height: 600,
          margin: 18,
          data,
          dotsOptions: { type: "rounded", color: "#1a3d2a" },
          backgroundOptions: { color: "#ffffff" },
          cornersSquareOptions: { type: "extra-rounded" },
          cornersDotOptions: { type: "dot" },
          qrOptions: { errorCorrectionLevel: "H" },
        });
        const raw = await qr.getRawData("png");
        if (cancelled || !raw) return;

        const blob = raw instanceof Blob ? raw : new Blob([raw as unknown as ArrayBuffer]);
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data]);

  if (!src) {
    return (
      <div
        className="mx-auto animate-pulse rounded-lg bg-brand-mist/30"
        style={{ width: sizeCss, height: sizeCss }}
        aria-label={`Generating ${label}`}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- blob URL from qr-code-styling
    <img
      src={src}
      alt={label}
      loading="lazy"
      className="mx-auto bg-white object-contain p-2"
      style={{ width: sizeCss, height: sizeCss, maxWidth: "100%" }}
    />
  );
}
