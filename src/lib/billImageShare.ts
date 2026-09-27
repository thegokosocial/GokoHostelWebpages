/**
 * Client-side bill → PNG for WhatsApp attach.
 * wa.me cannot attach files; staff downloads PNG then attaches in WhatsApp.
 * Always keep the live /my-bills?t= link in the text as fallback when the
 * embedded QR later expires or is paid.
 */

import { buildBillWhatsAppDraft } from "@/lib/billShare";

/** Capture a DOM node to a PNG blob via SVG foreignObject (no extra dependency). */
export async function elementToPngBlob(el: HTMLElement, scale = 2): Promise<Blob> {
  const width = Math.max(1, Math.ceil(el.scrollWidth));
  const height = Math.max(1, Math.ceil(el.scrollHeight));
  const cloned = el.cloneNode(true) as HTMLElement;
  cloned.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  cloned.style.width = `${width}px`;
  cloned.style.height = `${height}px`;
  cloned.style.background = "#ffffff";

  const serialized = new XMLSerializer().serializeToString(cloned);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}">
    <foreignObject width="100%" height="100%" transform="scale(${scale})">
      ${serialized}
    </foreignObject>
  </svg>`;
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png");
    });
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not render bill image"));
    img.src = src;
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Prefer native share with file when available; otherwise download PNG + return WhatsApp text draft. */
export async function shareBillImage(opts: {
  element: HTMLElement;
  guestPhone: string | null | undefined;
  guestName: string;
  shareUrl: string;
  filename?: string;
}): Promise<{ mode: "share" | "download"; whatsappDraft: { phone: string; message: string } | null }> {
  const blob = await elementToPngBlob(opts.element);
  const filename = opts.filename || `goko-bill-${Date.now()}.png`;
  const draft = buildBillWhatsAppDraft({
    guestPhone: opts.guestPhone,
    guestName: opts.guestName,
    shareUrl: opts.shareUrl,
  });
  const file = new File([blob], filename, { type: "image/png" });
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (nav && typeof nav.share === "function" && (!nav.canShare || nav.canShare({ files: [file] }))) {
    try {
      await nav.share({
        files: [file],
        text: draft?.message,
        title: "Goko food bill",
      });
      return { mode: "share", whatsappDraft: draft };
    } catch {
      /* fall through to download */
    }
  }
  downloadBlob(blob, filename);
  return { mode: "download", whatsappDraft: draft };
}
