"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { NOTIFICATION_CATEGORIES, type NotificationCategory, type SelectableNotificationType } from "@/lib/notificationCatalog";

type PreferenceResponse = {
  allowedCategories?: NotificationCategory[];
  mutedNotificationTypes?: SelectableNotificationType[];
  error?: string;
};

export function NotificationPreferences({ password, username }: { password: string; username: string }) {
  const [endpoint, setEndpoint] = useState("");
  const [allowed, setAllowed] = useState<NotificationCategory[]>([]);
  const [muted, setMuted] = useState<Set<SelectableNotificationType>>(new Set());
  const [saved, setSaved] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "unsubscribed">("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [subscriptionRevision, setSubscriptionRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setSubscriptionRevision((revision) => revision + 1);
    window.addEventListener("goko:push-subscription-changed", refresh);
    return () => window.removeEventListener("goko:push-subscription-changed", refresh);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (!("serviceWorker" in navigator)) return active && setState("unsubscribed");
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (!subscription) return active && setState("unsubscribed");
        const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "getPreferences", password, username, endpoint: subscription.endpoint }) });
        const data: PreferenceResponse = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load notification preferences");
        if (!active) return;
        const nextMuted = new Set(data.mutedNotificationTypes || []);
        setEndpoint(subscription.endpoint);
        setAllowed(data.allowedCategories || []);
        setMuted(nextMuted);
        setSaved(JSON.stringify([...nextMuted].sort()));
        setState("ready");
      } catch (loadError) {
        if (active) { setError(loadError instanceof Error ? loadError.message : "Could not load notification preferences"); setState("ready"); }
      }
    };
    void load();
    return () => { active = false; };
  }, [password, username, subscriptionRevision]);

  const visibleCategories = useMemo(() => NOTIFICATION_CATEGORIES.filter((category) => allowed.includes(category.id)), [allowed]);
  const visibleTypes = useMemo(() => new Set(visibleCategories.flatMap((category) => category.events.map(([id]) => id))), [visibleCategories]);
  const dirty = JSON.stringify([...muted].filter((type) => visibleTypes.has(type)).sort()) !== JSON.stringify(JSON.parse(saved || "[]").filter((type: SelectableNotificationType) => visibleTypes.has(type)).sort());

  const toggleType = (type: SelectableNotificationType) => setMuted((current) => {
    const next = new Set(current);
    if (next.has(type)) next.delete(type); else next.add(type);
    return next;
  });

  const toggleCategory = (category: typeof NOTIFICATION_CATEGORIES[number]) => setMuted((current) => {
    const next = new Set(current);
    const types = category.events.map(([id]) => id);
    if (types.every((type) => !next.has(type))) types.forEach((type) => next.add(type));
    else types.forEach((type) => next.delete(type));
    return next;
  });

  const save = async () => {
    if (!endpoint || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updatePreferences", password, username, endpoint, mutedNotificationTypes: [...muted].filter((type) => visibleTypes.has(type)) }) });
      const data: PreferenceResponse = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save notification preferences");
      const nextMuted = new Set(data.mutedNotificationTypes || []);
      setAllowed(data.allowedCategories || []); setMuted(nextMuted); setSaved(JSON.stringify([...nextMuted].sort())); setMessage("Notification preferences saved on this device.");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save notification preferences"); }
    finally { setBusy(false); }
  };

  return <div className="rounded-2xl border border-brand-mist bg-white p-5 shadow-sm dark:bg-card dark:shadow-none">
    <h3 className="font-display text-lg font-bold text-brand-green-dark">Notifications</h3>
    <p className="mt-1 text-sm text-muted-foreground">Choose alerts for this device. Your administrator controls which categories are available.</p>
    {state === "loading" && <p className="mt-4 text-sm text-muted-foreground">Loading notification preferences…</p>}
    {state === "unsubscribed" && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Enable notifications from the bell in the top bar first.</p>}
    {state === "ready" && visibleCategories.length === 0 && !error && <p className="mt-4 text-sm text-muted-foreground">Your administrator has not enabled any notification categories.</p>}
    {state === "ready" && visibleCategories.map((category) => {
      const types = category.events.map(([id]) => id);
      const enabledCount = types.filter((type) => !muted.has(type)).length;
      return <fieldset key={category.id} className="mt-4 rounded-xl border border-brand-mist p-3">
        <label className="flex items-center gap-2 font-medium text-brand-green-dark">
          <input type="checkbox" disabled={busy} checked={enabledCount === types.length} ref={(input) => { if (input) input.indeterminate = enabledCount > 0 && enabledCount < types.length; }} onChange={() => toggleCategory(category)} />
          {category.label}
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {category.events.map(([id, label]) => <label key={id} className="flex items-center gap-2 text-sm text-brand-green-dark/80">
            <input type="checkbox" disabled={busy} checked={!muted.has(id)} onChange={() => toggleType(id)} /> {label}
          </label>)}
        </div>
      </fieldset>;
    })}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
    {state === "ready" && visibleCategories.length > 0 && <Button type="button" className="mt-4" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save notification preferences"}</Button>}
  </div>;
}
