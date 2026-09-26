"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ImageIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AdminLoading } from "./AdminLoading";
import { useAdminToast } from "./AdminToast";
import {
  HERO_PAGE_KEYS,
  HERO_PAGE_LABELS,
  type HeroLibraryItem,
  type HeroPageKey,
  type HeroVideoSlot,
} from "@/lib/heroVideos";
import type { HeroVideosAdminPayload } from "@/lib/loadHeroVideos";

type Props = { password: string; username?: string };

function findItem(id: string, items: HeroLibraryItem[]) {
  return items.find((v) => v.id === id);
}

export function AdminHeroVideos({ password, username }: Props) {
  const { showError, showSuccess } = useAdminToast();
  const [data, setData] = useState<HeroVideosAdminPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [editingPage, setEditingPage] = useState<HeroPageKey | null>(null);
  const [draftDesktop, setDraftDesktop] = useState("");
  const [draftMobile, setDraftMobile] = useState("");
  const fileDesktop = useRef<HTMLInputElement>(null);
  const fileMobile = useRef<HTMLInputElement>(null);

  const api = useCallback(async (body: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { password, ...body };
    if (username) payload.username = username;
    const res = await fetch("/api/admin/website", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Request failed");
    return json;
  }, [password, username]);

  const load = useCallback(async () => {
    try {
      setData(await api({ action: "getHeroVideos" }) as HeroVideosAdminPayload);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to load hero videos");
    }
  }, [api, showError]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const allItems = useMemo(
    () => (data ? [...data.builtins, ...data.desktop, ...data.mobile] : []),
    [data],
  );
  const desktopOpts = useMemo(
    () => [...(data?.builtins.filter((b) => b.slot === "desktop") || []), ...(data?.desktop || [])],
    [data],
  );
  const mobileOpts = useMemo(
    () => [...(data?.builtins.filter((b) => b.slot === "mobile") || []), ...(data?.mobile || [])],
    [data],
  );
  const assigned = useMemo(() => new Set((data?.assignments || []).map((a) => a.page)), [data]);
  const assignMap = useMemo(
    () => new Map((data?.assignments || []).map((a) => [a.page, a])),
    [data],
  );

  async function uploadBlob(blob: Blob, filename: string) {
    const fd = new FormData();
    fd.append("file", blob, filename);
    fd.append("password", password);
    if (username) fd.append("username", username);
    fd.append("folder", "hero-videos");
    const res = await fetch("/api/admin/website/upload", { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Upload failed");
    return String(json.url || "");
  }

  async function onUpload(slot: HeroVideoSlot, file: File | null) {
    if (!file) return;
    setBusy(true);
    setProgress("Starting…");
    try {
      const { processHeroVideo } = await import("@/lib/processHeroVideo");
      const processed = await processHeroVideo(file, slot, (_p, detail) => setProgress(detail || _p));
      setProgress("Uploading video…");
      const url = await uploadBlob(processed.video, `${slot}.mp4`);
      setProgress("Uploading poster…");
      const posterUrl = await uploadBlob(processed.poster, `${slot}-poster.jpg`);
      setProgress("Saving…");
      await api({
        action: "addHeroVideo",
        slot,
        url,
        posterUrl,
        label: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || (slot === "desktop" ? "Desktop clip" : "Mobile clip"),
        bytes: processed.bytes,
        width: processed.width,
        height: processed.height,
      });
      showSuccess(slot === "desktop" ? "Desktop video added" : "Mobile video added");
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function onDelete(item: HeroLibraryItem) {
    if (item.builtin || !confirm(`Delete “${item.label}”?`)) return;
    setBusy(true);
    try {
      await api({ action: "deleteHeroVideo", id: item.id });
      showSuccess("Video deleted");
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  function openPageEdit(page: HeroPageKey) {
    const a = assignMap.get(page);
    const loop = data?.pages[page];
    setDraftDesktop(a?.desktopVideoId || desktopOpts.find((o) => o.url === loop?.mp4)?.id || desktopOpts[0]?.id || "");
    setDraftMobile(a?.mobileVideoId || mobileOpts.find((o) => o.url === loop?.mobileMp4)?.id || mobileOpts[0]?.id || "");
    setEditingPage(page);
  }

  async function savePage() {
    if (!editingPage) return;
    setBusy(true);
    try {
      await api({ action: "savePageHero", page: editingPage, desktopVideoId: draftDesktop, mobileVideoId: draftMobile });
      showSuccess("Page hero saved");
      setEditingPage(null);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <AdminLoading message="Loading hero videos..." />;
  if (!data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Could not load hero videos.{" "}
        <Button type="button" size="sm" className="ml-2" onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
          Retry
        </Button>
      </div>
    );
  }

  const locked = busy;
  const previewD = findItem(draftDesktop, allItems);
  const previewM = findItem(draftMobile, allItems);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h3 className="font-display text-lg font-bold text-brand-green">Hero Videos</h3>
        <p className="mt-1 max-w-xl text-sm text-brand-green-dark/70">
          Upload desktop and mobile clips, then assign a pair to each marketing page.
        </p>
        {progress ? <p className="mt-2 text-sm text-brand-green" role="status">{progress}</p> : null}
      </div>

      <LibrarySection title="Desktop videos" hint="Landscape 1024×576" items={data.desktop}
        builtins={data.builtins.filter((b) => b.slot === "desktop")} locked={locked}
        fileRef={fileDesktop} onPick={() => fileDesktop.current?.click()}
        onFile={(f) => void onUpload("desktop", f)} onDelete={onDelete} />
      <LibrarySection title="Mobile videos" hint="Portrait 324×576" items={data.mobile}
        builtins={data.builtins.filter((b) => b.slot === "mobile")} locked={locked}
        fileRef={fileMobile} onPick={() => fileMobile.current?.click()}
        onFile={(f) => void onUpload("mobile", f)} onDelete={onDelete} />

      <section className="flex flex-col gap-3">
        <h4 className="font-display text-base font-semibold text-brand-green-dark">Pages</h4>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HERO_PAGE_KEYS.map((pageKey) => {
            const loop = data.pages[pageKey];
            const a = assignMap.get(pageKey);
            const ready = assigned.has(pageKey);
            const dLabel = findItem(a?.desktopVideoId || "", allItems)?.label
              || findItem(desktopOpts.find((o) => o.url === loop.mp4)?.id || "", allItems)?.label
              || "Desktop default";
            const mLabel = findItem(a?.mobileVideoId || "", allItems)?.label
              || findItem(mobileOpts.find((o) => o.url === loop.mobileMp4)?.id || "", allItems)?.label
              || "Mobile default";
            return (
              <li key={pageKey} className="overflow-hidden rounded-2xl border border-brand-mist bg-white">
                <div className="relative aspect-[16/9] bg-brand-sand/50">
                  {loop.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={loop.poster} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center"><ImageIcon className="size-8 opacity-30" /></div>
                  )}
                  <span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[11px] font-semibold ${ready ? "bg-emerald-700 text-white" : "bg-amber-100 text-amber-900"}`}>
                    {ready ? "Ready" : "Using default"}
                  </span>
                </div>
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-brand-green-dark">{HERO_PAGE_LABELS[pageKey]}</p>
                    <p className="mt-1 truncate text-xs text-brand-green-dark/55">{dLabel} · {mLabel}</p>
                  </div>
                  <Button type="button" size="icon-sm" variant="ghost" disabled={locked}
                    aria-label={`Edit ${HERO_PAGE_LABELS[pageKey]}`} onClick={() => openPageEdit(pageKey)}>
                    <PencilIcon className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {editingPage && (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4"
          onClick={() => { if (!locked) setEditingPage(null); }}>
          <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b p-4">
              <div>
                <h3 className="font-semibold text-brand-green-dark">{HERO_PAGE_LABELS[editingPage]}</h3>
                <p className="text-xs text-brand-green-dark/55">Pick desktop and mobile clips</p>
              </div>
              <Button type="button" size="icon-sm" variant="ghost" disabled={locked} aria-label="Close" onClick={() => setEditingPage(null)}>
                <XIcon className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <SelectPreview label="Desktop" value={draftDesktop} options={desktopOpts}
                previewUrl={previewD?.url} poster={previewD?.posterUrl} disabled={locked} onChange={setDraftDesktop} />
              <SelectPreview label="Mobile" value={draftMobile} options={mobileOpts}
                previewUrl={previewM?.url} poster={previewM?.posterUrl} disabled={locked} onChange={setDraftMobile} />
            </div>
            <div className="flex gap-2 border-t p-4">
              <Button type="button" className="flex-1" disabled={locked || !draftDesktop || !draftMobile} onClick={() => void savePage()}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" disabled={locked} onClick={() => setEditingPage(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LibrarySection({
  title, hint, items, builtins, locked, fileRef, onPick, onFile, onDelete,
}: {
  title: string; hint: string; items: HeroLibraryItem[]; builtins: HeroLibraryItem[];
  locked: boolean; fileRef: RefObject<HTMLInputElement | null>;
  onPick: () => void; onFile: (f: File | null) => void; onDelete: (item: HeroLibraryItem) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="font-display text-base font-semibold text-brand-green-dark">{title}</h4>
          <p className="text-xs text-brand-green-dark/55">{hint}</p>
        </div>
        <Button type="button" size="sm" disabled={locked} onClick={onPick}>
          <PlusIcon className="mr-1 size-4" /> Upload
        </Button>
        <input ref={fileRef} type="file" accept="video/*" className="hidden" disabled={locked}
          onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ""; onFile(f); }} />
      </div>
      {items.length === 0
        ? <p className="text-sm text-brand-green-dark/50">No uploads yet.</p>
        : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => <VideoCard key={item.id} item={item} locked={locked} onDelete={onDelete} />)}
          </ul>
        )}
      {builtins.length > 0 && (
        <div className="mt-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-green-dark/40">Built-in</p>
          <ul className="grid gap-3 opacity-90 sm:grid-cols-2 lg:grid-cols-3">
            {builtins.map((item) => <VideoCard key={item.id} item={item} locked={locked} onDelete={onDelete} subtle />)}
          </ul>
        </div>
      )}
    </section>
  );
}

function VideoCard({ item, locked, onDelete, subtle }: {
  item: HeroLibraryItem; locked: boolean; onDelete: (item: HeroLibraryItem) => void; subtle?: boolean;
}) {
  return (
    <li className={`overflow-hidden rounded-2xl border bg-white ${subtle ? "border-brand-mist/70" : "border-brand-mist"}`}>
      <div className="relative aspect-[16/9] bg-brand-sand/50">
        {item.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.posterUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center"><ImageIcon className="size-8 opacity-30" /></div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white">Ready</span>
      </div>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-brand-green-dark">{item.label}</p>
          <p className="text-xs text-brand-green-dark/50">
            {item.width}×{item.height}{item.bytes ? ` · ${Math.round(item.bytes / 1024)} KB` : ""}
          </p>
        </div>
        {!item.builtin && (
          <Button type="button" size="icon-sm" variant="ghost" disabled={locked}
            aria-label={`Delete ${item.label}`} onClick={() => onDelete(item)}>
            <Trash2Icon className="size-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

function SelectPreview({ label, value, options, previewUrl, poster, disabled, onChange }: {
  label: string; value: string; options: HeroLibraryItem[]; previewUrl?: string; poster?: string;
  disabled: boolean; onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <select className="h-10 rounded-xl border border-brand-mist bg-white px-3 text-sm"
        value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}{o.builtin ? " (built-in)" : ""}</option>
        ))}
      </select>
      <div className="aspect-[16/9] overflow-hidden rounded-xl border border-brand-mist bg-black/90">
        {previewUrl ? (
          <video key={previewUrl} src={previewUrl} poster={poster}
            className="size-full object-contain" muted loop playsInline autoPlay />
        ) : null}
      </div>
    </div>
  );
}
