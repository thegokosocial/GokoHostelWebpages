import { cropRect, SITE_IMAGE_TARGETS, type SiteImageKind } from "./cropRect";

const JPEG_QUALITY = 0.82;
const MAX_DECODE_EDGE = 2400;

export async function processSiteImage(file: File, kind: SiteImageKind): Promise<Blob> {
  const target = SITE_IMAGE_TARGETS[kind];
  let bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (bitmap.width < 300 || bitmap.height < 300) throw new Error("Photo is too small. Use an image at least 300 × 300 pixels.");
    const edge = Math.max(bitmap.width, bitmap.height);
    if (edge > MAX_DECODE_EDGE) {
      const scale = MAX_DECODE_EDGE / edge;
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
        resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
      });
      bitmap.close();
      bitmap = resized;
    }

    const { sx, sy, sw, sh } = cropRect(bitmap.width, bitmap.height, target.width, target.height);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process image");
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not encode image"))),
        "image/jpeg",
        JPEG_QUALITY,
      );
    });
    return blob;
  } finally {
    bitmap.close();
  }
}
