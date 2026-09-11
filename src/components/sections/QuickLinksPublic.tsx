"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLinkIcon, LinkIcon, QrCodeIcon } from "lucide-react";

type Section = { id: number; name: string; description: string; displayOrder: number };
type Item = { id: number; sectionId: number; title: string; description: string; url: string; imageUrl: string; displayOrder: number };

export function QuickLinksPublic() {
  const [sections, setSections] = useState<Section[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/quick-links")
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load");
        return response.json();
      })
      .then((data) => { setSections(data.sections || []); setItems(data.items || []); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => new Map(sections.map((section) => [section.id, items.filter((item) => item.sectionId === section.id)])), [items, sections]);

  return (
    <main id="main-content" className="goko-mesh min-h-screen px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green text-white shadow-soft"><QrCodeIcon className="h-7 w-7" /></div>
          <h1 className="mt-5 font-display text-3xl font-bold text-brand-green-dark sm:text-4xl">Goko Guest Links</h1>
          <p className="mt-3 text-base leading-7 text-brand-green-dark/65">Scan or tap a service below for check-in, food ordering, payments, and more.</p>
        </div>
        {loading && <p className="mt-12 text-center text-sm text-brand-green-dark/60">Loading guest links…</p>}
        {error && <p className="mx-auto mt-12 max-w-md rounded-2xl bg-white/80 p-5 text-center text-sm text-red-700 shadow-soft">Guest links are temporarily unavailable. Please try again shortly.</p>}
        {!loading && !error && sections.length === 0 && <p className="mt-12 text-center text-sm text-brand-green-dark/60">No guest links have been added yet.</p>}
        {!loading && !error && <div className="mt-10 space-y-8">{sections.map((section) => {
          const sectionItems = grouped.get(section.id) || [];
          if (sectionItems.length === 0) return null;
          return <section key={section.id} aria-labelledby={`quick-links-section-${section.id}`} className="rounded-3xl border border-brand-mist/40 bg-white/90 p-5 shadow-card backdrop-blur-sm sm:p-7">
            <div className="text-center"><h2 id={`quick-links-section-${section.id}`} className="font-display text-2xl font-bold text-brand-green-dark">{section.name}</h2>{section.description && <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-brand-green-dark/60">{section.description}</p>}</div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{sectionItems.map((item) => <article key={item.id} className="flex min-w-0 flex-col rounded-2xl border border-brand-mist/50 bg-white p-4 text-center shadow-sm">
              {item.imageUrl && <a href={item.imageUrl} target="_blank" rel="noreferrer" className="group mx-auto flex w-full items-center justify-center rounded-xl bg-brand-sand p-3" aria-label={`Open ${item.title} QR image`}><img src={item.imageUrl} alt={`${item.title} QR code`} loading="lazy" className="h-auto w-auto max-w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]" style={{ width: "min(100%, 320px)", maxHeight: "min(70vw, 360px)" }} /></a>}
              <div className="mt-4 flex-1"><h3 className="font-display text-lg font-bold text-brand-green-dark">{item.title}</h3>{item.description && <p className="mt-2 text-sm leading-6 text-brand-green-dark/60">{item.description}</p>}</div>
              {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-green px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark"><ExternalLinkIcon className="h-4 w-4" />Open link</a>}
              {!item.url && !item.imageUrl && <span className="mt-4 inline-flex items-center justify-center gap-2 text-sm text-brand-green-dark/50"><LinkIcon className="h-4 w-4" />Information</span>}
            </article>)}</div>
          </section>;
        })}</div>}
      </div>
    </main>
  );
}
