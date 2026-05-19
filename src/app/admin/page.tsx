"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockIcon, LogOutIcon, LayoutDashboardIcon, BedDoubleIcon, TableIcon, SettingsIcon, HistoryIcon, CalendarDaysIcon, BarChart3Icon, WrenchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminRecords } from "@/components/admin/AdminRecords";
import { AdminBeds } from "@/components/admin/AdminBeds";
import { AdminManagement } from "@/components/admin/AdminManagement";
import { AdminBedHistory } from "@/components/admin/AdminBedHistory";
import { AdminTimeline } from "@/components/admin/AdminTimeline";
import { AdminStats } from "@/components/admin/AdminStats";
import type { Role, AdminSection } from "@/components/admin/types";

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [selectedRole, setSelectedRole] = useState<"admin" | "manager" | null>(null);

  const login = async () => {
    setLoading(true);
    setError("");
    try {
      const body: any = { password, action: "list" };
      if (selectedRole === "manager" && username) body.username = username;

      const res = await fetch("/api/admin/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) { setError("Incorrect credentials"); return; }
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setRole(data.role);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!role) {
    return (
      <section className="flex min-h-screen items-center justify-center bg-brand-sand">
        <div className="w-full max-w-sm rounded-3xl border border-brand-mist bg-white p-8 shadow-card">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green/[0.07]">
            <LockIcon className="h-6 w-6 text-brand-green" />
          </div>
          <h1 className="mt-5 text-center font-display text-xl font-bold text-brand-green">
            Goko Check-in Panel
          </h1>

          {!selectedRole ? (
            <div className="mt-6 space-y-3">
              <p className="text-center text-sm text-brand-green-dark/70">Select your access level</p>
              <button
                type="button"
                onClick={() => setSelectedRole("admin")}
                className="w-full rounded-xl border-2 border-brand-green bg-white px-4 py-4 text-left transition-all hover:bg-brand-green/[0.04] hover:shadow-soft"
              >
                <span className="font-display text-base font-bold text-brand-green">Admin Access</span>
                <p className="mt-0.5 text-xs text-brand-green-dark/60">Full access: view, add, modify, and delete entries</p>
              </button>
              <button
                type="button"
                onClick={() => setSelectedRole("manager")}
                className="w-full rounded-xl border-2 border-brand-mist bg-white px-4 py-4 text-left transition-all hover:border-brand-green/30 hover:shadow-soft"
              >
                <span className="font-display text-base font-bold text-brand-green-dark">Staff Access</span>
                <p className="mt-0.5 text-xs text-brand-green-dark/60">View records and add new entries</p>
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); login(); }} className="mt-6 space-y-4">
              <p className="text-center text-sm text-brand-green-dark/70">
                {selectedRole === "admin" ? "Enter admin password" : "Staff login"}
              </p>
              {selectedRole === "manager" && (
                <div>
                  <Label htmlFor="staff-user">Username</Label>
                  <Input
                    id="staff-user"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    autoFocus
                  />
                </div>
              )}
              <div>
                <Label htmlFor="admin-pw">Password</Label>
                <Input
                  id="admin-pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoFocus={selectedRole === "admin"}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" variant="cta" className="w-full" disabled={loading || !password || (selectedRole === "manager" && !username)}>
                {loading ? "Verifying..." : "Login"}
              </Button>
              <button
                type="button"
                onClick={() => { setSelectedRole(null); setPassword(""); setUsername(""); setError(""); }}
                className="w-full text-center text-sm text-brand-green-dark/60 hover:text-brand-green"
              >
                Back to role selection
              </button>
            </form>
          )}
        </div>
      </section>
    );
  }

  const NAV_ITEMS: { id: AdminSection; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboardIcon className="h-4 w-4" /> },
    { id: "beds", label: "Beds", icon: <BedDoubleIcon className="h-4 w-4" /> },
    { id: "timeline", label: "Timeline", icon: <CalendarDaysIcon className="h-4 w-4" /> },
    { id: "records", label: "Records", icon: <TableIcon className="h-4 w-4" /> },
    { id: "history", label: "History", icon: <HistoryIcon className="h-4 w-4" /> },
    { id: "stats", label: "Stats", icon: <BarChart3Icon className="h-4 w-4" /> },
    { id: "management", label: "Management", icon: <WrenchIcon className="h-4 w-4" />, adminOnly: true },
  ];

  return (
    <section className="min-h-screen bg-brand-sand">
      {/* Top navigation */}
      <nav className="sticky top-0 z-30 border-b border-brand-mist bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2 sm:px-6">
          <div className="flex items-center gap-1">
            {NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin").map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  section === item.id
                    ? "bg-brand-green text-white"
                    : "text-brand-green-dark/70 hover:bg-brand-green/[0.06]"
                )}
              >
                {item.icon}
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-brand-green-dark/50">
              {role}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => { setRole(null); setPassword(""); setSection("dashboard"); }}
            >
              <LogOutIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>

      {/* Section content */}
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {section === "dashboard" && <AdminDashboard password={password} username={username} role={role} onNavigate={setSection} />}
        {section === "beds" && <AdminBeds password={password} username={username} role={role} />}
        {section === "timeline" && <AdminTimeline password={password} username={username} role={role} />}
        {section === "records" && <AdminRecords password={password} username={username} role={role} />}
        {section === "history" && <AdminBedHistory password={password} username={username} role={role} />}
        {section === "stats" && <AdminStats password={password} username={username} />}
        {section === "management" && role === "admin" && <AdminManagement password={password} username={username} role={role} />}
      </div>
    </section>
  );
}
