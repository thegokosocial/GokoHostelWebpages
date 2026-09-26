"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon, ImagePlusIcon, Loader2Icon, StarIcon, UploadIcon, XIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { isMediaUrl } from "@/lib/mediaKeys";
import { processSiteImage } from "@/lib/processSiteImage";
import type { SiteImageKind } from "@/lib/cropRect";
import { SITE_GALLERY_MAX } from "@/lib/siteCopy";
import { cn } from "@/lib/utils";

type UploadOpts = {
  kind: SiteImageKind;
  folder: "events" | "community" | "heroes" | "rooms" | "menu";
  password: string;
  username?: string;
};

async function uploadProcessedImage(file: File, opts: UploadOpts): Promise<string> {
  const blob = await processSiteImage(file, opts.kind);
  const fd = new FormData();
  fd.append("file", blob, "image.jpg");
  fd.append("password", opts.password);
  if (opts.username) fd.append("username", opts.username);
  fd.append("folder", opts.folder);
  const res = await fetch("/api/admin/website/upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return String(data.url || "");
}

function discardPending(url: string | null, password: string, username?: string) {
  if (!url || !isMediaUrl(url)) return;
  const payload: Record<string, unknown> = { password, action: "discardMedia", url };
  if (username) payload.username = username;
  void fetch("/api/admin/website", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function SiteImageField({
  label,
  value,
  kind,
  folder,
  password,
  username,
  onChange,
  onBusy,
  disabled,
}: {
  label: string;
  value: string;
  kind: SiteImageKind;
  folder: "events" | "community" | "heroes" | "rooms" | "menu";
  password: string;
  username?: string;
  onChange: (url: string) => void;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef<string | null>(null);
  const wasBusy = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!onBusy) return;
    if (busy && !wasBusy.current) onBusy(true);
    if (!busy && wasBusy.current) onBusy(false);
    wasBusy.current = busy;
    return () => {
      if (wasBusy.current) {
        onBusy(false);
        wasBusy.current = false;
      }
    };
  }, [busy, onBusy]);

  const upload = async (file: File) => {
    setError("");
    setBusy(true);
    try {
      const url = await uploadProcessedImage(file, { kind, folder, password, username });
      if (!aliveRef.current) {
        discardPending(url, password, username);
        return;
      }
      if (pendingRef.current && pendingRef.current !== url) discardPending(pendingRef.current, password, username);
      pendingRef.current = url;
      onChange(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not process image");
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    if (pendingRef.current) discardPending(pendingRef.current, password, username);
    pendingRef.current = null;
    onChange("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex items-start gap-3">
        {value ? (
          <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-xl border border-brand-mist bg-brand-sand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className="size-full object-cover" />
            <button
              type="button"
              className="absolute right-1.5 top-1.5 rounded-full bg-black/55 p-1 text-white disabled:opacity-40"
              onClick={clear}
              disabled={busy || disabled}
              aria-label="Remove image"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex h-24 w-40 shrink-0 items-center justify-center rounded-xl border border-dashed border-brand-mist bg-brand-sand/40 text-xs text-brand-green-dark/50">
            {kind === "hero" ? "16:9" : kind === "food" ? "1:1" : "16:10"}
          </div>
        )}
        <label className={cn(
          "flex cursor-pointer items-center gap-2 rounded-xl border border-brand-mist bg-white px-3 py-2 text-sm text-brand-green-dark hover:bg-brand-sand/40",
          (busy || disabled) && "pointer-events-none opacity-60",
        )}>
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
          {busy ? "Formatting…" : value ? "Replace" : "Upload photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={busy || disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
      </div>
      <p className="text-xs text-brand-green-dark/55">
        Phone photos are auto-cropped. Preview only — save to publish.
      </p>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}

export function SiteImageGallery({
  label,
  values,
  kind,
  folder,
  password,
  username,
  onChange,
  onBusy,
  disabled,
}: {
  label: string;
  values: string[];
  kind: SiteImageKind;
  folder: "events" | "community" | "heroes" | "rooms" | "menu";
  password: string;
  username?: string;
  onChange: (urls: string[]) => void;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef<Set<string>>(new Set());
  const wasBusy = useRef(false);
  const aliveRef = useRef(true);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!onBusy) return;
    if (busy && !wasBusy.current) onBusy(true);
    if (!busy && wasBusy.current) onBusy(false);
    wasBusy.current = busy;
    return () => {
      if (wasBusy.current) {
        onBusy(false);
        wasBusy.current = false;
      }
    };
  }, [busy, onBusy]);

  const addFiles = async (files: File[]) => {
    if (disabled) return;
    setError("");
    const room = SITE_GALLERY_MAX - valuesRef.current.length;
    if (room <= 0) {
      setError(`Up to ${SITE_GALLERY_MAX} photos`);
      return;
    }
    const batch = files.slice(0, room);
    setBusy(true);
    let failed = 0;
    for (const file of batch) {
      try {
        const url = await uploadProcessedImage(file, { kind, folder, password, username });
        if (!aliveRef.current) {
          discardPending(url, password, username);
          continue;
        }
        pendingRef.current.add(url);
        onChange([...valuesRef.current, url]);
      } catch {
        failed += 1;
      }
    }
    if (failed) setError(`${failed} photo${failed === 1 ? "" : "s"} could not be added. The others were kept.`);
    else if (files.length > room) setError(`Added ${batch.length}. Up to ${SITE_GALLERY_MAX} photos.`);
    setBusy(false);
  };

  const removeAt = (index: number) => {
    const url = values[index];
    if (pendingRef.current.has(url)) {
      discardPending(url, password, username);
      pendingRef.current.delete(url);
    }
    onChange(values.filter((_, i) => i !== index));
  };

  const makeCover = (index: number) => {
    if (index <= 0) return;
    const next = [...values];
    const [picked] = next.splice(index, 1);
    onChange([picked, ...next]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Label>{label}</Label>
        <p className="mt-0.5 text-xs text-brand-green-dark/55">
          First photo is the card. Extra photos open in a slideshow when a guest taps the card. Up to {SITE_GALLERY_MAX}.
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {values.map((url, i) => (
          <div key={`${url}-${i}`} className="relative h-24 w-36 shrink-0 overflow-hidden rounded-xl border border-brand-mist bg-brand-sand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="size-full object-cover" />
            {i === 0 ? (
              <span className="absolute left-1.5 top-1.5 rounded-full bg-brand-green px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Cover
              </span>
            ) : (
              <button
                type="button"
                className="absolute left-1.5 top-1.5 rounded-full bg-black/55 p-1 text-white"
                onClick={() => makeCover(i)}
                disabled={busy || disabled}
                aria-label="Use as cover"
                title="Use as cover"
              >
                <StarIcon className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              className="absolute right-1.5 top-1.5 rounded-full bg-black/55 p-1 text-white disabled:opacity-40"
              onClick={() => removeAt(i)}
              disabled={busy || disabled}
              aria-label="Remove photo"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ))}
        {values.length < SITE_GALLERY_MAX ? (
          <label
            className={cn(
              "flex h-24 w-36 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-brand-mist bg-brand-sand/40 text-xs text-brand-green-dark/70 hover:bg-brand-sand/70",
              (busy || disabled) && "pointer-events-none opacity-60",
            )}
          >
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-5" />}
            {busy ? "Formatting…" : "Add photos"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              disabled={busy || disabled}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (files.length) void addFiles(files);
              }}
            />
          </label>
        ) : null}
      </div>
      {values.length < SITE_GALLERY_MAX ? <label className={cn("inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", (busy || disabled) && "pointer-events-none opacity-60")}><CameraIcon className="size-4" />Take photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" disabled={busy || disabled} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void addFiles([file]); }} /></label> : null}
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
