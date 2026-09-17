"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NATIVE_BOOKING_URL } from "@/lib/bookingDestination";
import { DEFAULT_WEBSITE_BOOKING_SETTINGS, type WebsiteBookingSettings, type gatewayConfiguration } from "@/lib/websiteBookingSettings";

type Gateway = ReturnType<typeof gatewayConfiguration>;
type Section = "policies" | "rooms" | "payments";

export function BookingSettings({ password, username }: { password: string; username?: string }) {
  const [section, setSection] = useState<Section>("policies");
  const [settings, setSettings] = useState<WebsiteBookingSettings>({ ...DEFAULT_WEBSITE_BOOKING_SETTINGS });
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/admin/booking-settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, username, action, ...extra }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Booking settings request failed");
    return data;
  }

  useEffect(() => {
    let active = true;
    setBusy(true); setLoaded(false); setMessage(""); setGateway(null);
    call("getSettings").then((data) => {
      if (active) { setSettings(data.settings); setGateway(data.gateway); setLoaded(true); }
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Unable to load settings. Refresh this tab to retry; unsaved defaults are not active."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
    // Credential changes reload the authenticated configuration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password, username, reload]);

  async function save() {
    setBusy(true); setMessage("");
    try {
      const data = await call("saveSettings", { settings });
      setSettings(data.settings);
      setGateway(data.gateway);
      setMessage("Draft settings saved. Native checkout remains disabled.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save settings"); }
    finally { setBusy(false); }
  }

  async function check() {
    setBusy(true); setMessage("");
    try {
      const data = await call("checkGatewayReadiness");
      setGateway(data.gateway); setMessage(data.message);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to check configuration"); }
    finally { setBusy(false); }
  }

  const numberField = (key: keyof WebsiteBookingSettings, label: string, min: number, max: number) => (
    <label className="grid gap-1 text-sm" key={key}>
      {label}
      <Input type="number" min={min} max={max} step="1" value={Number(settings[key])}
        onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} />
    </label>
  );

  return <div className="space-y-5">
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <h3 className="font-semibold">Native booking setup — checkout not yet enabled</h3>
      <p className="mt-1">These are draft configuration values, not published payment or refund promises. Saving a Goko link does not activate Razorpay. External booking links continue to use the provider’s checkout.</p>
    </div>
    <nav aria-label="Booking settings sections" className="flex flex-wrap gap-2">
      {([["policies", "Booking & Policies"], ["rooms", "Rooms & Rates"], ["payments", "Payments & Readiness"]] as const).map(([id, title]) =>
        <Button type="button" key={id} variant={section === id ? "default" : "outline"} onClick={() => setSection(id)} aria-pressed={section === id}>{title}</Button>)}
    </nav>
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    {!loaded && !busy && <Button type="button" variant="outline" onClick={() => setReload((value) => value + 1)}>Retry loading saved settings</Button>}
    <fieldset disabled={busy || !loaded} className="space-y-4 disabled:opacity-60">
      {section === "policies" && <>
        <div className="grid gap-4 sm:grid-cols-2">
          {numberField("advancePercent", "Advance payment (%)", 0, 100)}
          {numberField("holdMinutes", "Initial inventory hold (minutes)", 5, 15)}
          {numberField("unresolvedPaymentMaxMinutes", "Maximum unresolved payment window (minutes from creation)", 15, 30)}
          {numberField("cancellationDeadlineHours", "Free cancellation deadline (hours before arrival)", 0, 720)}
          {numberField("cancellationRefundPercent", "Draft eligible cancellation refund (%)", 0, 100)}
        </div>
        {([["allowFullPayment", "Offer full payment"], ["allowPayAtProperty", "Offer normal pay-at-property"]] as const).map(([key, label]) =>
          <label key={key} className="flex gap-2 text-sm"><input type="checkbox" checked={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })} />{label}</label>)}
        <p className="text-xs text-muted-foreground">Gateway-outage pay-at-property fallback will be mandatory regardless of the normal pay-at-property setting. Payment uncertainty must be reconciled before charging again.</p>
        <label className="grid gap-1 text-sm">Draft guest-facing cancellation policy
          <textarea className="min-h-32 rounded-lg border bg-background p-3" maxLength={4000} value={settings.policyText} onChange={(e) => setSettings({ ...settings, policyText: e.target.value })} />
        </label>
      </>}
      {section === "rooms" && <div className="rounded-lg border p-4 text-sm">
        <h3 className="font-semibold">Use existing rooms, rates and website content</h3>
        <p className="mt-2">Inventory owns daily rates and restrictions. Website owns room descriptions and photographs. Channel Manager owns dorm and rate-plan mappings. Native guest-category publishing and sellable-unit mapping are still pending; no new rate catalogue is created here.</p>
        <p className="mt-3"><a className="underline" href="/admin?section=inventory">Open Inventory</a> · <a className="underline" href="/admin?section=management&tab=website">Website content</a> · <a className="underline" href="/admin?section=management&tab=channelManager">Channel Manager</a></p>
      </div>}
      {section === "payments" && <>
        <label className="grid max-w-sm gap-1 text-sm">Gateway configuration environment
          <select className="rounded-lg border bg-background p-2" value={settings.gatewayEnvironment} onChange={(e) => setSettings({ ...settings, gatewayEnvironment: e.target.value as "test" | "live" })}>
            <option value="test">Test (authenticated preview only)</option><option value="live">Live (production)</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">Save the environment selection before checking its configuration. Public production checkout must never use test credentials.</p>
        <div className="rounded-lg border p-4 text-sm space-y-2">
          <p>Store credentials as deployment secrets, not in a booking URL or database setting:</p>
          <ul className="list-disc pl-5">
            <li><code>RAZORPAY_TEST_KEY_ID</code>, <code>RAZORPAY_TEST_KEY_SECRET</code>, <code>RAZORPAY_TEST_WEBHOOK_SECRET</code></li>
            <li><code>RAZORPAY_LIVE_KEY_ID</code>, <code>RAZORPAY_LIVE_KEY_SECRET</code>, <code>RAZORPAY_LIVE_WEBHOOK_SECRET</code></li>
          </ul>
          <p>Goko guest link: <code>{NATIVE_BOOKING_URL}</code></p>
          <p>Planned webhook path: <code>/api/webhooks/razorpay</code> (not implemented; do not register yet).</p>
          <p>Capture and bank settlement are separate: confirmed customer payment is not a bank credit. Real-bank net settlement configuration will be added with the payment ledger.</p>
          {gateway && <dl className="grid gap-1">
            <div><dt className="inline">Checked environment: </dt><dd className="inline">{gateway.environment}</dd></div>
            <div><dt className="inline">Public key ID: </dt><dd className="inline">{gateway.publicKeyId || "Not configured / wrong environment"}</dd></div>
            <div><dt className="inline">Server key secret: </dt><dd className="inline">{gateway.keySecretConfigured ? "Present" : "Missing"}</dd></div>
            <div><dt className="inline">Webhook secret: </dt><dd className="inline">{gateway.webhookSecretConfigured ? "Present" : "Missing"}</dd></div>
            <div><dt className="inline">Checkout: </dt><dd className="inline">Disabled — implementation pending</dd></div>
          </dl>}
        </div>
        <Button type="button" variant="outline" onClick={check}>Check saved credential configuration (no charge)</Button>
      </>}
      <Button type="button" onClick={save}>Save draft settings</Button>
    </fieldset>
  </div>;
}
