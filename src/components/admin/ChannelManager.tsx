"use client";

import { MappingHealthPanel } from "./MappingHealthPanel";
import type { MappingIssue } from "@/lib/aiosellMappingHealth";
import { useState, useEffect } from "react";
import { useAdminToast } from "@/components/admin/AdminToast";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, todayIST } from "@/lib/utils";
import { DateRangePicker } from "@/components/dates/DateRangePicker";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import {
  RefreshCwIcon, SaveIcon, PlusIcon, Trash2Icon, PencilIcon,
  CheckCircleIcon, XCircleIcon, Loader2Icon, SendIcon,
  EyeIcon, EyeOffIcon,
} from "lucide-react";
import { bookingTaxPercent, DEFAULT_BOOKING_TAX_PERCENT } from "@/lib/bookingPricing";
import type { Role } from "./types";
import { ManagementSalesChannels } from "./ManagementSalesChannels";
import { ManagementBedConfig } from "./ManagementBedConfig";
import { bookingDestination, NATIVE_BOOKING_URL } from "@/lib/bookingDestination";
import {
  managementSectionTabActiveClass,
  managementSectionTabClass,
  managementSectionTabsClass,
  managementSectionTabInactiveClass,
} from "./managementSectionTabs";

function BookingEngineLinkPreview({ value, apiBaseUrl }: { value: string; apiBaseUrl: string }) {
  try {
    const destination = bookingDestination(value, apiBaseUrl);
    const label = destination.mode === "native" ? "Goko booking (checkout pending)" : destination.mode === "external" ? "External booking engine" : "Not configured — Booking enquiry";
    return <p className="mt-2 text-xs text-muted-foreground">Selected mode: {label}.{" "}
      <a className="underline" href={destination.url} target="_blank" rel="noopener noreferrer">Preview selected link</a>
      {" "}Unsaved edits are previews only.
    </p>;
  } catch (error) {
    return <p role="status" className="mt-2 text-xs text-red-600">{error instanceof Error ? error.message : "Invalid booking link"}</p>;
  }
}

function useChannelApi(password: string, username?: string) {
  const call = async (url: string, body: Record<string, any> = {}) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) break;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
    const data = await res!.json();
    if (!res!.ok) throw new Error(data.error || `Request failed (${res!.status})`);
    return data;
  };
  return { call };
}

type ChannelConfig = {
  id?: number;
  provider: string;
  hotelCode: string;
  pmsId: string;
  apiBaseUrl: string;
  apiUsername: string;
  apiPassword: string;
  webhookSecret: string;
  bookingEngineUrl: string;
  isActive: number;
  autoPushInventory: number;
  autoPushRates: number;
  autoPushRateRestrictions: number;
  autoPushInvRestrictions: number;
  lastSyncAt: string;
};

type RoomMapping = {
  id?: number;
  dormId: number;
  dormName: string;
  channelRoomCode: string;
  totalInventory: number;
  isActive: number;
};

type RatePlan = {
  id?: number;
  roomMappingId: number;
  ratePlanCode: string;
  ratePlanName: string;
  isActive: number;
};

type SyncLog = {
  id: number;
  direction: string;
  type: string;
  status: string;
  errorMessage: string;
  recordsAffected: number;
  createdAt: string;
};

const TABS = ["config", "rooms", "rates", "sales", "beds", "sync"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  config: "Configuration",
  rooms: "Room Mapping",
  rates: "Rate Plans",
  sales: "Sales Channels",
  beds: "Bed Config",
  sync: "Sync & Logs",
};

const DEFAULT_CONFIG: ChannelConfig = {
  provider: "aiosell",
  hotelCode: "SANDBOX-PMS",
  pmsId: "sample-pms",
  apiBaseUrl: "https://live.aiosell.com",
  apiUsername: "aiosell",
  apiPassword: "AIOsell@123",
  webhookSecret: "",
  bookingEngineUrl: "",
  isActive: 0,
  autoPushInventory: 1,
  autoPushRates: 0,
  autoPushRateRestrictions: 0,
  autoPushInvRestrictions: 0,
  lastSyncAt: "",
};

