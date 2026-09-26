"use client";

import { useCallback, useEffect, useId, useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { AdminLoading } from "./AdminLoading";
import { SiteImageField, SiteImageGallery } from "./SiteImageField";
import { useAdminToast } from "./AdminToast";
import { cn } from "@/lib/utils";
import { Icon, ICON_NAMES } from "@/components/ui/Icon";
import {
  defaultCommunityCopy,
  defaultEventsCopy,
  mergeGallery,
  parseJsonArray,
  type CommunityPageCopy,
  type EventsPageCopy,
} from "@/lib/siteCopy";
import { ExternalLinkIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { Role } from "./types";
import { isMediaUrl } from "@/lib/mediaKeys";
import {
  managementSectionTabActiveClass,
  managementSectionTabClass,
  managementSectionTabsClass,
  managementSectionTabInactiveClass,
} from "./managementSectionTabs";
import { AdminHeroVideos } from "./AdminHeroVideos";

type EventRow = {
  id: number;
  date: string;
  title: string;
  description: string;
  tags: string;
  isPast: number;
  coverUrl: string;
  photos: string;
  displayOrder: number;
};

type SpaceRow = {
  id: number;
  title: string;
  icon: string;
  description: string;
  imageUrl: string;
  photos: string;
  displayOrder: number;
};

type EventForm = {
  date: string;
  title: string;
  description: string;
  tags: string;
  isPast: boolean;
  photos: string[];
};

const emptyEvent: EventForm = {
  date: "", title: "", description: "", tags: "", isPast: false, photos: [],
};

type SpaceForm = {
  title: string;
  icon: string;
  description: string;
  photos: string[];
};

const emptySpace: SpaceForm = { title: "", icon: "sofa", description: "", photos: [] };

function rowGallery(cover: string, photos: string) {
  return mergeGallery(cover, parseJsonArray(photos));
}

function discardUnsavedMedia(urls: string[], keep: string[], password: string, username?: string) {
  const keepSet = new Set(keep);
  const drop = urls.filter((url) => isMediaUrl(url) && !keepSet.has(url));
  if (!drop.length) return;
  const payload: Record<string, unknown> = { password, action: "discardMedia", urls: drop };
  if (username) payload.username = username;
  void fetch("/api/admin/website", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function AdminWebsite({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { showError, showSuccess } = useAdminToast();
  const [tab, setTab] = useState<"events" | "community" | "heroes">("events");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyUploads, setBusyUploads] = useState(0);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [eventsCopy, setEventsCopy] = useState<EventsPageCopy>(defaultEventsCopy);
  const [communityCopy, setCommunityCopy] = useState<CommunityPageCopy>(defaultCommunityCopy);

  const [eventForm, setEventForm] = useState<EventForm>(emptyEvent);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [savedEventPhotos, setSavedEventPhotos] = useState<string[]>([]);

  const [spaceForm, setSpaceForm] = useState<SpaceForm>(emptySpace);
  const [editingSpaceId, setEditingSpaceId] = useState<number | null>(null);
  const [showSpaceForm, setShowSpaceForm] = useState(false);
  const [savedSpacePhotos, setSavedSpacePhotos] = useState<string[]>([]);

  const apiCall = useCallback(async (body: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/website", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const onBusy = useCallback((busy: boolean) => {
    setBusyUploads((n) => Math.max(0, n + (busy ? 1 : -1)));
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const res = await apiCall({ action: "getAll" });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || "Failed to load website content";
        setLoadError(message);
        showError(message);
        return;
      }
      setLoadError("");
      setEvents(data.events || []);
      setSpaces(data.spaces || []);
      if (data.eventsCopy) setEventsCopy(data.eventsCopy);
      if (data.communityCopy) setCommunityCopy(data.communityCopy);
    } catch {
      const message = "Could not reach the website CMS";
      setLoadError(message);
      showError(message);
    }
  }, [apiCall, showError]);

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  if (role !== "admin") {
    return <p className="text-sm text-brand-green-dark/70">Admin access required to edit the public website.</p>;
  }
  if (loading) return <AdminLoading message="Loading website content..." />;
  if (loadError) {
    const piOrMigrate = /live site|no such table|not bound/i.test(loadError);
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">Could not load website content</p>
        <p className="mt-1">{loadError}</p>
        {piOrMigrate ? (
          <p className="mt-2 text-red-700/80">
            On the live Cloudflare site, apply migration 0035 and bind the goko-media R2 bucket. This tab is not available on the Pi.
          </p>
        ) : null}
        <Button
          type="button"
          className="mt-3"
          onClick={() => {
            setLoading(true);
            loadAll().finally(() => setLoading(false));
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const upcoming = events.filter((e) => !e.isPast);
  const past = events.filter((e) => e.isPast);
  const locked = saving || busyUploads > 0;

  const saveEventsCopy = async () => {
    setSaving(true);
    try {
      const res = await apiCall({ action: "saveEventsCopy", copy: eventsCopy });
      const data = await res.json();
      if (!res.ok) showError(data.error || "Failed to save");
      else showSuccess("Events page text saved");
    } catch {
      showError("Could not reach the website CMS");
    } finally { setSaving(false); }
  };

  const saveCommunityCopy = async () => {
    setSaving(true);
    try {
      const res = await apiCall({ action: "saveCommunityCopy", copy: communityCopy });
      const data = await res.json();
      if (!res.ok) showError(data.error || "Failed to save");
      else showSuccess("Community page text saved");
    } catch {
      showError("Could not reach the website CMS");
    } finally { setSaving(false); }
  };

  const saveEvent = async () => {
    if (!eventForm.title.trim()) { showError("Title is required"); return; }
    setSaving(true);
    try {
      const photos = eventForm.photos;
      const payload = {
        date: eventForm.date,
        title: eventForm.title,
        description: eventForm.description,
        tags: eventForm.tags,
        isPast: eventForm.isPast,
        coverUrl: photos[0] || "",
        photos,
      };
      const res = editingEventId
        ? await apiCall({ action: "updateEvent", id: editingEventId, ...payload })
        : await apiCall({ action: "addEvent", ...payload });
      const data = await res.json();
      if (!res.ok) { showError(data.error || "Failed to save event"); return; }
      showSuccess(editingEventId ? "Event updated" : "Event added");
      setShowEventForm(false);
      setEditingEventId(null);
      setEventForm(emptyEvent);
      setSavedEventPhotos([]);
      await loadAll();
    } catch {
      showError("Could not reach the website CMS");
    } finally { setSaving(false); }
  };

  const saveSpace = async () => {
    if (!spaceForm.title.trim()) { showError("Title is required"); return; }
    setSaving(true);
    try {
      const photos = spaceForm.photos;
      const payload = {
        title: spaceForm.title,
        icon: spaceForm.icon,
        description: spaceForm.description,
        imageUrl: photos[0] || "",
        photos,
      };
      const res = editingSpaceId
        ? await apiCall({ action: "updateSpace", id: editingSpaceId, ...payload })
        : await apiCall({ action: "addSpace", ...payload });
      const data = await res.json();
      if (!res.ok) { showError(data.error || "Failed to save space"); return; }
      showSuccess(editingSpaceId ? "Space updated" : "Space added");
      setShowSpaceForm(false);
      setEditingSpaceId(null);
      setSpaceForm(emptySpace);
      setSavedSpacePhotos([]);
      await loadAll();
    } catch {
      showError("Could not reach the website CMS");
    } finally { setSaving(false); }
  };

  const deleteItem = async (action: "deleteEvent" | "deleteSpace", id: number, okMsg: string) => {
    setSaving(true);
    try {
      const res = await apiCall({ action, id });
      const data = await res.json();
      if (!res.ok) showError(data.error || "Delete failed");
      else { showSuccess(okMsg); await loadAll(); }
    } catch {
      showError("Could not reach the website CMS");
    } finally { setSaving(false); }
  };

  const cancelEventEditor = () => {
    discardUnsavedMedia(eventForm.photos, savedEventPhotos, password, username);
    setShowEventForm(false);
    setEditingEventId(null);
    setEventForm(emptyEvent);
    setSavedEventPhotos([]);
  };

  const openEventEditor = (row: EventRow | null) => {
    discardUnsavedMedia(eventForm.photos, savedEventPhotos, password, username);
    if (!row) {
      setEventForm(emptyEvent);
      setEditingEventId(null);
      setSavedEventPhotos([]);
    } else {
      const photos = rowGallery(row.coverUrl, row.photos);
      setEventForm({
        date: row.date, title: row.title, description: row.description,
        tags: parseJsonArray(row.tags).join(", "), isPast: Boolean(row.isPast),
        photos,
      });
      setEditingEventId(row.id);
      setSavedEventPhotos(photos);
    }
    setShowEventForm(true);
  };

  const cancelSpaceEditor = () => {
    discardUnsavedMedia(spaceForm.photos, savedSpacePhotos, password, username);
    setShowSpaceForm(false);
    setEditingSpaceId(null);
    setSpaceForm(emptySpace);
    setSavedSpacePhotos([]);
  };

  const openSpaceEditor = (row: SpaceRow | null) => {
    discardUnsavedMedia(spaceForm.photos, savedSpacePhotos, password, username);
    if (!row) {
      setSpaceForm(emptySpace);
      setEditingSpaceId(null);
      setSavedSpacePhotos([]);
    } else {
      const photos = rowGallery(row.imageUrl, row.photos);
      setSpaceForm({
        title: row.title, icon: row.icon, description: row.description, photos,
      });
      setEditingSpaceId(row.id);
      setSavedSpacePhotos(photos);
    }
    setShowSpaceForm(true);
  };

  const liveHref = tab === "events" ? "/events" : tab === "community" ? "/community-area" : "/";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-display text-lg font-bold text-brand-green">Website</h3>
          <p className="mt-1 max-w-xl text-sm text-brand-green-dark/70">
            What guests see on Events and Community Area. Photos preview here; they go live when you save.
          </p>
        </div>
        {tab !== "heroes" ? (
          <a
            href={liveHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 self-start rounded-full border border-brand-mist bg-white px-3 py-1.5 text-xs font-medium text-brand-green hover:bg-brand-sand/60"
          >
            View live page <ExternalLinkIcon className="size-3.5" />
          </a>
        ) : null}
      </div>

      <div className={managementSectionTabsClass} role="tablist" aria-label="Website pages">
        {([
          ["events", "Events"],
          ["community", "Community Area"],
          ["heroes", "Hero Videos"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            disabled={locked}
            onClick={() => setTab(id)}
            className={cn(
              managementSectionTabClass,
              tab === id ? managementSectionTabActiveClass : managementSectionTabInactiveClass
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "heroes" && (
        <AdminHeroVideos password={password} username={username} />
      )}

      {tab === "events" && (
        <div className="flex flex-col gap-8">
          <section className="overflow-hidden rounded-2xl border border-brand-mist bg-white">
            <HeroPreview
              image={eventsCopy.hero.ribbonImage}
              title={eventsCopy.hero.title}
              subtitle={eventsCopy.hero.subtitle}
            />
            <div className="flex flex-col gap-4 p-4 md:p-6">
              <div>
                <h4 className="font-display text-base font-semibold text-brand-green-dark">Page look</h4>
                <p className="text-xs text-brand-green-dark/55">Hero still is the fallback when video does not play. Hero video is managed in the Hero Videos tab.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Hero title" value={eventsCopy.hero.title} onChange={(v) => setEventsCopy({ ...eventsCopy, hero: { ...eventsCopy.hero, title: v } })} />
                <Field label="Chips (comma separated)" value={eventsCopy.hero.chips.join(", ")} onChange={(v) => setEventsCopy({ ...eventsCopy, hero: { ...eventsCopy.hero, chips: v.split(",").map((s) => s.trim()).filter(Boolean) } })} />
                <div className="md:col-span-2">
                  <Area label="Hero subtitle" value={eventsCopy.hero.subtitle} onChange={(v) => setEventsCopy({ ...eventsCopy, hero: { ...eventsCopy.hero, subtitle: v } })} />
                </div>
                <div className="md:col-span-2">
                  <SiteImageField label="Hero still image" value={eventsCopy.hero.ribbonImage} kind="hero" folder="heroes" password={password} username={username} onBusy={onBusy} disabled={locked} onChange={(url) => setEventsCopy((prev) => ({ ...prev, hero: { ...prev.hero, ribbonImage: url } }))} />
                </div>
                <Field label="Bottom CTA title" value={eventsCopy.pastCta.title} onChange={(v) => setEventsCopy({ ...eventsCopy, pastCta: { ...eventsCopy.pastCta, title: v } })} />
                <Area label="Bottom CTA text" value={eventsCopy.pastCta.body} onChange={(v) => setEventsCopy({ ...eventsCopy, pastCta: { ...eventsCopy.pastCta, body: v } })} />
              </div>
              <div>
                <Button type="button" onClick={saveEventsCopy} disabled={locked}>{saving ? "Saving…" : busyUploads ? "Uploading…" : "Save page look"}</Button>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-display text-base font-semibold text-brand-green-dark">Event cards</h4>
              <Button type="button" size="sm" disabled={locked} onClick={() => openEventEditor(null)}>
                <PlusIcon className="mr-1 size-4" /> Add event
              </Button>
            </div>
            {showEventForm && (
              <EventEditor
                key={editingEventId ?? "new"}
                form={eventForm}
                setForm={setEventForm}
                password={password}
                username={username}
                saving={locked}
                uploading={busyUploads > 0}
                editing={editingEventId != null}
                onBusy={onBusy}
                onSave={saveEvent}
                onCancel={cancelEventEditor}
              />
            )}
            <EventGrid
              title="Upcoming"
              rows={upcoming}
              locked={locked}
              editingId={editingEventId}
              onEdit={(row) => openEventEditor(row)}
              onDelete={async (row) => {
                if (editingEventId === row.id) return;
                if (!confirm(`Delete “${row.title}”?`)) return;
                await deleteItem("deleteEvent", row.id, "Event deleted");
              }}
            />
            <EventGrid
              title="Past / memories"
              rows={past}
              locked={locked}
              editingId={editingEventId}
              onEdit={(row) => openEventEditor(row)}
              onDelete={async (row) => {
                if (editingEventId === row.id) return;
                if (!confirm(`Delete “${row.title}”?`)) return;
                await deleteItem("deleteEvent", row.id, "Event deleted");
              }}
            />
          </section>
        </div>
      )}

      {tab === "community" && (
        <div className="flex flex-col gap-8">
          <section className="overflow-hidden rounded-2xl border border-brand-mist bg-white">
            <HeroPreview
              image={communityCopy.hero.ribbonImage}
              title={communityCopy.hero.title}
              subtitle={communityCopy.hero.subtitle}
            />
            <div className="flex flex-col gap-4 p-4 md:p-6">
              <h4 className="font-display text-base font-semibold text-brand-green-dark">Page look</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Hero title" value={communityCopy.hero.title} onChange={(v) => setCommunityCopy({ ...communityCopy, hero: { ...communityCopy.hero, title: v } })} />
                <div className="md:col-span-2">
                  <Area label="Hero subtitle" value={communityCopy.hero.subtitle} onChange={(v) => setCommunityCopy({ ...communityCopy, hero: { ...communityCopy.hero, subtitle: v } })} />
                </div>
                <div className="md:col-span-2">
                  <SiteImageField label="Hero still (video in Hero Videos tab)" value={communityCopy.hero.ribbonImage} kind="hero" folder="heroes" password={password} username={username} onBusy={onBusy} disabled={locked} onChange={(url) => setCommunityCopy((prev) => ({ ...prev, hero: { ...prev.hero, ribbonImage: url } }))} />
                </div>
              </div>

              <details className="rounded-xl border border-brand-mist bg-brand-sand/20 p-4 open:bg-white">
                <summary className="cursor-pointer font-medium text-brand-green-dark">Intro</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <Field label="Intro title" value={communityCopy.intro.title} onChange={(v) => setCommunityCopy({ ...communityCopy, intro: { ...communityCopy.intro, title: v } })} />
                  <Area label="Intro paragraph" value={communityCopy.intro.paragraph} onChange={(v) => setCommunityCopy({ ...communityCopy, intro: { ...communityCopy.intro, paragraph: v } })} />
                </div>
              </details>

              <details className="rounded-xl border border-brand-mist bg-brand-sand/20 p-4 open:bg-white">
                <summary className="cursor-pointer font-medium text-brand-green-dark">Activities & weekly rhythm</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <Field label="Activities title" value={communityCopy.activities.title} onChange={(v) => setCommunityCopy({ ...communityCopy, activities: { ...communityCopy.activities, title: v } })} />
                  <Field label="Activities subtitle" value={communityCopy.activities.subtitle} onChange={(v) => setCommunityCopy({ ...communityCopy, activities: { ...communityCopy.activities, subtitle: v } })} />
                  <Field label="Activity badges (comma separated)" value={communityCopy.activities.badges.join(", ")} onChange={(v) => setCommunityCopy({ ...communityCopy, activities: { ...communityCopy.activities, badges: v.split(",").map((s) => s.trim()).filter(Boolean) } })} />
                  <Field label="Weekly rhythm title" value={communityCopy.activities.rhythmTitle} onChange={(v) => setCommunityCopy({ ...communityCopy, activities: { ...communityCopy.activities, rhythmTitle: v } })} />
                  <Area label="Weekly rhythm intro" value={communityCopy.activities.rhythmIntro} onChange={(v) => setCommunityCopy({ ...communityCopy, activities: { ...communityCopy.activities, rhythmIntro: v } })} />
                  <div className="flex flex-col gap-2">
                    <Label>Weekly schedule</Label>
                    {communityCopy.activities.weekly.map((w, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                        <Input value={w.label} onChange={(e) => {
                          const weekly = communityCopy.activities.weekly.map((row, idx) => idx === i ? { ...row, label: e.target.value } : row);
                          setCommunityCopy({ ...communityCopy, activities: { ...communityCopy.activities, weekly } });
                        }} />
                        <Input value={w.text} onChange={(e) => {
                          const weekly = communityCopy.activities.weekly.map((row, idx) => idx === i ? { ...row, text: e.target.value } : row);
                          setCommunityCopy({ ...communityCopy, activities: { ...communityCopy.activities, weekly } });
                        }} />
                      </div>
                    ))}
                  </div>
                </div>
              </details>

              <details className="rounded-xl border border-brand-mist bg-brand-sand/20 p-4 open:bg-white">
                <summary className="cursor-pointer font-medium text-brand-green-dark">Special event cards</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {communityCopy.specialEvents.cards.map((c, i) => (
                    <div key={i} className="flex flex-col gap-2 rounded-xl border border-brand-mist p-3">
                      <Input value={c.title} onChange={(e) => {
                        const cards = communityCopy.specialEvents.cards.map((row, idx) => idx === i ? { ...row, title: e.target.value } : row);
                        setCommunityCopy({ ...communityCopy, specialEvents: { ...communityCopy.specialEvents, cards } });
                      }} />
                      <Textarea value={c.description} onChange={(e) => {
                        const cards = communityCopy.specialEvents.cards.map((row, idx) => idx === i ? { ...row, description: e.target.value } : row);
                        setCommunityCopy({ ...communityCopy, specialEvents: { ...communityCopy.specialEvents, cards } });
                      }} />
                    </div>
                  ))}
                </div>
              </details>

              <div>
                <Button type="button" onClick={saveCommunityCopy} disabled={locked}>{saving ? "Saving…" : busyUploads ? "Uploading…" : "Save page look"}</Button>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-display text-base font-semibold text-brand-green-dark">Common spaces</h4>
              <Button type="button" size="sm" disabled={locked} onClick={() => openSpaceEditor(null)}>
                <PlusIcon className="mr-1 size-4" /> Add space
              </Button>
            </div>
            {showSpaceForm && (
              <div key={editingSpaceId ?? "new"} className="flex flex-col gap-4 rounded-2xl border border-brand-green/20 bg-white p-4 shadow-sm md:p-6">
                <p className="text-sm font-medium text-brand-green">{editingSpaceId ? "Edit space" : "New space"}</p>
                <Field label="Title" value={spaceForm.title} onChange={(v) => setSpaceForm((prev) => ({ ...prev, title: v }))} />
                <div className="flex flex-col gap-1.5">
                  <Label>Icon</Label>
                  <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                    {ICON_NAMES.map((name) => (
                      <button
                        key={name}
                        type="button"
                        title={name}
                        aria-label={name}
                        onClick={() => setSpaceForm((prev) => ({ ...prev, icon: name }))}
                        className={cn(
                          "flex size-10 items-center justify-center rounded-xl border text-brand-green-dark transition-colors",
                          spaceForm.icon === name
                            ? "border-brand-green bg-brand-green/10 text-brand-green"
                            : "border-brand-mist hover:bg-brand-sand/50",
                        )}
                      >
                        <Icon name={name} className="size-5" />
                      </button>
                    ))}
                  </div>
                </div>
                <Area label="Description" value={spaceForm.description} onChange={(v) => setSpaceForm((prev) => ({ ...prev, description: v }))} />
                <SiteImageGallery
                  label="Photos"
                  values={spaceForm.photos}
                  kind="card"
                  folder="community"
                  password={password}
                  username={username}
                  onBusy={onBusy}
                  disabled={locked}
                  onChange={(photos) => setSpaceForm((prev) => ({ ...prev, photos }))}
                />
                <div className="flex gap-2">
                  <Button type="button" onClick={saveSpace} disabled={locked}>{saving ? "Saving…" : busyUploads ? "Uploading…" : editingSpaceId ? "Save space" : "Add space"}</Button>
                  <Button type="button" variant="outline" disabled={locked} onClick={cancelSpaceEditor}>Cancel</Button>
                </div>
              </div>
            )}
            {spaces.length === 0 ? <p className="text-sm text-brand-green-dark/50">None yet.</p> : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {spaces.map((row) => {
                  const photos = rowGallery(row.imageUrl, row.photos);
                  return (
                    <li key={row.id} className="overflow-hidden rounded-2xl border border-brand-mist bg-white">
                      <div className="relative aspect-[16/10] bg-brand-sand">
                        {photos[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photos[0]} alt="" className="size-full object-cover" />
                        ) : null}
                        {photos.length > 1 ? (
                          <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
                            {photos.length} photos
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-start gap-2 p-3">
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-green/10 text-brand-green">
                          <Icon name={row.icon} className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-brand-green-dark">{row.title}</p>
                          <p className="line-clamp-2 text-xs text-brand-green-dark/60">{row.description}</p>
                        </div>
                        <Button type="button" size="icon-sm" variant="ghost" disabled={locked} aria-label={`Edit ${row.title}`} onClick={() => openSpaceEditor(row)}><PencilIcon className="size-4" /></Button>
                        <Button type="button" size="icon-sm" variant="ghost" disabled={locked || editingSpaceId === row.id} aria-label={`Delete ${row.title}`} onClick={async () => {
                          if (!confirm(`Delete “${row.title}”?`)) return;
                          await deleteItem("deleteSpace", row.id, "Space deleted");
                        }}><Trash2Icon className="size-4" /></Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function HeroPreview({ image, title, subtitle }: { image: string; title: string; subtitle: string }) {
  return (
    <div className="relative aspect-[16/9] max-h-56 w-full overflow-hidden bg-brand-green-dark sm:max-h-64">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-full object-cover" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4 md:p-6">
        <p className="font-display text-xl font-bold text-white drop-shadow md:text-2xl">{title || "Hero title"}</p>
        {subtitle ? <p className="mt-1 line-clamp-2 text-sm text-white/85">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
    </div>
  );
}

function EventEditor({
  form, setForm, password, username, saving, uploading, editing, onBusy, onSave, onCancel,
}: {
  form: EventForm;
  setForm: Dispatch<SetStateAction<EventForm>>;
  password: string;
  username?: string;
  saving: boolean;
  uploading: boolean;
  editing: boolean;
  onBusy: (busy: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-brand-green/20 bg-white p-4 shadow-sm md:p-6">
      <p className="text-sm font-medium text-brand-green">{editing ? "Edit event" : "New event"}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Date (as shown on the card)" value={form.date} onChange={(v) => setForm((prev) => ({ ...prev, date: v }))} />
        <Field label="Title" value={form.title} onChange={(v) => setForm((prev) => ({ ...prev, title: v }))} />
        <div className="md:col-span-2">
          <Area label="Description" value={form.description} onChange={(v) => setForm((prev) => ({ ...prev, description: v }))} />
        </div>
        <Field label="Tags (comma separated)" value={form.tags} onChange={(v) => setForm((prev) => ({ ...prev, tags: v }))} />
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-brand-green-dark">
          <Checkbox
            checked={form.isPast}
            disabled={saving}
            onCheckedChange={(checked) => setForm((prev) => ({ ...prev, isPast: checked === true }))}
          />
          Past event (moves it to Memories)
        </label>
        <div className="md:col-span-2">
          <SiteImageGallery
            label="Photos"
            values={form.photos}
            kind="card"
            folder="events"
            password={password}
            username={username}
            onBusy={onBusy}
            disabled={saving}
            onChange={(photos) => setForm((prev) => ({ ...prev, photos }))}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={onSave} disabled={saving}>{saving && !uploading ? "Saving…" : uploading ? "Uploading…" : "Save event"}</Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function EventGrid({
  title, rows, locked, editingId, onEdit, onDelete,
}: {
  title: string;
  rows: EventRow[];
  locked: boolean;
  editingId: number | null;
  onEdit: (row: EventRow) => void;
  onDelete: (row: EventRow) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-green-dark/50">{title}</p>
      {rows.length === 0 ? <p className="text-sm text-brand-green-dark/50">None yet.</p> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((row) => {
            const photos = rowGallery(row.coverUrl, row.photos);
            return (
              <li key={row.id} className="overflow-hidden rounded-2xl border border-brand-mist bg-white">
                <div className="relative aspect-[16/10] bg-brand-sand">
                  {photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photos[0]} alt="" className="size-full object-cover" />
                  ) : null}
                  {photos.length > 1 ? (
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
                      {photos.length} photos
                    </span>
                  ) : null}
                </div>
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-brand-green-dark">{row.title}</p>
                    <p className="text-xs text-brand-red">{row.date}</p>
                  </div>
                  <Button type="button" size="icon-sm" variant="ghost" disabled={locked} aria-label={`Edit ${row.title}`} onClick={() => onEdit(row)}><PencilIcon className="size-4" /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" disabled={locked || editingId === row.id} aria-label={`Delete ${row.title}`} onClick={() => onDelete(row)}><Trash2Icon className="size-4" /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
