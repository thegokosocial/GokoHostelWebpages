"use client";

import { useEffect, useState } from "react";

type Props = {
  data: string;
  label: string;
};

export function AutoQrCode({ data, label }: Props) {
  const [src, setSrc] = useState("");

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
    return <div className="h-[min(80vw,420px)] w-full max-w-[360px] animate-pulse rounded-lg bg-brand-mist/30" aria-label={`Generating ${label}`} />;
  }

  return <img src={src} alt={label} loading="lazy" className="h-auto w-auto max-w-full object-contain" style={{ width: "min(100%, 360px)", maxHeight: "min(80vw, 420px)" }} />;
}
