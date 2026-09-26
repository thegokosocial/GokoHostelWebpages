"use client";

import { useCallback, useEffect, useState } from "react";
import { ImageIcon, PencilIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SiteImageGallery } from "./SiteImageField";
import type { AccommodationPropertyContent, AccommodationRoomContent } from "@/lib/accommodationContent";

type Data = { rooms: AccommodationRoomContent[]; property: AccommodationPropertyContent };

export function AccommodationContentManager({ password, username }: { password: string; username?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<AccommodationRoomContent | null>(null);
  const [property, setProperty] = useState<AccommodationPropertyContent | null>(null);
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState(0);
  const [message, setMessage] = useState("");

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch("/api/admin/booking-settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, username, action, ...extra }), signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Accommodation request failed");
    return body;
  }, [password, username]);

  const load = useCallback(async () => {
    setMessage("");
    try { const next = await call("getAccommodationContent"); setData(next); setProperty(next.property); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load room content"); }
  }, [call]);

  useEffect(() => { void load(); }, [load]);
  const onBusy = (active: boolean) => setUploads((count) => Math.max(0, count + (active ? 1 : -1)));
  const roomDirty = Boolean(editing && data && JSON.stringify(editing) !== JSON.stringify(data.rooms.find((room) => room.dormId === editing.dormId)));
  const propertyDirty = Boolean(propertyOpen && data && property && JSON.stringify(property) !== JSON.stringify(data.property));
  const discardUploads = (draft: string[], saved: string[]) => {
    const urls = draft.filter((url) => !saved.includes(url) && url.startsWith("/api/media/"));
    if (!urls.length) return;
    void fetch("/api/admin/website", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, username, action: "discardMedia", urls }) });
  };
  const closeRoom = () => {
    if (!editing || (roomDirty && !window.confirm("Discard unsaved room changes?"))) return;
    const saved = data?.rooms.find((room) => room.dormId === editing.dormId);
    if (saved) discardUploads([...editing.roomPhotos, ...editing.washroomPhotos], [...saved.roomPhotos, ...saved.washroomPhotos]);
    setEditing(null);
  };
  const closeProperty = () => {
    if (!property || (propertyDirty && !window.confirm("Discard unsaved property photo changes?"))) return;
    if (data) discardUploads([...property.exteriorPhotos, ...property.commonPhotos, ...property.washroomPhotos], [...data.property.exteriorPhotos, ...data.property.commonPhotos, ...data.property.washroomPhotos]);
    setProperty(data?.property || null); setPropertyOpen(false);
  };

  useEffect(() => {
    if (!roomDirty && !propertyDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [roomDirty, propertyDirty]);

  async function saveRoom() {
    if (!editing) return;
    setBusy(true); setMessage("");
    try {
      const result = await call("saveRoomContent", { content: editing });
      setData((current) => current ? { ...current, rooms: current.rooms.map((room) => room.dormId === editing.dormId ? result.content : room) } : current);
      setEditing(null); setMessage("Room content published.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save room content"); }
    finally { setBusy(false); }
  }

  async function saveProperty() {
    if (!property) return;
    setBusy(true); setMessage("");
    try {
      const result = await call("savePropertyGallery", { content: property });
      setProperty(result.content); setData((current) => current ? { ...current, property: result.content } : current);
      setPropertyOpen(false); setMessage("Property photos published.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save property photos"); }
    finally { setBusy(false); }
  }

  if (!data || !property) return <div className="rounded-xl border p-4 text-sm">{message || "Loading room content…"}</div>;
  const locked = busy || uploads > 0;
  return <div className="space-y-5">
    {message && <p role="status" className="rounded-lg border bg-white p-3 text-sm">{message}</p>}
    <section className="space-y-3">
      <div><h3 className="font-semibold">Room photos & details</h3><p className="text-xs text-muted-foreground">Shared by Our rooms and native booking results.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.rooms.map((room) => {
          const cover = room.roomPhotos[0] || room.washroomPhotos[0];
          const ready = Boolean(room.description && room.roomPhotos.length);
          return <article key={room.dormId} className="overflow-hidden rounded-2xl border bg-white">
            <div className="relative aspect-[16/9] bg-brand-sand/50">
              {/* eslint-disable-next-line @next/next/no-img-element -- private R2 previews use runtime URLs */}
              {cover ? <img src={cover} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center"><ImageIcon className="size-8 opacity-30" /></div>}
              <span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[11px] font-semibold ${ready ? "bg-emerald-700 text-white" : "bg-amber-100 text-amber-900"}`}>{ready ? "Ready" : "Needs content"}</span>
            </div>
            <div className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1"><p className="font-semibold">{room.publicName}</p><p className="truncate text-xs text-muted-foreground">Inventory: {room.operationalName}</p><p className="mt-1 text-xs">{room.roomPhotos.length + room.washroomPhotos.length} photos · {room.mapped ? "Mapped" : "Not mapped"}</p></div>
              <Button type="button" size="icon-lg" variant="outline" aria-label={`Edit ${room.publicName}`} onClick={() => setEditing({ ...room, amenities: [...room.amenities], roomPhotos: [...room.roomPhotos], washroomPhotos: [...room.washroomPhotos] })}><PencilIcon /></Button>
            </div>
          </article>;
        })}
      </div>
    </section>
    <section className="rounded-2xl border bg-white p-4">
      <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Property photos</h3><p className="text-xs text-muted-foreground">Exterior, common areas and shared washrooms.</p></div><Button type="button" variant="outline" onClick={() => setPropertyOpen(true)}>Edit</Button></div>
      <p className="mt-3 text-sm">{property.exteriorPhotos.length + property.commonPhotos.length + property.washroomPhotos.length} photos</p>
    </section>

    {editing && <div className="fixed inset-0 z-[70] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onClick={() => { if (!locked) closeRoom(); }}>
      <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-4"><div><h3 className="font-semibold">Edit room</h3><p className="text-xs text-muted-foreground">{editing.operationalName}</p></div><Button type="button" size="icon-lg" variant="ghost" disabled={locked} aria-label="Close room editor" onClick={closeRoom}><XIcon /></Button></div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
          <label className="grid gap-1 text-sm"><Label>Guest-facing name</Label><Input maxLength={100} value={editing.publicName} onChange={(e) => setEditing({ ...editing, publicName: e.target.value })} /></label>
          <label className="grid gap-1 text-sm"><Label>Description</Label><Textarea rows={4} maxLength={1000} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
          <label className="grid gap-1 text-sm"><Label>Amenities</Label><Input value={editing.amenities.join(", ")} placeholder="Locker, fan, charging point" onChange={(e) => setEditing({ ...editing, amenities: e.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12) })} /><span className="text-xs text-muted-foreground">Comma separated, up to 12.</span></label>
          <SiteImageGallery label="Room photos" values={editing.roomPhotos} kind="card" folder="rooms" password={password} username={username} onBusy={onBusy} disabled={locked} onChange={(roomPhotos) => setEditing({ ...editing, roomPhotos })} />
          <SiteImageGallery label="Washroom photos" values={editing.washroomPhotos} kind="card" folder="rooms" password={password} username={username} onBusy={onBusy} disabled={locked} onChange={(washroomPhotos) => setEditing({ ...editing, washroomPhotos })} />
        </div>
        <div className="flex gap-2 border-t bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button type="button" className="min-h-11 flex-1" disabled={locked || !roomDirty} onClick={saveRoom}>{busy ? "Saving…" : uploads ? "Uploading…" : "Save changes"}</Button><Button type="button" className="min-h-11" variant="outline" disabled={locked} onClick={closeRoom}>Cancel</Button></div>
      </div>
    </div>}

    {propertyOpen && <div className="fixed inset-0 z-[70] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onClick={() => { if (!locked) closeProperty(); }}>
      <div className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4"><h3 className="font-semibold">Property photos</h3><Button type="button" size="icon-lg" variant="ghost" disabled={locked} aria-label="Close property editor" onClick={closeProperty}><XIcon /></Button></div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4"><SiteImageGallery label="Exterior" values={property.exteriorPhotos} kind="card" folder="rooms" password={password} username={username} onBusy={onBusy} disabled={locked} onChange={(exteriorPhotos) => setProperty({ ...property, exteriorPhotos })} /><SiteImageGallery label="Common areas" values={property.commonPhotos} kind="card" folder="rooms" password={password} username={username} onBusy={onBusy} disabled={locked} onChange={(commonPhotos) => setProperty({ ...property, commonPhotos })} /><SiteImageGallery label="Shared washrooms" values={property.washroomPhotos} kind="card" folder="rooms" password={password} username={username} onBusy={onBusy} disabled={locked} onChange={(washroomPhotos) => setProperty({ ...property, washroomPhotos })} /></div>
        <div className="flex gap-2 border-t bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button type="button" className="min-h-11 flex-1" disabled={locked || !propertyDirty} onClick={saveProperty}>{busy ? "Saving…" : uploads ? "Uploading…" : "Save photos"}</Button><Button type="button" className="min-h-11" variant="outline" disabled={locked} onClick={closeProperty}>Cancel</Button></div>
      </div>
    </div>}
  </div>;
}
