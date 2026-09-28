#!/usr/bin/env node
/**
 * Copy the unbundled ffmpeg worker (+ deps) into public/ffmpeg/.
 * Next/webpack must not bundle worker.js — it rewrites import(coreURL) and
 * breaks blob:/CDN cores with "Cannot find module 'blob:…'".
 *
 * Do NOT copy ffmpeg-core.wasm here: ~31MB exceeds Cloudflare Workers'
 * 25 MiB static-asset limit. Core stays on CDN (see processHeroVideo).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "ffmpeg");

function mustExist(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing ffmpeg asset: ${path}`);
  }
}

mkdirSync(outDir, { recursive: true });

const ffmpegEsm = join(root, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm");

for (const name of ["const.js", "errors.js"]) {
  const src = join(ffmpegEsm, name);
  mustExist(src);
  copyFileSync(src, join(outDir, name));
}

const workerSrc = join(ffmpegEsm, "worker.js");
mustExist(workerSrc);
let worker = readFileSync(workerSrc, "utf8");
// Published worker only has @vite-ignore; keep webpackIgnore if anyone rebundles.
if (!worker.includes("webpackIgnore")) {
  worker = worker.replace(
    /await import\(\s*(?:\/\*[\s\S]*?\*\/\s*)*/g,
    "await import(\n        /* webpackIgnore: true */ /* @vite-ignore */ ",
  );
}
writeFileSync(join(outDir, "worker.js"), worker, "utf8");

// Remove accidental oversized core copies from earlier iterations.
for (const stale of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  const path = join(outDir, stale);
  if (existsSync(path)) unlinkSync(path);
}

console.log("ffmpeg assets → public/ffmpeg/ (worker only; core via CDN)");
