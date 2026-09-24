"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { bookingWhatsAppNumber } from "@/lib/bookingWhatsApp";
import { clearStaffWhatsAppDraft, parseStaffWhatsAppDraft, staffWhatsAppFallback, staffWhatsAppLinks, STAFF_WHATSAPP_KEY, STAFF_WHATSAPP_TTL, type StaffWhatsAppDraft } from "@/lib/staffWhatsApp";

type PrepareMessage = (phone: string, message: string, section: StaffWhatsAppDraft["section"], launch?: boolean) => void;
const StaffWhatsAppContext = createContext<PrepareMessage | null>(null);
export function useStaffWhatsApp() {
  const prepare = useContext(StaffWhatsAppContext);
  if (!prepare) throw new Error("StaffWhatsAppProvider is required");
  return prepare;
}

export function StaffWhatsAppProvider({ username, children }: { username: string; children: ReactNode }) {
  const [draft, setDraft] = useState<StaffWhatsAppDraft | null>(null);
  const [android, setAndroid] = useState(false);
  const [notice, setNotice] = useState("");
  const [businessUnavailable, setBusinessUnavailable] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  useEffect(() => {
    setAndroid(/Android/i.test(navigator.userAgent));
    try {
      const saved = parseStaffWhatsAppDraft(sessionStorage.getItem(STAFF_WHATSAPP_KEY), username);
      const fallback = staffWhatsAppFallback(window.location.href);
      setDraft(saved);
      if (!saved) clearStaffWhatsAppDraft();
      if (fallback.unavailable && saved) {
        setAttempted(true);
        setBusinessUnavailable(true);
      }
      if (fallback.hadMarker) window.history.replaceState(window.history.state, "", fallback.cleanUrl);
    } catch { /* The message can still be kept in memory. */ }
  }, [username]);

  const dismiss = () => { setDraft(null); clearStaffWhatsAppDraft(); setNotice(""); setBusinessUnavailable(false); setAttempted(false); };
  useEffect(() => {
    if (!draft) return;
    const expire = () => {
      if (Date.now() - draft.createdAt >= STAFF_WHATSAPP_TTL) {
        setDraft(null);
        clearStaffWhatsAppDraft();
      }
    };
    const timer = setTimeout(expire, Math.max(0, STAFF_WHATSAPP_TTL - (Date.now() - draft.createdAt)));
    document.addEventListener("visibilitychange", expire);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", expire); };
  }, [draft]);

  const launchBusiness = (value: StaffWhatsAppDraft) => {
    if (Date.now() - value.createdAt >= STAFF_WHATSAPP_TTL) { dismiss(); return; }
    const links = staffWhatsAppLinks(value, window.location.origin);
    setAttempted(true);
    try {
      sessionStorage.setItem(STAFF_WHATSAPP_KEY, JSON.stringify(value));
    } catch {
      // A new tab preserves this in-memory draft when storage is unavailable.
      try { window.open(links.business, "_blank", "noopener,noreferrer"); } catch { /* Recovery controls stay available. */ }
      setNotice("If Business did not open, retry or copy the message below.");
      return;
    }
    try { window.location.assign(links.business); }
    catch { setNotice("Business could not open. Retry or copy the message below."); }
  };

  const prepare: PrepareMessage = (phone, message, section, launch = false) => {
    if (!active.current) return;
    const normalized = bookingWhatsAppNumber(phone);
    if (!normalized) throw new Error("A valid phone number is required.");
    const value = { phone: normalized, message, section, owner: username, createdAt: Date.now() };
    setDraft(value);
    setNotice("");
    setBusinessUnavailable(false);
    setAttempted(false);
    try { sessionStorage.setItem(STAFF_WHATSAPP_KEY, JSON.stringify(value)); } catch { /* Keep the open panel. */ }
    if (launch && /Android/i.test(navigator.userAgent)) launchBusiness(value);
  };

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice("Copied."); }
    catch { setNotice("Copy unavailable. Select and copy the text below."); }
  };

  return <StaffWhatsAppContext.Provider value={prepare}>
    {children}
    <Dialog open={!!draft} onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent className="z-[100] max-h-[90dvh] overflow-y-auto sm:max-w-lg" overlayClassName="z-[99]">
        <DialogHeader>
          <DialogTitle>Message guest</DialogTitle>
          <DialogDescription>{android
            ? "Open WhatsApp Business, review the message and tap Send. If it does not open, use the options below."
            : "This device chooses which WhatsApp app or account opens. To use Business specifically, copy the message and number into WhatsApp Business."}</DialogDescription>
        </DialogHeader>
        {draft && <>
          {businessUnavailable && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">WhatsApp Business isn&apos;t installed or available. Retry, copy the message, or open regular/default WhatsApp.</p>}
          <label className="grid gap-1">Phone number<input readOnly value={`+${draft.phone}`} className="rounded border p-2" /></label>
          <label className="grid gap-1">Prepared message<textarea readOnly value={draft.message} rows={7} className="w-full rounded border p-2" /></label>
          <div className="flex flex-wrap gap-2">
            {android && <Button onClick={() => launchBusiness(draft)}>{attempted ? "Retry WhatsApp Business" : "Open WhatsApp Business"}</Button>}
            <Button variant="outline" onClick={() => void copy(draft.message)}>Copy message</Button>
            <Button variant="outline" onClick={() => void copy(`+${draft.phone}`)}>Copy number</Button>
          </div>
          <a className="underline" href={staffWhatsAppLinks(draft, window.location.origin).defaultApp} target="_blank" rel="noopener noreferrer">Open regular/default WhatsApp</a>
          <p className="text-xs text-muted-foreground">Opening a draft does not confirm that a message was sent. Close this panel to discard the draft.</p>
          {notice && <p role="status">{notice}</p>}
        </>}
      </DialogContent>
    </Dialog>
  </StaffWhatsAppContext.Provider>;
}
