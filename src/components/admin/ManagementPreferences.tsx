"use client";

import { useEffect, useState } from "react";
import { readStaffWhatsAppPreference, writeStaffWhatsAppPreference, type StaffWhatsAppPreference } from "@/lib/staffWhatsApp";
import { NotificationPreferences } from "./NotificationPreferences";

export function ManagementPreferences({ password, username }: { password: string; username: string }) {
  const [android, setAndroid] = useState(false);
  const [preference, setPreference] = useState<StaffWhatsAppPreference>("ask");
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setAndroid(/Android/i.test(navigator.userAgent));
    setPreference(readStaffWhatsAppPreference(username));
  }, [username]);

  const choose = (value: StaffWhatsAppPreference) => {
    const saved = writeStaffWhatsAppPreference(username, value);
    setSaveError(!saved);
    if (saved) setPreference(value);
  };

  const choices: { value: StaffWhatsAppPreference; label: string; description: string }[] = [
    { value: "ask", label: "Ask every time", description: "Show the prepared message and let me choose an app." },
    ...(android ? [{ value: "business" as const, label: "WhatsApp Business", description: "Try Business automatically and keep both choices available." }] : []),
    { value: "regular", label: android ? "Regular WhatsApp" : "Default WhatsApp", description: "Try regular/default WhatsApp automatically and keep recovery options available." },
  ];

  return <div className="max-w-2xl space-y-5"><div className="rounded-2xl border border-brand-mist bg-white p-5 shadow-sm dark:bg-card dark:shadow-none">
    <h3 className="font-display text-lg font-bold text-brand-green-dark">My WhatsApp preference</h3>
    <p className="mt-1 text-sm text-muted-foreground">Saved only on this device for @{username}. You can still choose another app from every prepared message.</p>
    <div className="mt-4 grid gap-2">
      {choices.map((choice) => <label key={choice.value} className="flex cursor-pointer gap-3 rounded-xl border border-brand-mist p-3">
        <input type="radio" name="whatsapp-preference" value={choice.value} checked={preference === choice.value} onChange={() => choose(choice.value)} className="mt-1" />
        <span><span className="block text-sm font-medium text-brand-green-dark">{choice.label}</span><span className="block text-xs text-muted-foreground">{choice.description}</span></span>
      </label>)}
    </div>
    {saveError && <p role="alert" className="mt-3 text-sm text-red-700">Could not save this preference on your device. Check that browser storage is enabled.</p>}
  </div><NotificationPreferences password={password} username={username} /></div>;
}
