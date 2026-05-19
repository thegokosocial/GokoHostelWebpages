"use client";

import { useState, useEffect } from "react";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { DatabaseIcon, CheckCircleIcon, Loader2Icon } from "lucide-react";
import type { Role } from "./types";

export function ManagementBackup({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { apiCall } = useAdminApi(password, username);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => { loadStatus(); }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getSetting", key: "last_backup" });
      if (res.ok) {
        const data = await res.json();
        setLastBackup(data.value || null);
      }
    } finally { setLoading(false); }
  };

  const runBackup = async () => {
    if (!confirm("Run backup now? This will copy new data to Google Sheets.")) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await apiCall({ action: "runBackup" });
      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: data.message || "Backup completed successfully" });
        setLastBackup(new Date().toISOString());
      } else {
        setResult({ success: false, message: data.error || "Backup failed" });
      }
    } catch {
      setResult({ success: false, message: "Network error during backup" });
    } finally { setRunning(false); }
  };

  if (role !== "admin") {
    return <p className="py-10 text-center text-brand-green-dark/50">Only admins can manage backups.</p>;
  }

  if (loading) return <AdminLoading message="Loading backup status..." />;

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-brand-green-dark">Backup to Google Sheets</h3>

      <div className="rounded-2xl border border-brand-mist bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green/10">
            <DatabaseIcon className="h-6 w-6 text-brand-green" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-brand-green-dark">Incremental Backup</h4>
            <p className="mt-1 text-sm text-brand-green-dark/60">
              Copies new check-in records and bed history from D1 database to your Google Sheet as a backup.
              Only new data (since last backup) is copied — nothing is duplicated.
            </p>
            <div className="mt-3 flex items-center gap-4">
              <div className="text-xs text-brand-green-dark/50">
                Last backup: {lastBackup ? new Date(lastBackup).toLocaleString() : <span className="italic">Never</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <Button type="button" variant="cta" onClick={runBackup} disabled={running}>
            {running ? <><Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> Running backup...</> : "Run Backup Now"}
          </Button>
        </div>

        {result && (
          <div className={`mt-4 rounded-xl p-3 text-sm ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {result.success && <CheckCircleIcon className="mr-1 inline h-4 w-4" />}
            {result.message}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-brand-sand/50 p-4 text-xs text-brand-green-dark/60">
        <p className="font-medium">How backup works:</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>Reads all check-in records created after the last backup timestamp</li>
          <li>Appends them to the existing Google Sheet (monthly tabs)</li>
          <li>Also copies new bed history entries</li>
          <li>Updates the &quot;last backup&quot; timestamp when done</li>
          <li>Google Sheet is never modified or deleted — only appended to</li>
        </ul>
      </div>
    </div>
  );
}
