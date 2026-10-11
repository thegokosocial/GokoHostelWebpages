"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2Icon, MessageSquareTextIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  BOOKING_WHATSAPP_PLACEHOLDERS,
  MAX_BOOKING_WHATSAPP_TEMPLATES,
  fillBookingWhatsAppTemplate,
  type BookingWhatsAppTemplate,
} from "@/lib/bookingWhatsApp";

type Template = BookingWhatsAppTemplate;
type TemplatePlaceholder = { token: string; label: string };

const SAMPLE_VALUES = {
  "{GUEST_NAME}": "Alex",
  "{CHECK_IN}": "2026-09-06",
  "{CHECK_OUT}": "2026-09-09",
  "{BOOKING_ID}": "Booking.com: 1234567890",
  "{BALANCE}": "₹1,500",
  "{PROPERTY_NAME}": "Goko Hostel",
};

export function WhatsAppTemplateManager({
  apiCall,
  onClose,
  onSaved,
  getAction = "getWhatsAppTemplates",
  saveAction = "saveWhatsAppTemplates",
  title = "WhatsApp Message Templates",
  templateLabel = "Shared templates",
  placeholders = BOOKING_WHATSAPP_PLACEHOLDERS,
  preview = (message) => fillBookingWhatsAppTemplate(message, SAMPLE_VALUES),
  helperText = "Guest name, dates, guest-facing platform/reference, balance, and property name are replaced with the selected booking’s actual details when sending. Internal Goko database IDs are never included.",
}: {
  apiCall: (body: Record<string, unknown>) => Promise<Response>;
  onClose: () => void;
  onSaved: (templates: Template[]) => void;
  getAction?: string;
  saveAction?: string;
  title?: string;
  templateLabel?: string;
  placeholders?: readonly TemplatePlaceholder[];
  preview?: (message: string) => string;
  helperText?: string;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiCall({ action: getAction })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load templates");
        setTemplates(data.templates || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiCall, getAction]);

  const resetForm = () => { setEditingId(null); setName(""); setMessage(""); setError(""); };

  const persist = async (next: Template[]) => {
    setSaving(true);
    setError("");
    try {
      const res = await apiCall({ action: saveAction, templates: next });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save templates");
      setTemplates(data.templates || next);
      onSaved(data.templates || next);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save templates");
    } finally {
      setSaving(false);
    }
  };

  const saveCurrent = () => {
    const cleanName = name.trim();
    const cleanMessage = message.trim();
    if (!cleanName || !cleanMessage) { setError("Template name and message are required."); return; }
    const item = { id: editingId || crypto.randomUUID(), name: cleanName, message: cleanMessage };
    const next = editingId ? templates.map((template) => template.id === editingId ? item : template) : [...templates, item];
    void persist(next);
  };

  const editing = editingId !== null || name !== "" || message !== "";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-popover p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{templateLabel} · {templates.length}/{MAX_BOOKING_WHATSAPP_TEMPLATES}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}><XIcon className="size-4" /><span className="sr-only">Close</span></Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2Icon className="size-5 animate-spin" /></div>
        ) : (
          <div className="mt-5 grid gap-5 md:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-2">
              {templates.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No templates saved yet.</p>}
              {templates.map((template) => (
                <div key={template.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-medium text-foreground">{template.name}</p><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">{template.message}</p></div>
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon-sm" onClick={() => { setEditingId(template.id); setName(template.name); setMessage(template.message); setError(""); }}><PencilIcon className="size-3.5" /><span className="sr-only">Edit {template.name}</span></Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => { if (confirm(`Delete “${template.name}”?`)) void persist(templates.filter((item) => item.id !== template.id)); }}><Trash2Icon className="size-3.5 text-red-600" /><span className="sr-only">Delete {template.name}</span></Button>
                    </div>
                  </div>
                </div>
              ))}
              {!editing && templates.length < MAX_BOOKING_WHATSAPP_TEMPLATES && <Button variant="outline" className="w-full" onClick={() => setName("New template")}><PlusIcon className="size-4" /> Add template</Button>}
            </div>

            <div className="space-y-3">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Template name, e.g. Check-in reminder" maxLength={80} />
              <Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Hi {GUEST_NAME}, your check-in is on {CHECK_IN}..." rows={7} maxLength={2000} />
              <div>
                <p className="mb-1.5 text-xs font-medium text-foreground">Supported placeholders — click to insert</p>
                <div className="flex flex-wrap gap-1.5">
                  {placeholders.map(({ token, label }) => (
                    <button key={token} type="button" title={label} onClick={() => setMessage((current) => current + token)} className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-foreground hover:bg-muted">{token}</button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{helperText}</p>
              </div>
              {message && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Example preview</p>
                  <p className="whitespace-pre-wrap text-xs text-foreground">{preview(message)}</p>
                </div>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                {editing && <Button variant="outline" onClick={resetForm} disabled={saving}>Cancel</Button>}
                <Button onClick={saveCurrent} disabled={saving || !editing || (!editingId && templates.length >= MAX_BOOKING_WHATSAPP_TEMPLATES)}>{saving && <Loader2Icon className="size-4 animate-spin" />} Save template</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageTemplatesIcon() {
  return <MessageSquareTextIcon className="size-3.5" />;
}
