"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NATIVE_BOOKING_URL } from "@/lib/bookingDestination";
import { DEFAULT_WEBSITE_BOOKING_SETTINGS, type WebsiteBookingSettings, type gatewayConfiguration } from "@/lib/websiteBookingSettings";
import { RazorpayTestPreview } from "@/components/admin/RazorpayTestPreview";
import { WebsitePaymentsLedger } from "@/components/admin/WebsitePaymentsLedger";
import {
  BOOKING_EMAIL_KINDS,
  BOOKING_EMAIL_KIND_LABELS,
  BOOKING_EMAIL_PLACEHOLDERS,
  DEFAULT_BOOKING_EMAIL_TEMPLATES,
  type BookingEmailKind,
  type BookingEmailTemplates,
} from "@/lib/bookingEmailTemplates";
import {
  BOOKING_SMS_KINDS,
  BOOKING_SMS_KIND_LABELS,
  BOOKING_SMS_PLACEHOLDERS,
  BOOKING_SMS_SOFT_LIMIT,
  DEFAULT_BOOKING_SMS_TEMPLATES,
  type BookingSmsKind,
  type BookingSmsTemplates,
} from "@/lib/bookingSmsTemplates";

type Gateway = ReturnType<typeof gatewayConfiguration>;
type Section = "policies" | "rooms" | "payments" | "emails" | "sms";

