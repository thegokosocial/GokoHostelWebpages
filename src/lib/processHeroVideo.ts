import type { HeroVideoSlot } from "@/lib/heroVideos";

export type ProcessedHeroVideo = {
  video: Blob;
  poster: Blob;
  width: number;
  height: number;
  bytes: number;
};

export const HERO_ENCODE_LIMITS = {
  desktop: { width: 1024, height: 576, maxBytes: 8 * 1024 * 1024 },
  mobile: { width: 324, height: 576, maxBytes: 4 * 1024 * 1024 },
} as const;

const SOURCE_MAX = 200 * 1024 * 1024;

export function heroEncodeMaxBytes(slot: HeroVideoSlot): number {
  return HERO_ENCODE_LIMITS[slot].maxBytes;
}

/** Reject oversized encodes before upload (desktop 8MB / mobile 4MB). */
export function assertHeroEncodedSize(bytes: number, slot: HeroVideoSlot): void {
  const max = heroEncodeMaxBytes(slot);
  if (bytes > max) {
    const mb = Math.round(max / (1024 * 1024));
    throw new Error(
      slot === "mobile"
        ? `Encoded mobile video is over ${mb}MB. Use a shorter clip.`
        : `Encoded desktop video is over ${mb}MB. Use a shorter clip.`,
    );
  }
}

type ProgressFn = (phase: "loading" | "encoding" | "poster", detail?: string) => void;

async function loadFfmpeg(onProgress?: ProgressFn) {
  onProgress?.("loading", "Loading video encoder…");
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { toBlobURL } = await import("@ffmpeg/util");
  const ffmpeg = new FFmpeg();
  const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
  });
  return ffmpeg;
}

/**
 * Encode a source clip to the hero desktop or mobile MP4 profile + JPEG poster.
 * Admin-only; lazily loads ffmpeg.wasm (~31MB) once per session.
 */
export async function processHeroVideo(
  file: File,
  slot: HeroVideoSlot,
  onProgress?: ProgressFn,
): Promise<ProcessedHeroVideo> {
  if (!file || file.size === 0) throw new Error("Choose a video file");
  if (file.size > SOURCE_MAX) throw new Error("Source video is too large (max 200MB). Trim or compress it first.");
  const target = HERO_ENCODE_LIMITS[slot];
  const { fetchFile } = await import("@ffmpeg/util");
  const ffmpeg = await loadFfmpeg(onProgress);

  const inputName = "input" + (file.name.match(/\.[a-z0-9]+$/i)?.[0] || ".mp4");
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  onProgress?.("encoding", slot === "mobile" ? "Encoding mobile clip…" : "Encoding desktop clip…");
  const scaleFilter =
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase,` +
    `crop=${target.width}:${target.height},fps=24`;

  const code = await ffmpeg.exec([
    "-i", inputName,
    "-vf", scaleFilter,
    "-an",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "28",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-t", "30",
    "out.mp4",
  ]);
  if (code !== 0) throw new Error("Could not encode video. Try an MP4/MOV file.");

  const outData = await ffmpeg.readFile("out.mp4");
  if (!(outData instanceof Uint8Array) || outData.byteLength === 0) {
    throw new Error("Encoder produced an empty file");
  }
  assertHeroEncodedSize(outData.byteLength, slot);

  onProgress?.("poster", "Extracting poster…");
  const posterCode = await ffmpeg.exec([
    "-ss", "0.4",
    "-i", "out.mp4",
    "-frames:v", "1",
    "-q:v", "4",
    "poster.jpg",
  ]);
  if (posterCode !== 0) throw new Error("Could not extract poster frame");
  const posterData = await ffmpeg.readFile("poster.jpg");
  if (!(posterData instanceof Uint8Array) || posterData.byteLength === 0) {
    throw new Error("Poster extract failed");
  }

  try {
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile("out.mp4");
    await ffmpeg.deleteFile("poster.jpg");
  } catch {
    /* ignore cleanup */
  }

  // .slice() copies off any SharedArrayBuffer-backed view from ffmpeg.wasm
  const video = new Blob([outData.slice()], { type: "video/mp4" });
  const poster = new Blob([posterData.slice()], { type: "image/jpeg" });
  return {
    video,
    poster,
    width: target.width,
    height: target.height,
    bytes: video.size,
  };
}
