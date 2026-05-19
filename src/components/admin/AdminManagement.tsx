"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { BedDoubleIcon, UsersIcon, DatabaseIcon, ShieldCheckIcon, FileTextIcon } from "lucide-react";
import { AdminSetup } from "./AdminSetup";
import { ManagementUsers } from "./ManagementUsers";
import { ManagementBackup } from "./ManagementBackup";
import { ManagementAudit } from "./ManagementAudit";
import { ManagementLogs } from "./ManagementLogs";
import type { Role, ManagementTab } from "./types";

const TABS: { id: ManagementTab; label: string; icon: React.ReactNode }[] = [
  { id: "dorms", label: "Dorms", icon: <BedDoubleIcon className="h-3.5 w-3.5" /> },
  { id: "users", label: "Users", icon: <UsersIcon className="h-3.5 w-3.5" /> },
  { id: "backup", label: "Backup", icon: <DatabaseIcon className="h-3.5 w-3.5" /> },
  { id: "audit", label: "Audit", icon: <ShieldCheckIcon className="h-3.5 w-3.5" /> },
  { id: "logs", label: "Logs", icon: <FileTextIcon className="h-3.5 w-3.5" /> },
];

export function AdminManagement({ password, username, role }: { password: string; username?: string; role: Role }) {
  const [tab, setTab] = useState<ManagementTab>("dorms");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Management</h2>
      </div>

      {/* Sub-tab navigation */}
      <div className="mt-4 flex flex-wrap gap-1.5 rounded-xl border border-brand-mist bg-white p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
              tab === t.id
                ? "bg-brand-green/10 text-brand-green"
                : "text-brand-green-dark/60 hover:bg-brand-sand/50"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {tab === "dorms" && <AdminSetup password={password} />}
        {tab === "users" && <ManagementUsers password={password} role={role} />}
        {tab === "backup" && <ManagementBackup password={password} role={role} />}
        {tab === "audit" && <ManagementAudit password={password} role={role} />}
        {tab === "logs" && <ManagementLogs password={password} role={role} />}
      </div>
    </div>
  );
}