export function BookingSettings({ password, username }: { password: string; username?: string }) {
  const [section, setSection] = useState<Section>("policies");
  const [settings, setSettings] = useState<WebsiteBookingSettings>({ ...DEFAULT_WEBSITE_BOOKING_SETTINGS });
  const [emailTemplates, setEmailTemplates] = useState<BookingEmailTemplates>({ ...DEFAULT_BOOKING_EMAIL_TEMPLATES });
  const [smsTemplates, setSmsTemplates] = useState<BookingSmsTemplates>({ ...DEFAULT_BOOKING_SMS_TEMPLATES });
  const [emailKind, setEmailKind] = useState<BookingEmailKind>("confirmation");
  const [smsKind, setSmsKind] = useState<BookingSmsKind>("confirmation");
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [readiness, setReadiness] = useState<{ nativeCheckoutReady: boolean; blockers: string[] } | null>(null);
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [revision, setRevision] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch("/api/admin/booking-settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, username, action, ...extra }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === "BOOKING_SETTINGS_CONFLICT") { setLoaded(false); setRevision(""); }
      throw new Error(data.error || "Booking settings request failed");
    }
    return data;
  }

  useEffect(() => {
    let active = true;
    setBusy(true); setLoaded(false); setMessagesLoaded(false); setRevision(""); setMessage(""); setGateway(null);
    Promise.all([call("getSettings"), call("getEmailTemplates"), call("getSmsTemplates")]).then(([data, emails, sms]) => {
      if (active) {
        setSettings(data.settings); setRevision(data.revision); setGateway(data.gateway);
        setReadiness(data.readiness || null); setLoaded(true);
        if (emails.templates) setEmailTemplates(emails.templates);
        if (sms.templates) setSmsTemplates(sms.templates);
        setMessagesLoaded(true);
      }
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Unable to load settings. Refresh this tab to retry; unsaved defaults are not active."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
    // Credential changes reload the authenticated configuration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password, username, reload]);

  async function save() {
    setBusy(true); setMessage("");
    try {
      const data = await call("saveSettings", { settings, revision });
      setSettings(data.settings);
      setRevision(data.revision);
      setGateway(data.gateway);
      setReadiness(data.readiness || null);
      const env = data.settings?.gatewayEnvironment === "live" ? "live" : "test";
      setMessage(data.readiness?.nativeCheckoutReady
        ? `Settings saved. Native guest checkout is ready (${env} Razorpay).`
        : "Settings saved. Checkout stays blocked until readiness blockers are cleared.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save settings"); }
    finally { setBusy(false); }
  }

  async function saveEmails() {
    setBusy(true); setMessage("");
    try {
      const data = await call("saveEmailTemplates", { templates: emailTemplates });
      setEmailTemplates(data.templates);
      setMessage("Email templates saved. Confirmation is used for new website bookings; Updated and Cancelled are reserved until wired.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save email templates"); }
    finally { setBusy(false); }
  }

  async function saveSms() {
    setBusy(true); setMessage("");
    try {
      const data = await call("saveSmsTemplates", { templates: smsTemplates });
      setSmsTemplates(data.templates);
      setMessage("Text message templates saved. Sending is not enabled yet — drafts are ready for when SMS is turned on.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to save text templates"); }
    finally { setBusy(false); }
  }

  async function check() {
    setBusy(true); setMessage("");
    try {
      const data = await call("checkGatewayReadiness");
      setGateway(data.gateway); setReadiness(data.readiness || null); setMessage(data.message);
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

  const envLabel = settings.gatewayEnvironment === "live" ? "Live (real money)" : "Test";
  const activeEmail = emailTemplates[emailKind];
  const activeSms = smsTemplates[smsKind];
  const smsLen = activeSms.body.length;
  const messageSection = section === "emails" || section === "sms";

  return <div className="space-y-5">
    <div className={`rounded-xl border p-4 text-sm ${settings.gatewayEnvironment === "live" ? "border-brand-red bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
      <h3 className="font-semibold">
        {readiness?.nativeCheckoutReady
          ? `Native checkout ready — ${envLabel}`
          : "Native booking setup — clear readiness blockers before guests can pay"}
      </h3>
      <p className="mt-1">
        Flip Test ↔ Live below, then Save. Live uses <code>RAZORPAY_LIVE_*</code> Worker secrets and charges real money.
      </p>
    </div>
    <nav aria-label="Booking settings sections" className="flex flex-wrap gap-2">
      {([["policies", "Booking & Policies"], ["rooms", "Rooms & Rates"], ["payments", "Payments & Readiness"], ["emails", "Email Templates"], ["sms", "Text Templates"]] as const).map(([id, title]) =>
        <Button type="button" key={id} variant={section === id ? "default" : "outline"} onClick={() => setSection(id)} aria-pressed={section === id}>{title}</Button>)}
    </nav>
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    {!loaded && !busy && <Button type="button" variant="outline" onClick={() => setReload((value) => value + 1)}>Retry loading saved settings</Button>}
    <fieldset disabled={busy || (!loaded && !messageSection) || (messageSection && !messagesLoaded)} className="space-y-4 disabled:opacity-60">
      {section === "policies" && <>
        <div className="grid gap-4 sm:grid-cols-2">
          {numberField("maxSelectedBeds", "Maximum beds per website selection (whole doubles count as one bed)", 1, 100)}
          {numberField("advancePercent", "Advance payment (%)", 0, 100)}
          {numberField("holdMinutes", "Initial inventory hold (minutes)", 5, 15)}
          {numberField("unresolvedPaymentMaxMinutes", "Maximum unresolved payment window (minutes from creation)", 15, 30)}
          {numberField("cancellationDeadlineHours", "Free cancellation deadline (hours before arrival)", 0, 720)}
          {numberField("cancellationRefundPercent", "Draft eligible cancellation refund (%)", 0, 100)}
        </div>
        {([["allowFullPayment", "Offer full payment"], ["allowPayAtProperty", "Offer normal pay-at-property"], ["requireLookupOtp", "Require email OTP for My booking lookup"]] as const).map(([key, label]) =>
          <label key={key} className="flex gap-2 text-sm"><input type="checkbox" checked={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })} />{label}</label>)}
        <p className="text-xs text-muted-foreground">Gateway-outage pay-at-property fallback will be mandatory regardless of the normal pay-at-property setting. Payment uncertainty must be reconciled before charging again.</p>
        <p className="text-xs text-muted-foreground">OTP for My booking is on by default. Turning it off lets guests open a booking with confirmation number + email only (weaker proof — use carefully).</p>
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
        <label className="grid max-w-sm gap-1 text-sm font-semibold">Gateway mode (flip here)
          <select className="rounded-lg border bg-background p-2 font-normal" value={settings.gatewayEnvironment} onChange={(e) => setSettings({ ...settings, gatewayEnvironment: e.target.value as "test" | "live" })}>
            <option value="test">Test — Razorpay test keys (no real money)</option>
            <option value="live">Live — Razorpay live keys (real money)</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">Save after changing. Public checkout uses only the selected mode’s credentials.</p>
        <div className="rounded-lg border p-4 text-sm space-y-2">
          <p>Store credentials as Worker secrets (not in D1):</p>
          <ul className="list-disc pl-5">
            <li><code>RAZORPAY_TEST_KEY_ID</code>, <code>RAZORPAY_TEST_KEY_SECRET</code>, <code>RAZORPAY_TEST_WEBHOOK_SECRET</code></li>
            <li><code>RAZORPAY_LIVE_KEY_ID</code>, <code>RAZORPAY_LIVE_KEY_SECRET</code>, <code>RAZORPAY_LIVE_WEBHOOK_SECRET</code></li>
          </ul>
          <p>Goko guest link: <code>{NATIVE_BOOKING_URL}</code></p>
          <p>Webhook URL (register separately in Razorpay Test and Live dashboards): <code>/api/webhooks/razorpay</code></p>
          {gateway && <dl className="grid gap-1">
            <div><dt className="inline">Checked environment: </dt><dd className="inline">{gateway.environment}</dd></div>
            <div><dt className="inline">Public key ID: </dt><dd className="inline">{gateway.publicKeyId || "Not configured / wrong environment"}</dd></div>
            <div><dt className="inline">Server key secret: </dt><dd className="inline">{gateway.keySecretConfigured ? "Present" : "Missing"}</dd></div>
            <div><dt className="inline">Webhook secret: </dt><dd className="inline">{gateway.webhookSecretConfigured ? "Present" : "Missing"}</dd></div>
            <div><dt className="inline">Checkout: </dt><dd className="inline">{readiness?.nativeCheckoutReady ? `Ready (${gateway.environment})` : "Blocked"}</dd></div>
            {readiness?.blockers?.length ? <div className="mt-2"><dt className="font-semibold">Blockers</dt><ul className="mt-1 list-disc pl-5">{readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div> : null}
          </dl>}
        </div>
        <Button type="button" variant="outline" onClick={check}>Check native checkout readiness</Button>
      </>}
      {section === "emails" && <>
        <p className="text-sm text-muted-foreground">
          Guest email for website bookings. <strong>Confirmation</strong> is sent when a booking is created.
          Updated and Cancelled are saved for later — not sent yet.
        </p>
        <nav aria-label="Email template kind" className="flex flex-wrap gap-2">
          {BOOKING_EMAIL_KINDS.map((kind) => (
            <Button type="button" key={kind} size="sm" variant={emailKind === kind ? "default" : "outline"} onClick={() => setEmailKind(kind)} aria-pressed={emailKind === kind}>
              {BOOKING_EMAIL_KIND_LABELS[kind]}
            </Button>
          ))}
        </nav>
        {emailKind !== "confirmation" && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            Reserved — not used in the guest workflow yet. Draft copy now; we will wire send later.
          </p>
        )}
        <label className="grid gap-1 text-sm font-semibold">Subject
          <Input maxLength={200} value={activeEmail.subject} onChange={(e) => setEmailTemplates({ ...emailTemplates, [emailKind]: { ...activeEmail, subject: e.target.value } })} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">Body
          <textarea className="min-h-56 rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed" maxLength={8000} value={activeEmail.body} onChange={(e) => setEmailTemplates({ ...emailTemplates, [emailKind]: { ...activeEmail, body: e.target.value } })} />
        </label>
        <div className="rounded-lg border p-3 text-xs">
          <p className="font-semibold text-foreground">Placeholders</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {BOOKING_EMAIL_PLACEHOLDERS.map((p) => (
              <li key={p.token}><code className="text-[11px]">{p.token}</code> — {p.label}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={saveEmails}>Save email templates</Button>
          <Button type="button" variant="outline" onClick={() => setEmailTemplates({ ...emailTemplates, [emailKind]: { ...DEFAULT_BOOKING_EMAIL_TEMPLATES[emailKind] } })}>
            Reset this template to default
          </Button>
        </div>
      </>}
      {section === "sms" && <>
        <p className="text-sm text-muted-foreground">
          Draft SMS / text messages for website bookings. <strong>No provider is connected yet</strong> — nothing is sent.
          Save drafts now so we can enable sending later without rewriting copy.
        </p>
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          All text templates are reserved. Aim for about {BOOKING_SMS_SOFT_LIMIT} characters per segment when you can; longer drafts are allowed (max 500).
        </p>
        <nav aria-label="Text template kind" className="flex flex-wrap gap-2">
          {BOOKING_SMS_KINDS.map((kind) => (
            <Button type="button" key={kind} size="sm" variant={smsKind === kind ? "default" : "outline"} onClick={() => setSmsKind(kind)} aria-pressed={smsKind === kind}>
              {BOOKING_SMS_KIND_LABELS[kind]}
            </Button>
          ))}
        </nav>
        <label className="grid gap-1 text-sm font-semibold">Message
          <textarea className="min-h-28 rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed" maxLength={500} value={activeSms.body} onChange={(e) => setSmsTemplates({ ...smsTemplates, [smsKind]: { body: e.target.value } })} />
          <span className={`text-xs font-normal ${smsLen > BOOKING_SMS_SOFT_LIMIT ? "text-amber-800" : "text-muted-foreground"}`}>
            {smsLen} / 500 characters{smsLen > BOOKING_SMS_SOFT_LIMIT ? ` (over ~${BOOKING_SMS_SOFT_LIMIT} single-segment guide)` : ""}
          </span>
        </label>
        <div className="rounded-lg border p-3 text-xs">
          <p className="font-semibold text-foreground">Placeholders</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {BOOKING_SMS_PLACEHOLDERS.map((p) => (
              <li key={p.token}><code className="text-[11px]">{p.token}</code> — {p.label}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={saveSms}>Save text templates</Button>
          <Button type="button" variant="outline" onClick={() => setSmsTemplates({ ...smsTemplates, [smsKind]: { ...DEFAULT_BOOKING_SMS_TEMPLATES[smsKind] } })}>
            Reset this template to default
          </Button>
        </div>
      </>}
      {!messageSection && <Button type="button" onClick={save}>Save booking settings</Button>}
    </fieldset>
    {section === "payments" && (
      <WebsitePaymentsLedger password={password} username={username} />
    )}
    {section === "payments" && settings.gatewayEnvironment === "test" && (
      <RazorpayTestPreview password={password} username={username} />
    )}
  </div>;
}
