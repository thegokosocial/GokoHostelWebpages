"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockIcon, LogOutIcon, ExternalLinkIcon, Trash2Icon, PlusIcon, UploadIcon, PencilIcon } from "lucide-react";

const COLUMNS = [
  "Submitted At", "Arrival Date", "Arrival Time", "Name", "Persons",
  "Contact", "Days", "Coming From", "Nationality", "Emergency Contact",
  "Emergency Phone", "ID Type", "ID Card", "Visa",
];

type Role = "admin" | "manager";

const TEXT_FIELDS = [
  { index: 1, label: "Arrival Date", type: "date" },
  { index: 2, label: "Arrival Time", type: "time" },
  { index: 3, label: "Name", type: "text" },
  { index: 4, label: "Persons", type: "text" },
  { index: 5, label: "Contact", type: "tel" },
  { index: 6, label: "Days", type: "text" },
  { index: 7, label: "Coming From", type: "text" },
  { index: 8, label: "Nationality", type: "text" },
  { index: 9, label: "Emergency Contact", type: "text" },
  { index: 10, label: "Emergency Phone", type: "tel" },
  { index: 11, label: "ID Type", type: "select", options: ["aadhaar", "driving_licence", "passport"] },
];

function AddEntryForm({
  loading,
  onSave,
  onCancel,
  newEntry,
  setNewEntry,
  password,
}: {
  loading: boolean;
  onSave: () => void;
  onCancel: () => void;
  newEntry: string[];
  setNewEntry: (e: string[]) => void;
  password: string;
}) {
  const [idFiles, setIdFiles] = useState<File[]>([]);
  const [visaFiles, setVisaFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleSave = async () => {
    setUploading(true);
    try {
      const uploadFiles = async (files: File[], name: string, type: string) => {
        const links: string[] = [];
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("name", name);
          formData.append("type", type);
          formData.append("password", password);
          const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
          if (res.ok) {
            const data = await res.json();
            if (data.link) links.push(data.link);
          }
        }
        return links.join(" | ");
      };

      const guestName = newEntry[3] || "Guest";
      const updated = [...newEntry];

      if (idFiles.length > 0) {
        updated[12] = await uploadFiles(idFiles, guestName, "id");
      }
      if (visaFiles.length > 0) {
        updated[13] = await uploadFiles(visaFiles, guestName, "visa");
      }

      setNewEntry(updated);
      setTimeout(onSave, 50);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-brand-mist bg-white p-6 shadow-card">
      <h3 className="font-display text-lg font-bold text-brand-green">Add manual entry</h3>
      <p className="mt-1 text-xs text-brand-green-dark/60">No validations applied for manual entries</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {TEXT_FIELDS.map((field) => (
          <div key={field.index}>
            <Label className="text-xs">{field.label}</Label>
            {field.type === "select" ? (
              <select
                value={newEntry[field.index]}
                onChange={(e) => {
                  const updated = [...newEntry];
                  updated[field.index] = e.target.value;
                  setNewEntry(updated);
                }}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {field.options!.map((opt) => (
                  <option key={opt} value={opt}>{opt.replace("_", " ")}</option>
                ))}
              </select>
            ) : (
              <Input
                type={field.type}
                value={newEntry[field.index]}
                onChange={(e) => {
                  const updated = [...newEntry];
                  updated[field.index] = e.target.value;
                  setNewEntry(updated);
                }}
                placeholder={field.label}
                className="mt-1"
              />
            )}
          </div>
        ))}

        <div>
          <Label className="text-xs">ID Card photos</Label>
          <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors hover:bg-brand-sand/50">
            <UploadIcon className="h-4 w-4 text-brand-green" />
            {idFiles.length > 0 ? `${idFiles.length} file(s)` : "Choose files"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => setIdFiles(Array.from(e.target.files || []))}
            />
          </label>
        </div>

        <div>
          <Label className="text-xs">Visa photos</Label>
          <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors hover:bg-brand-sand/50">
            <UploadIcon className="h-4 w-4 text-brand-green" />
            {visaFiles.length > 0 ? `${visaFiles.length} file(s)` : "Choose files"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => setVisaFiles(Array.from(e.target.files || []))}
            />
          </label>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button type="button" variant="cta" onClick={handleSave} disabled={loading || uploading}>
          {uploading ? "Uploading..." : "Save entry"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([^/]+)\//);
  return match ? match[1] : null;
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [currentTab, setCurrentTab] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState<string[]>(Array(14).fill(""));
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editEntry, setEditEntry] = useState<string[]>(Array(14).fill(""));

  const apiCall = async (body: any) => {
    const res = await fetch("/api/admin/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, ...body }),
    });
    return res;
  };

  const login = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiCall({ action: "list" });
      if (res.status === 401) { setError("Incorrect password"); return; }
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setRows(data.rows || []);
      setRole(data.role);
      setTabs(data.tabs || []);
      setCurrentTab(data.currentTab || "");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const loadTab = async (tab: string) => {
    setLoading(true);
    setCurrentTab(tab);
    try {
      const res = await apiCall({ action: "list", month: tab });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
        setTabs(data.tabs || []);
      }
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => loadTab(currentTab);

  const deleteRow = async (rowIndex: number) => {
    if (!confirm("Are you sure you want to delete this entry? This will also delete uploaded documents.")) return;
    setLoading(true);
    try {
      const row = rows[rowIndex];
      const driveFileIds: string[] = [];
      [row[12], row[13]].forEach((cell) => {
        if (cell) {
          cell.split(" | ").forEach((url) => {
            if (url.startsWith("http")) {
              const id = extractDriveFileId(url);
              if (id) driveFileIds.push(id);
            }
          });
        }
      });

      const res = await apiCall({ action: "delete", rowIndex, driveFileIds, tab: currentTab });
      if (res.ok) {
        setRows((prev) => prev.filter((_, i) => i !== rowIndex));
      } else {
        const data = await res.json();
        alert(data.error || "Delete failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const addEntry = async () => {
    if (!newEntry[3]) { alert("Name is required"); return; }
    setLoading(true);
    try {
      const entry = [...newEntry];
      entry[0] = new Date().toISOString();
      const res = await apiCall({ action: "add", entry });
      if (res.ok) {
        setShowAddForm(false);
        setNewEntry(Array(13).fill(""));
        refresh();
      }
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (rowIndex: number) => {
    const row = rows[rowIndex];
    const padded = Array(14).fill("").map((_, i) => row[i] || "");
    setEditEntry(padded);
    setEditIndex(rowIndex);
  };

  const updateRow = async () => {
    if (editIndex === null) return;
    setLoading(true);
    try {
      const res = await apiCall({ action: "update", rowIndex: editIndex, entry: editEntry, tab: currentTab });
      if (res.ok) {
        setEditIndex(null);
        refresh();
      } else {
        const data = await res.json();
        alert(data.error || "Update failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const [selectedRole, setSelectedRole] = useState<"admin" | "manager" | null>(null);

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
              <p className="text-center text-sm text-brand-green-dark/70">
                Select your access level
              </p>
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
                Enter {selectedRole === "admin" ? "admin" : "staff"} password
              </p>
              <div>
                <Label htmlFor="admin-pw">Password</Label>
                <Input
                  id="admin-pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" variant="cta" className="w-full" disabled={loading || !password}>
                {loading ? "Verifying..." : "Login"}
              </Button>
              <button
                type="button"
                onClick={() => { setSelectedRole(null); setPassword(""); setError(""); }}
                className="w-full text-center text-sm text-brand-green-dark/60 hover:text-brand-green"
              >
                ← Back to role selection
              </button>
            </form>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-brand-sand py-8">
      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-xl font-bold text-brand-green md:text-2xl">
              Check-in Records
            </h1>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-brand-green-dark/50">
              Logged in as {role}
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ctaOutline" onClick={() => setShowAddForm(true)} disabled={loading}>
              <PlusIcon className="mr-1 h-4 w-4" /> Add
            </Button>
            <Button type="button" variant="ctaOutline" onClick={refresh} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
            <Button
              type="button" variant="ghost" size="icon"
              onClick={() => { setRole(null); setPassword(""); setRows([]); }}
            >
              <LogOutIcon className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Month tabs */}
        {tabs.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => loadTab(tab)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  tab === currentTab
                    ? "bg-brand-green text-white"
                    : "bg-white text-brand-green-dark/70 hover:bg-brand-green/[0.06]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        <p className="mt-4 text-sm text-brand-green-dark/70">
          {rows.length} record{rows.length !== 1 ? "s" : ""} in {currentTab}
        </p>

        {/* Add entry form */}
        {showAddForm && (
          <AddEntryForm
            loading={loading}
            onSave={addEntry}
            onCancel={() => setShowAddForm(false)}
            newEntry={newEntry}
            setNewEntry={setNewEntry}
            password={password}
          />
        )}

        {/* Edit entry form */}
        {editIndex !== null && (
          <div className="mt-4 rounded-2xl border-2 border-brand-green/20 bg-white p-6 shadow-card">
            <h3 className="font-display text-lg font-bold text-brand-green">Edit entry (row {editIndex + 1})</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {COLUMNS.map((col, i) => (
                <div key={col}>
                  <Label className="text-xs">{col}</Label>
                  {col === "ID Type" ? (
                    <select
                      value={editEntry[i]}
                      onChange={(e) => {
                        const updated = [...editEntry];
                        updated[i] = e.target.value;
                        setEditEntry(updated);
                      }}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select...</option>
                      <option value="aadhaar">aadhaar</option>
                      <option value="driving_licence">driving licence</option>
                      <option value="passport">passport</option>
                    </select>
                  ) : col === "ID Card" || col === "Visa" ? (
                    <Input
                      value={editEntry[i]}
                      onChange={(e) => {
                        const updated = [...editEntry];
                        updated[i] = e.target.value;
                        setEditEntry(updated);
                      }}
                      placeholder="Drive link(s)"
                      className="mt-1 text-xs"
                      readOnly
                    />
                  ) : (
                    <Input
                      value={editEntry[i]}
                      onChange={(e) => {
                        const updated = [...editEntry];
                        updated[i] = e.target.value;
                        setEditEntry(updated);
                      }}
                      placeholder={col}
                      className="mt-1"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="cta" onClick={updateRow} disabled={loading}>
                {loading ? "Saving..." : "Save changes"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditIndex(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="mt-6 overflow-x-auto rounded-2xl border border-brand-mist bg-white shadow-card">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr className="border-b border-brand-mist bg-brand-sand/50">
                {COLUMNS.map((col) => (
                  <th key={col} className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">
                    {col}
                  </th>
                ))}
                {role === "admin" && (
                  <th className="px-3 py-3 text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-4 py-12 text-center text-brand-green-dark/50">
                    No check-in records in this month
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i} className="border-b border-brand-mist/60 last:border-b-0 hover:bg-brand-sand/30">
                    {COLUMNS.map((_, ci) => {
                      const cell = row[ci] || "";
                      const links = cell.includes(" | ")
                        ? cell.split(" | ").filter((u: string) => u.startsWith("http"))
                        : cell.startsWith("http") ? [cell] : [];
                      return (
                        <td key={ci} className="whitespace-nowrap px-3 py-3">
                          {links.length > 0 ? (
                            <div className="flex gap-2">
                              {links.map((url: string, li: number) => (
                                <a key={li} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-red hover:underline">
                                  {links.length > 1 ? `${li + 1}` : "View"} <ExternalLinkIcon className="h-3.5 w-3.5" />
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="text-brand-green-dark/90">{cell}</span>
                          )}
                        </td>
                      );
                    })}
                    {role === "admin" && (
                      <td className="px-3 py-3">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(i)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-brand-green/70 transition-colors hover:bg-brand-green/[0.06] hover:text-brand-green"
                            title="Edit entry"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRow(i)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            title="Delete entry and documents"
                          >
                            <Trash2Icon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
