"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLinkIcon, Trash2Icon, PlusIcon, UploadIcon, PencilIcon, ShieldCheckIcon, ShieldAlertIcon, Loader2Icon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { CHECKIN_COLUMNS, type Role } from "./types";

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

function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([^/]+)\//);
  return match ? match[1] : null;
}

export function AdminRecords({ password, role }: { password: string; role: Role }) {
  const { apiCall } = useAdminApi(password);
  const [rows, setRows] = useState<string[][]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [currentTab, setCurrentTab] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState<string[]>(Array(14).fill(""));
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editEntry, setEditEntry] = useState<string[]>(Array(14).fill(""));
  const [editIdFiles, setEditIdFiles] = useState<File[]>([]);
  const [editVisaFiles, setEditVisaFiles] = useState<File[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"date" | "place" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [verifyPopup, setVerifyPopup] = useState<{ origIdx: number; row: string[] } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const filteredRows = (() => {
    let result = [...rows].map((row, origIdx) => ({ row, origIdx }));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(({ row }) => row.some((cell) => cell?.toLowerCase().includes(q)));
    }
    result.reverse();
    if (sortField === "date") {
      result.sort((a, b) => {
        const dateA = a.row[1] || ""; const dateB = b.row[1] || "";
        return sortDir === "asc" ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
      });
    } else if (sortField === "place") {
      result.sort((a, b) => {
        const placeA = (a.row[7] || "").toLowerCase(); const placeB = (b.row[7] || "").toLowerCase();
        return sortDir === "asc" ? placeA.localeCompare(placeB) : placeB.localeCompare(placeA);
      });
    }
    return result;
  })();

  const hasActiveFilters = searchQuery.trim() !== "" || sortField !== null;
  const clearFilters = () => { setSearchQuery(""); setSortField(null); setSortDir("desc"); };

  const loadTab = async (tab?: string) => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "list", month: tab });
      if (res.ok) {
        const data = await res.json();
        const allRows: string[][] = data.rows || [];
        setRows(allRows.filter((r) => r.some((cell) => cell && cell.trim() !== "")));
        const hiddenTabs = ["CheckIns", "Settings", "Dorms", "BedHistory", "ApiStats"];
        setTabs((data.tabs || []).filter((t: string) => !hiddenTabs.includes(t)));
        setCurrentTab(data.currentTab || "");
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { loadTab(); }, []);

  const refresh = () => loadTab(currentTab);

  const deleteRow = async (rowIndex: number) => {
    if (!confirm("Delete this entry and its documents?")) return;
    setLoading(true);
    try {
      const row = rows[rowIndex];
      const driveFileIds: string[] = [];
      [row[12], row[13]].forEach((cell) => {
        if (cell) cell.split(" | ").forEach((url) => {
          if (url.startsWith("http")) { const id = extractDriveFileId(url); if (id) driveFileIds.push(id); }
        });
      });
      const res = await apiCall({ action: "delete", rowIndex, driveFileIds, tab: currentTab });
      if (res.ok) setRows((prev) => prev.filter((_, i) => i !== rowIndex));
    } finally { setLoading(false); }
  };

  const startEdit = (rowIndex: number) => {
    const padded = Array(14).fill("").map((_, i) => rows[rowIndex][i] || "");
    setEditEntry(padded);
    setEditIndex(rowIndex);
    setEditIdFiles([]);
    setEditVisaFiles([]);
  };

  const updateRow = async () => {
    if (editIndex === null) return;
    setLoading(true);
    try {
      const updated = [...editEntry];
      const uploadFiles = async (files: File[], guestName: string, type: string) => {
        const links: string[] = [];
        for (const file of files) {
          const fd = new FormData();
          fd.append("file", file); fd.append("name", guestName); fd.append("type", type); fd.append("password", password);
          const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
          if (res.ok) { const data = await res.json(); if (data.link) links.push(data.link); }
        }
        return links.join(" | ");
      };
      if (editIdFiles.length > 0) updated[12] = await uploadFiles(editIdFiles, updated[3] || "Guest", "id");
      if (editVisaFiles.length > 0) updated[13] = await uploadFiles(editVisaFiles, updated[3] || "Guest", "visa");
      const res = await apiCall({ action: "update", rowIndex: editIndex, entry: updated, tab: currentTab });
      if (res.ok) { setEditIndex(null); refresh(); }
    } finally { setLoading(false); }
  };

  const addEntry = async () => {
    if (!newEntry[3]) { alert("Name is required"); return; }
    setLoading(true);
    try {
      const entry = [...newEntry]; entry[0] = new Date().toISOString();
      const res = await apiCall({ action: "add", entry });
      if (res.ok) { setShowAddForm(false); setNewEntry(Array(15).fill("")); refresh(); }
    } finally { setLoading(false); }
  };

  const verifyManually = async (origIdx: number, verified: boolean) => {
    setVerifying(true);
    try {
      const res = await apiCall({ action: "verifyCheckin", rowIndex: origIdx, verified, tab: currentTab });
      if (res.ok) { setVerifyPopup(null); refresh(); }
    } finally { setVerifying(false); }
  };

  if (loading && rows.length === 0) {
    return <AdminLoading message="Loading records..." />;
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Check-in Records</h2>
        <div className="flex gap-2">
          <Button type="button" variant="ctaOutline" onClick={() => setShowAddForm(true)} disabled={loading}>
            <PlusIcon className="mr-1 h-4 w-4" /> Add
          </Button>
          <Button type="button" variant="ctaOutline" onClick={refresh} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Month tabs */}
      {tabs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button key={tab} type="button" onClick={() => loadTab(tab)}
              className={cn("rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                tab === currentTab ? "bg-brand-green text-white" : "bg-white text-brand-green-dark/70 hover:bg-brand-green/[0.06]"
              )}>
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Search and filters */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="max-w-xs" />
          <select value={sortField || ""} onChange={(e) => setSortField(e.target.value ? e.target.value as any : null)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
            <option value="">Sort by...</option>
            <option value="date">Date</option>
            <option value="place">Coming from</option>
          </select>
          {sortField && <button type="button" onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} className="rounded-md border border-input bg-background px-2 py-2 text-xs">{sortDir === "asc" ? "A-Z" : "Z-A"}</button>}
          {hasActiveFilters && <button type="button" onClick={clearFilters} className="rounded-md bg-brand-red/10 px-3 py-2 text-xs font-medium text-brand-red hover:bg-brand-red/20">Clear</button>}
        </div>
        <p className="text-sm text-brand-green-dark/70">{filteredRows.length}{filteredRows.length !== rows.length ? ` of ${rows.length}` : ""} records</p>
      </div>

      {/* Add entry form */}
      {showAddForm && (
        <div className="mt-4 rounded-2xl border border-brand-mist bg-white p-6 shadow-card">
          <h3 className="font-display text-lg font-bold text-brand-green">Add manual entry</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {TEXT_FIELDS.map((field) => (
              <div key={field.index}>
                <Label className="text-xs">{field.label}</Label>
                {field.type === "select" ? (
                  <select value={newEntry[field.index]} onChange={(e) => { const u = [...newEntry]; u[field.index] = e.target.value; setNewEntry(u); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">Select...</option>
                    {field.options!.map((opt) => <option key={opt} value={opt}>{opt.replace("_", " ")}</option>)}
                  </select>
                ) : (
                  <Input type={field.type} value={newEntry[field.index]} onChange={(e) => { const u = [...newEntry]; u[field.index] = e.target.value; setNewEntry(u); }} placeholder={field.label} className="mt-1" />
                )}
              </div>
            ))}
            <div>
              <Label className="text-xs">ID Card photos</Label>
              <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-brand-sand/50">
                <UploadIcon className="h-4 w-4 text-brand-green" /> Choose files
                <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => {}} />
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="cta" onClick={addEntry} disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Edit form */}
      {editIndex !== null && (
        <div className="mt-4 rounded-2xl border-2 border-brand-green/20 bg-white p-6 shadow-card">
          <h3 className="font-display text-lg font-bold text-brand-green">Edit entry</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {CHECKIN_COLUMNS.map((col, i) => (
              <div key={col}>
                <Label className="text-xs">{col}</Label>
                {col === "ID Card" || col === "Visa" ? (
                  <div className="mt-1 space-y-2">
                    {editEntry[i] && <p className="truncate text-xs text-brand-green-dark/60">{editEntry[i].split(" | ").filter(Boolean).length} file(s)</p>}
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-brand-sand/50">
                      <UploadIcon className="h-4 w-4 text-brand-green" />
                      {col === "ID Card" ? (editIdFiles.length > 0 ? `${editIdFiles.length} new` : "Replace") : (editVisaFiles.length > 0 ? `${editVisaFiles.length} new` : "Replace")}
                      <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => col === "ID Card" ? setEditIdFiles(Array.from(e.target.files || [])) : setEditVisaFiles(Array.from(e.target.files || []))} />
                    </label>
                  </div>
                ) : (
                  <Input value={editEntry[i]} onChange={(e) => { const u = [...editEntry]; u[i] = e.target.value; setEditEntry(u); }} placeholder={col} className="mt-1" />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="cta" onClick={updateRow} disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={() => setEditIndex(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-brand-mist bg-white shadow-card">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr className="border-b border-brand-mist bg-brand-sand/50">
              {CHECKIN_COLUMNS.map((col) => (
                <th key={col} className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">{col}</th>
              ))}
              {role === "admin" && <th className="px-3 py-3 text-xs font-bold uppercase">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr><td colSpan={CHECKIN_COLUMNS.length + 1} className="px-4 py-12 text-center text-brand-green-dark/50">{rows.length === 0 ? "No records" : "No matches"}</td></tr>
            ) : (
              filteredRows.map(({ row, origIdx }) => (
                <tr key={origIdx} className="border-b border-brand-mist/60 last:border-b-0 hover:bg-brand-sand/30">
                  {CHECKIN_COLUMNS.map((col, ci) => {
                    const cell = row[ci] || "";
                    const links = cell.includes(" | ") ? cell.split(" | ").filter((u) => u.startsWith("http")) : cell.startsWith("http") ? [cell] : [];

                    if (col === "Verified") {
                      return (
                        <td key={ci} className="whitespace-nowrap px-3 py-3">
                          {cell === "yes" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                              <ShieldCheckIcon className="h-3 w-3" /> Verified
                            </span>
                          ) : cell === "no" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                              <ShieldAlertIcon className="h-3 w-3" /> Rejected
                            </span>
                          ) : (
                            <button type="button" onClick={() => setVerifyPopup({ origIdx, row })}
                              className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold text-yellow-700 hover:bg-yellow-200">
                              <ShieldAlertIcon className="h-3 w-3" /> Pending
                            </button>
                          )}
                        </td>
                      );
                    }

                    return (
                      <td key={ci} className="whitespace-nowrap px-3 py-3">
                        {links.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {links.map((url, li) => (
                              <a key={li} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-brand-green/[0.06] px-2 py-1 text-xs font-medium text-brand-green hover:bg-brand-green/[0.12]">
                                {links.length > 1 ? (li === 0 ? "Front" : li === 1 ? "Back" : `P${li + 1}`) : "View"} <ExternalLinkIcon className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        ) : <span className="text-brand-green-dark/90">{cell}</span>}
                      </td>
                    );
                  })}
                  {role === "admin" && (
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        <button type="button" onClick={() => startEdit(origIdx)} className="flex h-8 w-8 items-center justify-center rounded-lg text-brand-green/70 hover:bg-brand-green/[0.06]"><PencilIcon className="h-4 w-4" /></button>
                        <button type="button" onClick={() => deleteRow(origIdx)} className="flex h-8 w-8 items-center justify-center rounded-lg text-red-400 hover:bg-red-50"><Trash2Icon className="h-4 w-4" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Manual verification popup */}
      {verifyPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setVerifyPopup(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lift" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-brand-green-dark">Manual ID Verification</h3>
              <button type="button" onClick={() => setVerifyPopup(null)} className="rounded-lg p-1 hover:bg-brand-sand">
                <XIcon className="h-5 w-5 text-brand-green-dark/50" />
              </button>
            </div>
            <p className="mt-2 text-sm text-brand-green-dark/70">
              Review the uploaded ID for <strong>{verifyPopup.row[3]}</strong> and mark as verified or rejected.
            </p>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-green-dark/50">ID Documents</p>
              {(() => {
                const idCell = verifyPopup.row[12] || "";
                const visaCell = verifyPopup.row[13] || "";
                const idLinks = idCell.split(" | ").filter((u) => u.startsWith("http"));
                const visaLinks = visaCell.split(" | ").filter((u) => u.startsWith("http"));
                return (
                  <>
                    {idLinks.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs text-brand-green-dark/50">ID ({verifyPopup.row[11]}):</span>
                        {idLinks.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-brand-green/[0.06] px-3 py-1.5 text-xs font-medium text-brand-green hover:bg-brand-green/[0.12]">
                            {idLinks.length > 1 ? (i === 0 ? "Front" : "Back") : "View ID"} <ExternalLinkIcon className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    )}
                    {visaLinks.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs text-brand-green-dark/50">Visa:</span>
                        {visaLinks.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-brand-green/[0.06] px-3 py-1.5 text-xs font-medium text-brand-green hover:bg-brand-green/[0.12]">
                            View <ExternalLinkIcon className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    )}
                    {idLinks.length === 0 && visaLinks.length === 0 && (
                      <p className="text-xs text-brand-green-dark/40">No documents uploaded</p>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="mt-6 flex gap-3">
              <button type="button" disabled={verifying}
                onClick={() => verifyManually(verifyPopup.origIdx, true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50">
                {verifying ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <ShieldCheckIcon className="h-4 w-4" />}
                Verified
              </button>
              <button type="button" disabled={verifying}
                onClick={() => verifyManually(verifyPopup.origIdx, false)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50">
                {verifying ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <ShieldAlertIcon className="h-4 w-4" />}
                Rejected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