export function ChannelManager({ password, username, role, initialTab }: { password: string; username?: string; role: Role; initialTab?: "sync" }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "config");
  const [issue, setIssue] = useState<MappingIssue | undefined>();
  const { call } = useChannelApi(password, username);
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);

  return (
    <div className="space-y-4">
      <div className={managementSectionTabsClass}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              managementSectionTabClass,
              tab === t ? managementSectionTabActiveClass : managementSectionTabInactiveClass
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {issue && (tab === "rooms" || tab === "rates") && <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/20">
        Reviewing room <strong>{issue.roomCode}</strong>{issue.planCode ? ` / plan ${issue.planCode}` : ""}. Confirm the correct code in Aiosell before saving.
        <button type="button" className="ml-2 underline" onClick={() => setTab("sync")}>Return to Mapping health and verify</button>
      </div>}
      {tab === "config" && <ConfigTab password={password} username={username} />}
      {tab === "rooms" && <RoomMappingTab password={password} username={username} targetDormId={issue?.dormId} />}
      {tab === "rates" && <RatePlansTab password={password} username={username} targetIssue={issue} />}
      {tab === "sales" && <ManagementSalesChannels password={password} username={username} />}
      {tab === "beds" && <ManagementBedConfig password={password} username={username} />}
      {tab === "sync" && <><MappingHealthPanel call={call} onResolve={(next, selected) => { setIssue(selected); setTab(next); }} /><SyncTab password={password} username={username} /></>}
    </div>
  );
}

