"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLinkIcon, ImageIcon, LinkIcon, PencilIcon, PlusIcon, QrCodeIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Role } from "./types";

type Section = { id: number; name: string; description: string; displayOrder: number };
type Item = { id: number; sectionId: number; title: string; description: string; url: string; imageUrl: string; displayOrder: number; isActive: number };
type Draft = { id?: number; sectionId?: number; name?: string; title?: string; description: string; url?: string; imageUrl?: string; isActive?: boolean };

export function QuickLinks({ password, username, role }: { password: string; username?: string; role: Role }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sectionDraft, setSectionDraft] = useState<Draft | null>(null);
  const [itemDraft, setItemDraft] = useState<Draft | null>(null);
  const [uploading, setUploading] = useState(false);
  const canEdit = role === "admin";

  const request = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/quick-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, username, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }, [password, username]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request({ action: "list" });
      setSections(data.sections || []);
      setItems(data.items || []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load links"); }
    finally { setLoading(false); }
  }, [request]);

  useEffect(() => { load(); }, [load]);

  const saveSection = async () => {
    if (!sectionDraft?.name?.trim()) return;
    await request({ action: "saveSection", ...sectionDraft });
    setSectionDraft(null); await load();
  };

  const saveItem = async () => {
    if (!itemDraft?.sectionId || !itemDraft.title?.trim()) return;
    await request({ action: "saveItem", ...itemDraft, isActive: itemDraft.isActive !== false });
    setItemDraft(null); await load();
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file); form.append("password", password); form.append("username", username || ""); form.append("folder", "quick-links");
      const res = await fetch("/api/admin/website/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setItemDraft((draft) => draft ? { ...draft, imageUrl: data.url } : draft);
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  };

  const remove = async (action: "deleteSection" | "deleteItem", id: number) => {
    if (!window.confirm("Delete this item?")) return;
    await request({ action, id }); await load();
  };

  const reorder = async (kind: "sections" | "items", id: number, direction: -1 | 1, sectionId?: number) => {
    const source = kind === "sections" ? sections : items.filter((item) => item.sectionId === sectionId);
    const index = source.findIndex((row) => row.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= source.length) return;
    const ids = source.map((row) => row.id); [ids[index], ids[next]] = [ids[next], ids[index]];
    await request({ action: "reorder", kind, ids }); await load();
  };

  const sectionItems = useMemo(() => new Map(sections.map((section) => [section.id, items.filter((item) => item.sectionId === section.id && (canEdit || Boolean(item.isActive)))])), [canEdit, items, sections]);

  if (loading) return <div className="py-16 text-center text-sm text-brand-green-dark/60">Loading Links & QRs…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Links & QRs</h2><p className="mt-1 text-sm text-brand-green-dark/60 dark:text-zinc-400">Quick access to food, payment, Wi‑Fi, and other useful resources.</p></div>
        {canEdit && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => window.open("/quick-links", "_blank", "noopener,noreferrer")}><ExternalLinkIcon className="mr-2 h-4 w-4" />View guest page</Button><Button type="button" variant="cta" onClick={() => setSectionDraft({ name: "", description: "" })}><PlusIcon className="mr-2 h-4 w-4" />Add section</Button></div>}
      </div>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {sections.length === 0 && <div className="rounded-2xl border border-dashed border-brand-mist bg-white p-8 text-center text-sm text-brand-green-dark/60">No sections yet.{canEdit && " Add one to start building your quick-links page."}</div>}
      {sections.map((section, sectionIndex) => {
        const visibleItems = sectionItems.get(section.id) || [];
        return <section key={section.id} className="rounded-2xl border border-brand-mist bg-white p-4 shadow-sm dark:bg-card sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h3 className="font-display text-lg font-bold text-brand-green-dark dark:text-zinc-100">{section.name}</h3>{section.description && <p className="mt-1 text-sm text-brand-green-dark/60 dark:text-zinc-400">{section.description}</p>}</div>
            {canEdit && <div className="flex items-center gap-1"><button className="rounded-lg p-2 text-brand-green-dark/50 hover:bg-brand-sand" disabled={sectionIndex === 0} onClick={() => reorder("sections", section.id, -1)} aria-label="Move section up">↑</button><button className="rounded-lg p-2 text-brand-green-dark/50 hover:bg-brand-sand" disabled={sectionIndex === sections.length - 1} onClick={() => reorder("sections", section.id, 1)} aria-label="Move section down">↓</button><button className="rounded-lg p-2 text-brand-green-dark/50 hover:bg-brand-sand" onClick={() => setSectionDraft({ id: section.id, name: section.name, description: section.description })} aria-label="Edit section"><PencilIcon className="h-4 w-4" /></button><button className="rounded-lg p-2 text-red-500 hover:bg-red-50" onClick={() => remove("deleteSection", section.id)} aria-label="Delete section"><Trash2Icon className="h-4 w-4" /></button></div>}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleItems.map((item, itemIndex) => <article key={item.id} className={cn("rounded-xl border border-brand-mist p-3", !item.isActive && "opacity-50")}>
              {item.imageUrl && <button type="button" className="mb-3 block w-full overflow-hidden rounded-lg bg-brand-sand" onClick={() => window.open(item.imageUrl, "_blank", "noopener,noreferrer")}><img src={item.imageUrl} alt="" className="h-36 w-full object-contain" /></button>}
              <div className="flex items-start gap-2"><div className="flex-1"><h4 className="font-semibold text-brand-green-dark dark:text-zinc-100">{item.title}</h4>{item.description && <p className="mt-1 text-sm text-brand-green-dark/60 dark:text-zinc-400">{item.description}</p>}</div>{item.imageUrl && <QrCodeIcon className="h-5 w-5 shrink-0 text-brand-green" />}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">{item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-brand-green px-3 py-2 text-xs font-semibold text-white"><ExternalLinkIcon className="h-3.5 w-3.5" />Open link</a>}{canEdit && <><button className="rounded-lg p-2 text-brand-green-dark/50 hover:bg-brand-sand" disabled={itemIndex === 0} onClick={() => reorder("items", item.id, -1, section.id)} aria-label="Move item up">↑</button><button className="rounded-lg p-2 text-brand-green-dark/50 hover:bg-brand-sand" disabled={itemIndex === visibleItems.length - 1} onClick={() => reorder("items", item.id, 1, section.id)} aria-label="Move item down">↓</button><button className="rounded-lg p-2 text-brand-green-dark/50 hover:bg-brand-sand" onClick={() => setItemDraft({ id: item.id, sectionId: item.sectionId, title: item.title, description: item.description, url: item.url, imageUrl: item.imageUrl, isActive: Boolean(item.isActive) })} aria-label="Edit item"><PencilIcon className="h-4 w-4" /></button><button className="rounded-lg p-2 text-red-500 hover:bg-red-50" onClick={() => remove("deleteItem", item.id)} aria-label="Delete item"><Trash2Icon className="h-4 w-4" /></button></>}</div>
            </article>)}
          </div>
          {canEdit && <button type="button" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-green" onClick={() => setItemDraft({ sectionId: section.id, title: "", description: "", url: "", imageUrl: "", isActive: true })}><PlusIcon className="h-4 w-4" />Add link or QR</button>}
        </section>;
      })}
      {canEdit && (sectionDraft || itemDraft) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setSectionDraft(null); setItemDraft(null); }}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-display text-lg font-bold text-brand-green-dark dark:text-zinc-100">{sectionDraft ? "Section" : "Link or QR"}</h3><button onClick={() => { setSectionDraft(null); setItemDraft(null); }} aria-label="Close"><XIcon className="h-5 w-5" /></button></div>
            {sectionDraft ? (
              <div className="mt-4 space-y-3"><input autoFocus value={sectionDraft.name || ""} onChange={(e) => setSectionDraft({ ...sectionDraft, name: e.target.value })} placeholder="Section name" className="w-full rounded-lg border border-brand-mist px-3 py-2" /><textarea value={sectionDraft.description} onChange={(e) => setSectionDraft({ ...sectionDraft, description: e.target.value })} placeholder="Short description (optional)" className="w-full rounded-lg border border-brand-mist px-3 py-2" /><Button variant="cta" className="w-full" onClick={saveSection}>Save section</Button></div>
            ) : (
              <div className="mt-4 space-y-3"><input autoFocus value={itemDraft?.title || ""} onChange={(e) => setItemDraft((draft) => draft ? { ...draft, title: e.target.value } : draft)} placeholder="Title" className="w-full rounded-lg border border-brand-mist px-3 py-2" /><textarea value={itemDraft?.description || ""} onChange={(e) => setItemDraft((draft) => draft ? { ...draft, description: e.target.value } : draft)} placeholder="Description (optional)" className="w-full rounded-lg border border-brand-mist px-3 py-2" /><div className="flex items-center gap-2"><LinkIcon className="h-4 w-4 text-brand-green" /><input value={itemDraft?.url || ""} onChange={(e) => setItemDraft((draft) => draft ? { ...draft, url: e.target.value } : draft)} placeholder="https://… (optional)" className="w-full rounded-lg border border-brand-mist px-3 py-2" /></div><div className="rounded-lg border border-dashed border-brand-mist p-3"><label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-green"><UploadIcon className="h-4 w-4" />{uploading ? "Uploading…" : "Upload QR / image"}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadImage(file); }} /></label>{itemDraft?.imageUrl && <div className="mt-3 flex items-center gap-3"><img src={itemDraft.imageUrl} alt="QR preview" className="h-20 w-20 rounded-lg border border-brand-mist bg-brand-sand object-contain" /><div className="min-w-0 flex-1 text-xs text-brand-green-dark/60"><p className="truncate">QR/image attached</p><button type="button" className="mt-1 text-red-600" onClick={() => setItemDraft((draft) => draft ? { ...draft, imageUrl: "" } : draft)}>Remove</button></div></div>}</div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={itemDraft?.isActive !== false} onChange={(e) => setItemDraft((draft) => draft ? { ...draft, isActive: e.target.checked } : draft)} />Visible on the page</label><Button variant="cta" className="w-full" onClick={saveItem}>Save item</Button></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
