"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Trash2Icon, Loader2Icon } from "lucide-react";

type Channel = { id: number; name: string; code: string; isActive: number; createdAt: string };

export function ManagementSalesChannels({ password, username }: { password: string; username?: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchChannels = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, action: "getChannels" }),
      });
      const data = await res.json();
      setChannels(data.channels || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchChannels(); }, []);

  const handleAdd = async () => {
    if (!newName || !newCode) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, action: "upsertChannel", name: newName, code: newCode }),
      });
      const data = await res.json();
      if (data.channels) setChannels(data.channels);
      setNewName("");
      setNewCode("");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this channel?")) return;
    await fetch("/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, username, action: "deleteChannel", id }),
    });
    setChannels(channels.filter((c) => c.id !== id));
  };

  const handleToggle = async (ch: Channel) => {
    const res = await fetch("/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, username, action: "upsertChannel", id: ch.id, name: ch.name, code: ch.code, isActive: ch.isActive ? 0 : 1 }),
    });
    const data = await res.json();
    if (data.channels) setChannels(data.channels);
  };

  if (loading) return <div className="flex justify-center py-10" role="status" aria-live="polite" aria-label="Loading sales channels"><Loader2Icon className="h-5 w-5 animate-spin text-brand-green" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-green-dark/60 dark:text-zinc-400">
        Sales channels represent the sources through which bookings arrive. They are used for channel-level pricing and inventory distribution.
      </p>

      <div className="rounded-xl border border-brand-mist bg-white dark:bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-mist bg-brand-sand/30 dark:bg-zinc-800/30">
              <th className="px-4 py-2 text-left font-medium text-brand-green-dark/60">Name</th>
              <th className="px-4 py-2 text-left font-medium text-brand-green-dark/60">Code</th>
              <th className="px-4 py-2 text-center font-medium text-brand-green-dark/60">Active</th>
              <th className="px-4 py-2 text-right font-medium text-brand-green-dark/60">Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.id} className="border-b border-brand-mist/50 last:border-0">
                <td className="px-4 py-2.5 font-medium text-brand-green-dark dark:text-zinc-200">{ch.name}</td>
                <td className="px-4 py-2.5 text-brand-green-dark/60 dark:text-zinc-400 font-mono text-xs">{ch.code}</td>
                <td className="px-4 py-2.5 text-center">
                  <button type="button" onClick={() => handleToggle(ch)} className={`px-2 py-0.5 rounded text-[10px] font-medium ${ch.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {ch.isActive ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(ch.id)}>
                    <Trash2Icon className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-xs font-medium text-brand-green-dark/60">Channel Name</label>
          <Input className="mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Agoda" />
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-brand-green-dark/60">Code</label>
          <Input className="mt-1" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. agoda" />
        </div>
        <Button variant="cta" size="sm" onClick={handleAdd} disabled={saving || !newName || !newCode} className="gap-1">
          <PlusIcon className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}