function ConfigTab({ password, username }: { password: string; username?: string }) {
  const { call: apiCall } = useChannelApi(password, username);
  const { showError, showSuccess } = useAdminToast();
  const [config, setConfig] = useState<ChannelConfig>(DEFAULT_CONFIG);
  const [bookingTaxRate, setBookingTaxRate] = useState(DEFAULT_BOOKING_TAX_PERCENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await apiCall("/api/admin/channel-manager", { action: "getConfig" });
      if (res.config) setConfig(res.config);
      if (res.bookingTaxRate != null) setBookingTaxRate(bookingTaxPercent(res.bookingTaxRate));
    } catch (e: any) { showError(e.message); }
    setLoading(false);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await apiCall("/api/admin/channel-manager", { action: "saveConfig", config, bookingTaxRate });
      showSuccess("Configuration saved");
    } catch (e: any) { showError(e.message); }
    setSaving(false);
  };

  if (loading) return <AdminLoading />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Aiosell Connection</h3>
        <div className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded-full", config.isActive ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400")}>
          {config.isActive ? <CheckCircleIcon className="h-3 w-3" /> : <XCircleIcon className="h-3 w-3" />}
          {config.isActive ? "Active" : "Inactive"}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Hotel Code</label>
          <Input value={config.hotelCode} onChange={(e) => setConfig({ ...config, hotelCode: e.target.value })} placeholder="SANDBOX-PMS" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">PMS Identifier (URL path)</label>
          <Input value={config.pmsId} onChange={(e) => setConfig({ ...config, pmsId: e.target.value })} placeholder="sample-pms" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">API Base URL</label>
          <Input value={config.apiBaseUrl} onChange={(e) => setConfig({ ...config, apiBaseUrl: e.target.value })} placeholder="https://live.aiosell.com" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">API Username</label>
          <Input value={config.apiUsername} onChange={(e) => setConfig({ ...config, apiUsername: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">API Password</label>
          <div className="relative">
            <Input type={showPassword ? "text" : "password"} value={config.apiPassword} onChange={(e) => setConfig({ ...config, apiPassword: e.target.value })} className="pr-9" />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Webhook Secret (required to enable)</label>
          <div className="relative">
            <Input type={showSecret ? "text" : "password"} value={config.webhookSecret} onChange={(e) => setConfig({ ...config, webhookSecret: e.target.value })} placeholder="Shared secret for inbound auth" className="pr-9" />
            <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showSecret ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground">Booking Engine URL (for direct guests)</label>
          <Input aria-label="Booking Engine URL for direct guests" value={config.bookingEngineUrl} onChange={(e) => setConfig({ ...config, bookingEngineUrl: e.target.value })} placeholder="/book or https://your-provider-guest-booking-link" />
          <BookingEngineLinkPreview value={config.bookingEngineUrl} apiBaseUrl={config.apiBaseUrl} />
          <details className="mt-2 rounded-lg border border-brand-mist p-3 text-xs text-muted-foreground" open>
            <summary className="cursor-pointer font-semibold text-foreground">Choose your booking link (Goko or another provider)</summary>
            <div className="mt-2 space-y-2">
              <p><strong>Goko booking:</strong> use <code>/book</code> or <code>{NATIVE_BOOKING_URL}</code>. When Booking Settings readiness passes, guests can reserve and pay in Razorpay test mode on that page.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfig({ ...config, bookingEngineUrl: "/book" })}>Use Goko booking</Button>
              <p><strong>Aiosell / StayFlexi / another engine:</strong> paste the complete HTTPS link guests use to select rooms and pay. Do not use the API Base URL or PMS integration address. Payment is handled by that provider.</p>
              <p><strong>Leave blank:</strong> Book Now opens Booking Enquiry, not an old provider. This setting is independent of Enable Channel Manager.</p>
              <p>Click Save Configuration to activate your chosen destination. Changes do not affect existing bookings or payments.</p>
              <div className="flex flex-wrap gap-4">
                <a className="underline" href="/admin?section=management&tab=bookingSettings">Open Booking Settings</a>
                <a className="underline" href="/book" target="_blank" rel="noopener noreferrer">Preview Goko page</a>
              </div>
            </div>
          </details>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Walk-in / offline GST (%)</label>
          <div className="relative max-w-[120px]">
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={bookingTaxRate}
              onChange={(e) => setBookingTaxRate(e.target.value === "" ? 0 : bookingTaxPercent(e.target.value))}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Applied to New Booking walk-in and Booking Engine totals. Default 5%.</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={config.isActive === 1}
            onChange={(e) => setConfig({ ...config, isActive: e.target.checked ? 1 : 0 })}
            className="rounded"
          />
          Enable Channel Manager
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={config.autoPushInventory === 1} onChange={(e) => setConfig({ ...config, autoPushInventory: e.target.checked ? 1 : 0 })} className="rounded" />
          Auto-push inventory
          <span className="text-[10px] text-muted-foreground">(on calendar occupancy, blocks, overrides — not Beds-tab assign)</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={config.autoPushRates === 1} onChange={(e) => setConfig({ ...config, autoPushRates: e.target.checked ? 1 : 0 })} className="rounded" />
          Auto-push rates
          <span className="text-[10px] text-muted-foreground">(on rate set, adjust, bulk update)</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={config.autoPushRateRestrictions === 1} onChange={(e) => setConfig({ ...config, autoPushRateRestrictions: e.target.checked ? 1 : 0 })} className="rounded" />
          Auto-push rate restrictions
          <span className="text-[10px] text-muted-foreground">(on stop-sell, min/max stay changes)</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={config.autoPushInvRestrictions === 1} onChange={(e) => setConfig({ ...config, autoPushInvRestrictions: e.target.checked ? 1 : 0 })} className="rounded" />
          Auto-push inventory restrictions
          <span className="text-[10px] text-muted-foreground">(saved; room-level push is the Inv Restrictions button — Bulk Update uses rate restrictions)</span>
        </label>
      </div>

      {config.lastSyncAt && (
        <p className="text-xs text-muted-foreground">Last sync: {new Date(config.lastSyncAt).toLocaleString()}</p>
      )}

      <Button onClick={saveConfig} disabled={saving} size="sm">
        {saving ? <Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1" /> : <SaveIcon className="h-3.5 w-3.5 mr-1" />}
        Save Configuration
      </Button>
    </div>
  );
}

function RoomMappingTab({ password, username, targetDormId }: { password: string; username?: string; targetDormId?: number }) {
  const { call: apiCall } = useChannelApi(password, username);
  const { showError } = useAdminToast();
  const [mappings, setMappings] = useState<RoomMapping[]>([]);
  const [dorms, setDorms] = useState<Array<{ id: number; name: string; bedCount: number }>>([]);
  const [remoteRooms, setRemoteRooms] = useState<Array<{ room_id: string; room_name?: string; active?: boolean; count?: number }>>([]);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingDormId, setSavingDormId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { code: string; beds: number }>>({});

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiCall("/api/admin/channel-manager", { action: "getRoomMappings" });
      setMappings(res.mappings || []);
      setDorms(res.dorms || []);
      setRemoteRooms(res.remoteRooms || []);
      setPropertyError(res.propertyError || null);
    } catch (e: any) { showError(e.message); }
    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const draftFor = (dormId: number, fallbackCode: string, fallbackBeds: number) =>
    drafts[dormId] ?? { code: fallbackCode, beds: fallbackBeds };

  const setDraft = (dormId: number, patch: Partial<{ code: string; beds: number }>, fallbackCode: string, fallbackBeds: number) => {
    setDrafts((prev) => {
      const cur = prev[dormId] ?? { code: fallbackCode, beds: fallbackBeds };
      return { ...prev, [dormId]: { ...cur, ...patch } };
    });
  };

  useEffect(() => {
    if (!loading && targetDormId) document.querySelector(`[data-mapping-dorm="${targetDormId}"]`)?.scrollIntoView({ block: "center" });
  }, [loading, targetDormId]);

  const saveDorm = async (dormId: number, mappingId: number | undefined, fallbackCode: string, fallbackBeds: number) => {
    const d = draftFor(dormId, fallbackCode, fallbackBeds);
    const code = d.code.trim();
    if (!code) { showError("Aiosell room code is required"); return; }
    setSavingDormId(dormId);
    try {
      await apiCall("/api/admin/channel-manager", {
        action: "saveRoomMapping",
        mapping: {
          id: mappingId,
          dormId,
          channelRoomCode: code,
          totalInventory: d.beds,
          isActive: 1,
        },
      });
      setEditingId(null);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[dormId];
        return next;
      });
      await load(true);
    } catch (e: any) { showError(e.message); }
    setSavingDormId(null);
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this room mapping and all associated rate plans?")) return;
    try {
      await apiCall("/api/admin/channel-manager", { action: "deleteRoomMapping", id });
      if (editingId === id) setEditingId(null);
      await load(true);
    } catch (e: any) { showError(e.message); }
  };

  if (loading) return <AdminLoading />;

  const mappedByDorm = new Map(mappings.map((m) => [m.dormId, m]));
  const knownDormIds = new Set(dorms.map((d) => d.id));
  const orphans = mappings.filter((m) => !knownDormIds.has(m.dormId));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Room mapping</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose an exact room code returned by Aiosell. Invalid or inactive mappings are blocked before a push.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => load(true)} title="Refresh dorms">
          <RefreshCwIcon className="h-3.5 w-3.5" />
        </Button>
      </div>

      <dl className="grid gap-2 rounded-lg border border-brand-mist bg-muted/30 p-3 text-[11px] text-muted-foreground sm:grid-cols-3">
        <div>
          <dt className="font-medium text-foreground">Dorm</dt>
          <dd>From Management → Dorms. New dorms appear here automatically; they are not pushed to Aiosell until you save a room code.</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Aiosell room code</dt>
          <dd>Exact code from Aiosell Property Details; local dorm names are never guessed.</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Sellable units</dt>
          <dd>Inventory sent for that room type. A double bed counts as one unit even though it has two internal guest slots.</dd>
        </div>
      </dl>
      {propertyError && <p className="text-xs text-red-600">Could not load Aiosell room codes: {propertyError}</p>}
      <datalist id="aiosell-room-codes">
        {remoteRooms.filter((r) => r.active !== false).map((r) => <option key={r.room_id} value={r.room_id}>{r.room_name || r.room_id}</option>)}
      </datalist>

      <div className="space-y-2">
        {dorms.length === 0 && (
          <p className="text-xs text-muted-foreground">No dorms yet. Add one under Management → Dorms.</p>
        )}
        {dorms.map((d) => {
          const mapping = mappedByDorm.get(d.id);
          const suggested = "";
          if (!mapping) {
            const draft = draftFor(d.id, suggested, d.bedCount);
            return (
              <div key={d.id} data-mapping-dorm={d.id} style={targetDormId === d.id ? { outline: "2px solid #d6b66a", outlineOffset: 2 } : undefined} className="flex flex-col gap-2 rounded-lg border border-dashed border-brand-mist p-2 sm:flex-row sm:items-center">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-[10px] text-amber-700 dark:text-amber-400">Not mapped — not sent to Aiosell yet</p>
                </div>
                <Input
                  className="sm:w-40"
                  list="aiosell-room-codes"
                  placeholder="Aiosell room code"
                  value={draft.code}
                  onChange={(e) => setDraft(d.id, { code: e.target.value }, suggested, d.bedCount)}
                />
                <Input
                  className="sm:w-20"
                  type="number"
                  min={0}
                  disabled
                  title="Derived from the dorm's sellable units"
                  value={draft.beds}
                  onChange={(e) => setDraft(d.id, { beds: parseInt(e.target.value) || 0 }, suggested, d.bedCount)}
                />
                <Button
                  size="sm"
                  disabled={savingDormId === d.id || !draft.code.trim()}
                  onClick={() => saveDorm(d.id, undefined, suggested, d.bedCount)}
                >
                  {savingDormId === d.id ? <Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1" /> : <PlusIcon className="h-3.5 w-3.5 mr-1" />}
                  Map
                </Button>
              </div>
            );
          }

          const editing = editingId === mapping.id;
          const draft = draftFor(d.id, mapping.channelRoomCode, mapping.totalInventory);
          return (
            <div key={d.id} data-mapping-dorm={d.id} style={targetDormId === d.id ? { outline: "2px solid #d6b66a", outlineOffset: 2 } : undefined} className="flex flex-col gap-2 rounded-lg bg-muted/50 p-2 sm:flex-row sm:items-center">
              <span className="flex-1 text-sm font-medium">{d.name}</span>
              {editing ? (
                <>
                  <Input
                    className="sm:w-40"
                    list="aiosell-room-codes"
                    value={draft.code}
                    onChange={(e) => setDraft(d.id, { code: e.target.value }, mapping.channelRoomCode, mapping.totalInventory)}
                  />
                  <Input
                    className="sm:w-20"
                    type="number"
                    min={0}
                    disabled
                    title="Derived from the dorm's sellable units"
                    value={draft.beds}
                    onChange={(e) => setDraft(d.id, { beds: parseInt(e.target.value) || 0 }, mapping.channelRoomCode, mapping.totalInventory)}
                  />
                  <Button size="sm" disabled={savingDormId === d.id} onClick={() => saveDorm(d.id, mapping.id, mapping.channelRoomCode, mapping.totalInventory)}>
                    {savingDormId === d.id ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <SaveIcon className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setDrafts((p) => { const n = { ...p }; delete n[d.id]; return n; }); }}>Cancel</Button>
                </>
              ) : (
                <>
                  <code className="text-xs bg-background px-2 py-0.5 rounded">{mapping.channelRoomCode}</code>
                  {!remoteRooms.some((r) => r.room_id === mapping.channelRoomCode && r.active !== false) && <span className="text-[10px] text-red-600">Invalid / inactive</span>}
                  <span className="text-xs text-muted-foreground">{mapping.totalInventory} units</span>
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(mapping.id!)} className="h-7 w-7 p-0" title="Edit">
                    <PencilIcon className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={async () => {
                    try { await apiCall("/api/admin/channel-manager", { action: "saveRoomMapping", mapping: { ...mapping, isActive: mapping.isActive ? 0 : 1 } }); await load(); }
                    catch (e: any) { showError(e.message); }
                  }}>{mapping.isActive ? "Disable" : "Enable"}</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(mapping.id!)} className="h-7 w-7 p-0 text-red-500" title="Delete">
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          );
        })}
        {orphans.map((m) => (
          <div key={`orphan-${m.id}`} className="flex items-center gap-2 rounded-lg border border-red-200 p-2 text-sm">
            <span className="flex-1 font-medium">{m.dormName}</span>
            <span className="text-[10px] text-red-600">Dorm deleted</span>
            <code className="text-xs bg-background px-2 py-0.5 rounded">{m.channelRoomCode}</code>
            <Button variant="ghost" size="sm" onClick={() => remove(m.id!)} className="h-7 w-7 p-0 text-red-500" title="Delete">
              <Trash2Icon className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RatePlansTab({ password, username, targetIssue }: { password: string; username?: string; targetIssue?: MappingIssue }) {
  const { call: apiCall } = useChannelApi(password, username);
  const { showError } = useAdminToast();
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [mappings, setMappings] = useState<RoomMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPlan, setNewPlan] = useState<Partial<RatePlan>>({ roomMappingId: 0, ratePlanCode: "", ratePlanName: "", isActive: 1 });

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [plansRes, mappingsRes] = await Promise.all([
        apiCall("/api/admin/channel-manager", { action: "getRatePlans" }),
        apiCall("/api/admin/channel-manager", { action: "getRoomMappings" }),
      ]);
      setPlans(plansRes.plans || []);
      setMappings(mappingsRes.mappings || []);
    } catch (e: any) { showError(e.message); }
    setLoading(false);
  };

  useEffect(() => {
    if (loading || !targetIssue) return;
    if (targetIssue.planId) document.querySelector(`[data-mapping-plan="${targetIssue.planId}"]`)?.scrollIntoView({ block: "center" });
    else if (targetIssue.roomMappingId) setNewPlan((prev) => ({ ...prev, roomMappingId: targetIssue.roomMappingId }));
  }, [loading, targetIssue]);

  const save = async (plan: Partial<RatePlan>) => {
    try {
      await apiCall("/api/admin/channel-manager", { action: "saveRatePlan", plan });
      setNewPlan({ roomMappingId: 0, ratePlanCode: "", ratePlanName: "", isActive: 1 });
      await load();
    } catch (e: any) { showError(e.message); }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this rate plan and all associated daily rates?")) return;
    try {
      await apiCall("/api/admin/channel-manager", { action: "deleteRatePlan", id });
      await load();
    } catch (e: any) { showError(e.message); }
  };

  if (loading) return <AdminLoading />;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Rate Plans</h3>
      <p className="text-xs text-muted-foreground">After correcting a mapping, open Sync & Logs and click Check again to verify.</p>
      <p className="text-xs text-muted-foreground">Each mapped room type can have multiple rate plans (e.g., EP = room only, CP = with breakfast).</p>
      {mappings.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Map a dorm under Room Mapping first — unmapped dorms cannot have rate plans.</p>
      )}

      {plans.length > 0 && (
        <div className="space-y-2">
          {plans.map((p) => {
            const room = mappings.find((m) => m.id === p.roomMappingId);
            return (
              <div key={p.id} data-mapping-plan={p.id} style={targetIssue?.planId === p.id ? { outline: "2px solid #d6b66a" } : undefined} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-muted/50 text-sm">
                <span className="text-xs text-muted-foreground">{room?.dormName || "?"}</span>
                <span className="font-medium flex-1">{p.ratePlanName}</span>
                <code className="text-xs bg-background px-2 py-0.5 rounded">{p.ratePlanCode}</code>
                <Button variant="ghost" size="sm" onClick={() => setNewPlan({ ...p })}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => save({ ...p, isActive: p.isActive ? 0 : 1 })}>{p.isActive ? "Disable" : "Enable"}</Button>
                <Button variant="ghost" size="sm" onClick={() => remove(p.id!)} className="h-7 w-7 p-0 text-red-500">
                  <Trash2Icon className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="border rounded-lg p-3 space-y-2">
        <p className="text-xs font-medium">{newPlan.id ? "Edit Rate Plan" : "Add Rate Plan"}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select
            className="rounded-md border px-3 py-2 text-sm bg-background"
            value={newPlan.roomMappingId || 0}
            onChange={(e) => setNewPlan({ ...newPlan, roomMappingId: parseInt(e.target.value) || 0 })}
          >
            <option value={0}>Select Room...</option>
            {mappings.map((m) => <option key={m.id} value={m.id}>{m.dormName} ({m.channelRoomCode})</option>)}
          </select>
          <Input placeholder="Rate Plan Code" value={newPlan.ratePlanCode || ""} onChange={(e) => setNewPlan({ ...newPlan, ratePlanCode: e.target.value })} />
          <Input placeholder="Rate Plan Name" value={newPlan.ratePlanName || ""} onChange={(e) => setNewPlan({ ...newPlan, ratePlanName: e.target.value })} />
        </div>
        <Button size="sm" onClick={() => save(newPlan)} disabled={!newPlan.roomMappingId || !newPlan.ratePlanCode || !newPlan.ratePlanName}>
          <PlusIcon className="h-3.5 w-3.5 mr-1" /> {newPlan.id ? "Save changes" : "Add"}
        </Button>
        {newPlan.id && <Button variant="ghost" size="sm" onClick={() => setNewPlan({ roomMappingId: 0, ratePlanCode: "", ratePlanName: "", isActive: 1 })}>Cancel edit</Button>}
      </div>
    </div>
  );
}

function SyncTab({ password, username }: { password: string; username?: string }) {
  const { call: apiCall } = useChannelApi(password, username);
  const { showError, showSuccess } = useAdminToast();
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState<string | null>(null);
  const [pushStartDate, setPushStartDate] = useState("");
  const [pushEndDate, setPushEndDate] = useState("");
  const [fetchType, setFetchType] = useState<"inventory" | "rates" | "reservation">("inventory");
  const [fetchStart, setFetchStart] = useState("");
  const [fetchEnd, setFetchEnd] = useState("");
  const [fetchResult, setFetchResult] = useState<any>(null);
  const today = todayIST();
  const [fetching, setFetching] = useState(false);

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - 15 * 86400000).toISOString();
      const res = await apiCall("/api/admin/channel-manager", { action: "getSyncLogs", limit: 50, since });
      setLogs(res.logs || []);
    } catch (e: any) { showError(e.message); }
    setLoading(false);
  };

  const [pushResult, setPushResult] = useState<{ type: string; warnings?: string[] } | null>(null);

  const pushAction = async (type: string, url: string, extra?: Record<string, unknown>) => {
    setPushing(type);
    setPushResult(null);
    try {
      const res = await apiCall(url, extra || {});
      if (res.success || res.pushed) {
        const detail = res.mode === "incremental" ? ` (${res.inventoryPushed || 0} changed)` : res.inventoryPushed ? ` (${res.inventoryPushed} records)` : "";
        showSuccess(`${type} push completed${detail}`);
        if (res.warnings?.length) setPushResult({ type, warnings: res.warnings });
      } else {
        showError(res.error || res.message || "Push failed");
      }
      await loadLogs();
    } catch (e: any) { showError(e.message); }
    setPushing(null);
  };

  const handleFetch = async () => {
    if (!fetchStart || !fetchEnd) return;
    setFetching(true);
    setFetchResult(null);
    try {
      const res = await apiCall("/api/aiosell/fetch", { type: fetchType, startDate: fetchStart, endDate: fetchEnd });
      setFetchResult(res);
      const ingested = res?.ingested;
      if (ingested && (ingested.imported > 0 || ingested.skipped > 0)) {
        showSuccess(`Fetch ok — imported ${ingested.imported}, already in Goko ${ingested.skipped}`);
      }
    } catch (e: any) { showError(e.message); }
    setFetching(false);
  };

  if (loading) return <AdminLoading />;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Push to Aiosell</h3>

      <DateRangePicker
        variant="compact"
        applyMode="manual"
        minDate={today}
        minNights={0}
        labels={{ start: "Start Date", end: "End Date" }}
        startDate={pushStartDate}
        endDate={pushEndDate}
        onChange={({ startDate, endDate }) => {
          setPushStartDate(startDate);
          setPushEndDate(endDate);
        }}
        className="max-w-md"
      />
      <p className="text-[10px] text-muted-foreground">Leave empty for defaults (today + 30 days)</p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => pushAction("Inventory", "/api/aiosell/push-inventory", { startDate: pushStartDate || undefined, endDate: pushEndDate || undefined })} disabled={!!pushing}>
          {pushing === "Inventory" ? <Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1" /> : <SendIcon className="h-3.5 w-3.5 mr-1" />}
          Push Inventory
        </Button>
        <Button size="sm" variant="outline" onClick={() => pushAction("Full Sync", "/api/aiosell/push-inventory", { fullSync: true })} disabled={!!pushing}>
          {pushing === "Full Sync" ? <Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1" /> : <SendIcon className="h-3.5 w-3.5 mr-1" />}
          Full Sync
        </Button>
        <Button size="sm" onClick={() => pushAction("Rates", "/api/aiosell/push-rates", { startDate: pushStartDate || undefined, endDate: pushEndDate || undefined })} disabled={!!pushing}>
          {pushing === "Rates" ? <Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1" /> : <SendIcon className="h-3.5 w-3.5 mr-1" />}
          Push Rates
        </Button>
        <Button size="sm" variant="outline" onClick={() => pushAction("Rate Restrictions", "/api/aiosell/push-rates", { includeRestrictions: true, startDate: pushStartDate || undefined, endDate: pushEndDate || undefined })} disabled={!!pushing}>
          {pushing === "Rate Restrictions" ? <Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1" /> : <SendIcon className="h-3.5 w-3.5 mr-1" />}
          Push Rate Restrictions
        </Button>
        <Button size="sm" variant="outline" onClick={() => pushAction("Inv Restrictions", "/api/aiosell/push-inventory-restrictions", { startDate: pushStartDate || undefined, endDate: pushEndDate || undefined })} disabled={!!pushing}>
          {pushing === "Inv Restrictions" ? <Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1" /> : <SendIcon className="h-3.5 w-3.5 mr-1" />}
          Push Inv Restrictions
        </Button>
      </div>

      {pushResult?.warnings && pushResult.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-2">
          <p className="text-[10px] font-medium text-amber-800 dark:text-amber-300 mb-1">{pushResult.type} — {pushResult.warnings.length} warning(s):</p>
          <div className="max-h-24 overflow-y-auto text-[10px] text-amber-700 dark:text-amber-400 space-y-0.5">
            {[...new Set(pushResult.warnings)].map((w, i) => <div key={i}>{w}</div>)}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <h3 className="text-sm font-semibold">Sync Log</h3>
        <Button variant="ghost" size="sm" onClick={loadLogs}>
          <RefreshCwIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Full request/response JSON: Management → Logs → PMS</p>

      {logs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sync activity yet.</p>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {logs.map((log) => (
            <div key={log.id} className="flex items-center gap-2 text-xs p-2 rounded bg-muted/50">
              <span className={cn("w-2 h-2 rounded-full", log.status === "success" ? "bg-green-500" : "bg-red-500")} />
              <span className="font-mono text-muted-foreground w-14">{log.direction}</span>
              <span className="font-medium w-20">{log.type}</span>
              <span className="flex-1 text-muted-foreground truncate">{log.errorMessage || `${log.recordsAffected} records`}</span>
              <span className="text-muted-foreground">{new Date(log.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          ))}
        </div>
      )}

      <div className="pt-4 border-t border-border">
        <h3 className="text-sm font-semibold mb-2">Fetch from Aiosell</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select className="rounded-md border border-input bg-background px-2 py-1 text-xs" value={fetchType} onChange={(e) => setFetchType(e.target.value as any)}>
            <option value="inventory">Inventory</option>
            <option value="rates">Rates</option>
            <option value="reservation">Reservations</option>
          </select>
          <DateRangePicker
            variant="compact"
            applyMode="manual"
            minNights={0}
            startDate={fetchStart}
            endDate={fetchEnd}
            onChange={({ startDate, endDate }) => {
              setFetchStart(startDate);
              setFetchEnd(endDate);
            }}
          />
        </div>
        <Button size="sm" className="mt-2" onClick={handleFetch} disabled={fetching || !fetchStart || !fetchEnd}>
          {fetching ? <Loader2Icon className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCwIcon className="h-3.5 w-3.5 mr-1" />}
          Fetch
        </Button>
        {fetchResult && (
          <div className="mt-2 max-h-60 overflow-auto rounded bg-muted/50 p-2">
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">{JSON.stringify(fetchResult, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
