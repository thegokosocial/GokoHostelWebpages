"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLinkIcon, Trash2Icon, PlusIcon, UploadIcon, PencilIcon, ShieldCheckIcon, ShieldAlertIcon, Loader2Icon, XIcon, FileTextIcon, LayoutListIcon, TableIcon, ChevronDownIcon, PhoneIcon, MapPinIcon, CalendarIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { cn, localDateStr } from "@/lib/utils";
import { staggerContainer, staggerItem, overlayVariants, modalVariants } from "@/lib/animations";
import { getAgeFromDob, dobsMatch, resolveDobForChecks } from "@/lib/parseDob";
import { useAdminApi } from "./useAdminApi";
import { AdminLoading } from "./AdminLoading";
import { CHECKIN_COLUMNS, type Role, hasPermission } from "./types";
import { countries } from "@/content/countries";
import { BOOKING_PLATFORMS, isForeignNationality } from "@/lib/checkinSchema";
import { useAdminToast } from "@/components/admin/AdminToast";

const TEXT_FIELDS = [
  { index: 1, label: "Arrival Date", type: "date" },
  { index: 2, label: "Arrival Time", type: "time" },
  { index: 3, label: "Name", type: "name_split" },
  { index: 4, label: "Persons", type: "text" },
  { index: 5, label: "Contact", type: "tel" },
  { index: 6, label: "Days", type: "text" },
  { index: 7, label: "Coming From", type: "text" },
  { index: 8, label: "Nationality", type: "country" },
  { index: 9, label: "Emergency Contact", type: "text" },
  { index: 10, label: "Emergency Phone", type: "tel" },
  { index: 13, label: "ID Type", type: "select", options: ["aadhaar", "driving_licence", "passport"] },
];

const FORM_C_FIELDS = [
  { key: "arrivedFromCountry", label: "Arrived from Country", type: "country" },
  { key: "arrivedFromCity", label: "Arrived from City", type: "text" },
  { key: "arrivedFromPlace", label: "Arrived from Place", type: "text" },
  { key: "dateOfArrivalInIndia", label: "Date of Arrival in India", type: "date" },
  { key: "purposeOfVisit", label: "Purpose of Visit", type: "select", options: ["Tourism", "Business", "Medical", "Education", "Employment", "Conference", "Research", "Transit", "Others"] },
  { key: "employedInIndia", label: "Employed in India?", type: "select", options: ["No", "Yes"] },
  { key: "nextDestination", label: "Next Destination", type: "select", options: ["Inside India", "Outside India"] },
  { key: "nextDestState", label: "Next Dest. State", type: "text" },
  { key: "nextDestCity", label: "Next Dest. City", type: "text" },
  { key: "homeAddress", label: "Home Country Address", type: "text" },
  { key: "homeCity", label: "Home City", type: "text" },
  { key: "homeCountryPhone", label: "Home Country Phone", type: "tel" },
];

const ID_TYPE_OPTIONS = ["aadhaar", "driving_licence", "passport"];

function getIdTypeOptions(nationality: string): string[] {
  return isForeignNationality(nationality) ? ["passport"] : ID_TYPE_OPTIONS;
}

function getDefaults(): string[] {
  const arr = Array(17).fill("");
  const now = new Date();
  arr[1] = localDateStr(now);
  arr[2] = now.toTimeString().slice(0, 5);
  arr[8] = "India";
  return arr;
}

function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([^/]+)\//);
  return match ? match[1] : null;
}

function formCSubmissions(data: Record<string, any>): { id: string; date: string }[] {
  if (Array.isArray(data.frroSubmissions) && data.frroSubmissions.length > 0) return data.frroSubmissions;
  return data.frroApplicationId ? [{ id: data.frroApplicationId, date: data.frroSubmittedAt || "" }] : [];
}

function parseFormCDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/) || value.trim().match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
  if (!match) return null;
  const [a, b, c] = match.slice(1).map(Number);
  const [year, month, day] = c > 31 ? [c, b, a] : [a, b, c];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function formCSubmissionGuardrails(data: Record<string, any>): string[] {
  const p = data.extractedPassport || {};
  const v = data.extractedVisa || {};
  const missing = [
    ["passport number", p.passportNumber], ["passport date of birth", p.dateOfBirth], ["passport expiry", p.expiryDate],
    ["visa number", v.visaNumber], ["visa type", v.type], ["visa expiry", v.validTill],
    ["arrived-from country", data.arrivedFromCountry], ["purpose of visit", data.purposeOfVisit],
  ].filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
  const issues = missing.length > 0 ? [`Missing: ${missing.join(", ")}.`] : [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const passportIssue = parseFormCDate(p.dateOfIssue);
  const passportExpiry = parseFormCDate(p.expiryDate);
  const visaIssue = parseFormCDate(v.dateOfIssue);
  const visaExpiry = parseFormCDate(v.validTill);
  if (passportIssue && passportIssue > today) issues.push("Passport issue date is in the future.");
  if (passportExpiry && passportExpiry <= today) issues.push("Passport has expired.");
  if (passportIssue && passportExpiry && passportIssue >= passportExpiry) issues.push("Passport issue date must be before expiry.");
  if (visaIssue && visaIssue > today) issues.push("Visa issue date is in the future.");
  if (visaExpiry && visaExpiry <= today) issues.push("Visa has expired.");
  if (visaIssue && visaExpiry && visaIssue >= visaExpiry) issues.push("Visa issue date must be before expiry.");
  return issues;
}

function isUsableFrroApplicationId(value: unknown): value is string {
  const id = String(value || "").trim();
  return Boolean(id) && !/^(saved|your)$/i.test(id) && !/check\s+frro|application\s+id/i.test(id);
}

export function AdminRecords({ password, username, role, permissions = {} }: { password: string; username?: string; role: Role; permissions?: Record<string, boolean> }) {
  const { apiCall } = useAdminApi(password, username);
  const { showError, showSuccess } = useAdminToast();
  const [rows, setRows] = useState<string[][]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [currentTab, setCurrentTab] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState<string[]>(getDefaults());
  const [newIdFiles, setNewIdFiles] = useState<File[]>([]);
  const [newVisaFiles, setNewVisaFiles] = useState<File[]>([]);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [showPastForm, setShowPastForm] = useState(false);
  const [pastEntry, setPastEntry] = useState<string[]>(getDefaults());
  const [pastIdFiles, setPastIdFiles] = useState<File[]>([]);
  const [pastVisaFiles, setPastVisaFiles] = useState<File[]>([]);
  const [pastFirstName, setPastFirstName] = useState("");
  const [pastLastName, setPastLastName] = useState("");
  const [pastCheckoutDate, setPastCheckoutDate] = useState("");
  const [newFormCFields, setNewFormCFields] = useState<Record<string, string>>({});
  const [pastFormCFields, setPastFormCFields] = useState<Record<string, string>>({});
  const [newBookingPlatform, setNewBookingPlatform] = useState("");
  const [newBookingId, setNewBookingId] = useState("");
  const [newDob, setNewDob] = useState("");
  const [pastBookingPlatform, setPastBookingPlatform] = useState("");
  const [pastBookingId, setPastBookingId] = useState("");
  const [pastDob, setPastDob] = useState("");
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editEntry, setEditEntry] = useState<string[]>(Array(17).fill(""));
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editIdFiles, setEditIdFiles] = useState<File[]>([]);
  const [editVisaFiles, setEditVisaFiles] = useState<File[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"date" | "place" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [verifyPopup, setVerifyPopup] = useState<{ origIdx: number; row: string[] } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [uploadPopup, setUploadPopup] = useState<{ origIdx: number; type: "id" | "visa"; guestName: string; nationality: string } | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadIdType, setUploadIdType] = useState("");
  const [uploading, setUploading] = useState(false);
  const [formCPopup, setFormCPopup] = useState<{ origIdx: number; row: string[]; data: any } | null>(null);
  const [formCLoading, setFormCLoading] = useState(false);
  const [formCEditing, setFormCEditing] = useState(false);
  const [formCEditData, setFormCEditData] = useState<Record<string, any>>({});
  const [formCSaving, setFormCSaving] = useState(false);
  const [frroUsername, setFrroUsername] = useState("");
  const [frroPassword, setFrroPassword] = useState("");
  const [showFrroPassword, setShowFrroPassword] = useState(false);
  const [frroSettingsOpen, setFrroSettingsOpen] = useState(false);
  const [frroSubmitting, setFrroSubmitting] = useState(false);
  const [frroDeleting, setFrroDeleting] = useState<number | null>(null);
  const [frroStatus, setFrroStatus] = useState("");
  const [ageRange, setAgeRange] = useState({ min: 18, max: 40 });
  const [vibeMatchingId, setVibeMatchingId] = useState<number | null>(null);
  const [showDobInRecords, setShowDobInRecords] = useState(false);
  const [viewMode, setViewMode] = useState<"card" | "table">(() => typeof window !== "undefined" && window.innerWidth < 1024 ? "card" : "table");
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const editFormRef = useRef<HTMLDivElement>(null);
  const scrollBackId = useRef<string | null>(null);

  const openUploadPopup = (origIdx: number, type: "id" | "visa", guestName: string, nationality: string) => {
    setUploadIdType(type === "id" && isForeignNationality(nationality) ? "passport" : "");
    setUploadPopup({ origIdx, type, guestName, nationality });
  };

  useEffect(() => {
    if (scrollBackId.current && rows.length > 0) {
      const id = scrollBackId.current;
      scrollBackId.current = null;
      setTimeout(() => {
        const el = document.querySelector(`[data-record-id="${id}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
  }, [rows]);

  const filteredRows = useMemo(() => {
    let result = rows.map((row, origIdx) => ({ row, origIdx }));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(({ row }) => row.some((cell) => cell?.toLowerCase().includes(q)));
    }
    if (sortField === "date") {
      result = [...result].sort((a, b) => {
        const dateA = a.row[1] || ""; const dateB = b.row[1] || "";
        return sortDir === "asc" ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
      });
    } else if (sortField === "place") {
      result = [...result].sort((a, b) => {
        const placeA = (a.row[7] || "").toLowerCase(); const placeB = (b.row[7] || "").toLowerCase();
        return sortDir === "asc" ? placeA.localeCompare(placeB) : placeB.localeCompare(placeA);
      });
    }
    return result;
  }, [rows, searchQuery, sortField, sortDir]);

  const hasActiveFilters = searchQuery.trim() !== "" || sortField !== null;
  const clearFilters = () => { setSearchQuery(""); setSortField(null); setSortDir("desc"); };

  const loadTab = async (tab?: string) => {
    setExpandedCard(null);
    setEditIndex(null);
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

  useEffect(() => {
    loadTab();
    (async () => {
      try {
        const [minRes, maxRes, dobRes] = await Promise.all([
          apiCall({ action: "getSetting", key: "guest_min_age" }),
          apiCall({ action: "getSetting", key: "guest_max_age" }),
          apiCall({ action: "getSetting", key: "show_dob_in_records" }),
        ]);
        if (minRes.ok) { const d = await minRes.json(); if (d.value) setAgeRange((prev) => ({ ...prev, min: Number(d.value) || 18 })); }
        if (maxRes.ok) { const d = await maxRes.json(); if (d.value) setAgeRange((prev) => ({ ...prev, max: Number(d.value) || 40 })); }
        if (dobRes.ok) { const d = await dobRes.json(); setShowDobInRecords(d.value === "true"); }
      } catch {}
    })();
  }, []);

  const refresh = () => loadTab(currentTab);

  const deleteRow = async (rowIndex: number) => {
    const row = rows[rowIndex];
    const rowId = parseInt(row[17] || "0", 10);
    let warning = "Delete this entry and its documents?";
    try {
      const infoRes = await apiCall({ action: "getDeleteInfo", rowId });
      if (infoRes.ok) {
        const info = await infoRes.json();
        const orders = Array.isArray(info.orders) ? info.orders : [];
        if (orders.length > 0) {
          const summary = orders.map((order: { orderNumber?: string; total?: number; status?: string }) =>
            `${order.orderNumber || "order"} · ₹${Number(order.total || 0)} · ${order.status || "unknown"}`
          ).join("\n");
          warning = `This guest has ${orders.length} food order${orders.length === 1 ? "" : "s"}:\n\n${summary}\n\nDeleting the record will keep the food order history but detach it from this guest. Continue?`;
        }
      }
    } catch {}
    if (!confirm(warning)) return;
    setLoading(true);
    try {
      const driveFileIds: string[] = [];
      [row[14], row[15]].forEach((cell) => {
        if (cell) cell.split(" | ").forEach((url) => {
          if (url.startsWith("http")) { const id = extractDriveFileId(url); if (id) driveFileIds.push(id); }
        });
      });
      const guestName = row[3] || "";
      const res = await apiCall({ action: "delete", rowId, driveFileIds, guestName });
      if (res.ok) setRows((prev) => prev.filter((_, i) => i !== rowIndex));
    } finally { setLoading(false); }
  };

  const startEdit = (rowIndex: number) => {
    const padded = Array(17).fill("").map((_, i) => rows[rowIndex][i] || "");
    if (isForeignNationality(padded[8])) padded[13] = "passport";
    setEditEntry(padded);
    setEditIndex(rowIndex);
    const nameParts = (padded[3] || "").trim().split(/\s+/);
    setEditFirstName(nameParts[0] || "");
    setEditLastName(nameParts.slice(1).join(" ") || "");
    setEditIdFiles([]);
    setEditVisaFiles([]);
    setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const updateRow = async () => {
    if (editIndex === null) return;
    if (isForeignNationality(editEntry[8]) && !editEntry[15] && editVisaFiles.length === 0) {
      showError("Visa document is required for foreign nationals");
      return;
    }
    setLoading(true);
    try {
      const updated = [...editEntry];
      updated[3] = `${editFirstName.trim()} ${editLastName.trim()}`.trim();
      const doUpload = async (files: File[], guestName: string, type: string) => {
        const links: string[] = [];
        for (const file of files) {
          const fd = new FormData();
          fd.append("file", file); fd.append("name", guestName); fd.append("type", type); fd.append("password", password);
          const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
          if (res.ok) { const data = await res.json(); if (data.link) links.push(data.link); }
          else { showError("File upload failed", `${res.status}: ${await res.text()}`); }
        }
        return links.join(" | ");
      };
      if (editIdFiles.length > 0) updated[14] = await doUpload(editIdFiles, updated[3] || "Guest", "id");
      if (editVisaFiles.length > 0) updated[15] = await doUpload(editVisaFiles, updated[3] || "Guest", "visa");
      const rowId = parseInt(rows[editIndex!][17] || "0", 10);
      const res = await apiCall({ action: "update", rowId, entry: updated, tab: currentTab });
      if (res.ok) { scrollBackId.current = String(rowId); setEditIndex(null); refresh(); }
    } finally { setLoading(false); }
  };

  const addEntry = async () => {
    if (!newFirstName.trim() || !newLastName.trim()) { showError("First name and last name are required"); return; }
    if (isForeignNationality(newEntry[8]) && newVisaFiles.length === 0) { showError("Visa document is required for foreign nationals"); return; }
    newEntry[3] = `${newFirstName.trim()} ${newLastName.trim()}`;
    setLoading(true);
    try {
      const entry = [...newEntry]; entry[0] = new Date().toISOString();
      if (isForeignNationality(entry[8])) entry[13] = "passport";

      if (newIdFiles.length > 0) {
        const links: string[] = [];
        for (const file of newIdFiles) {
          const fd = new FormData();
          fd.append("file", file); fd.append("name", entry[3] || "Guest"); fd.append("type", "id"); fd.append("password", password);
          try {
            const uploadRes = await fetch("/api/admin/upload", { method: "POST", body: fd });
            if (uploadRes.ok) {
              const data = await uploadRes.json();
              if (data.link) links.push(data.link);
            } else {
              const errText = await uploadRes.text();
              showError("File upload failed. Entry will be saved without ID document.", errText);
            }
          } catch (err: any) {
            showError("File upload error. Entry will be saved without ID document.", err?.message || "Network error");
          }
        }
        if (links.length > 0) entry[14] = links.join(" | ");
      }

      if (newVisaFiles.length > 0) {
        const links: string[] = [];
        for (const file of newVisaFiles) {
          const fd = new FormData();
          fd.append("file", file); fd.append("name", entry[3] || "Guest"); fd.append("type", "visa"); fd.append("password", password);
          try {
            const uploadRes = await fetch("/api/admin/upload", { method: "POST", body: fd });
            if (uploadRes.ok) {
              const data = await uploadRes.json();
              if (data.link) links.push(data.link);
            } else {
              const errText = await uploadRes.text();
              showError("Visa upload failed. Entry was not saved because a visa document is required.", errText);
            }
          } catch (err: any) {
            showError("Visa upload error. Entry was not saved because a visa document is required.", err?.message || "Network error");
          }
        }
        if (links.length > 0) entry[15] = links.join(" | ");
      }

      const isForeigner = isForeignNationality(entry[8]);
      const formCData = isForeigner ? JSON.stringify(newFormCFields) : undefined;
      const res = await apiCall({ action: "add", entry, formCData, bookingPlatform: newBookingPlatform, bookingId: newBookingId, dob: newDob });
      if (res.ok) { setShowAddForm(false); setNewEntry(getDefaults()); setNewFirstName(""); setNewLastName(""); setNewIdFiles([]); setNewVisaFiles([]); setNewFormCFields({}); setNewBookingPlatform(""); setNewBookingId(""); setNewDob(""); refresh(); }
    } finally { setLoading(false); }
  };

  const addPastEntry = async () => {
    if (!pastFirstName.trim() || !pastLastName.trim()) { showError("First name and last name are required"); return; }
    pastEntry[3] = `${pastFirstName.trim()} ${pastLastName.trim()}`;
    if (!pastEntry[1]) { showError("Arrival date is required for past records"); return; }
    if (pastCheckoutDate && pastCheckoutDate < pastEntry[1]) { showError("Checkout date must be on or after arrival date"); return; }
    if (isForeignNationality(pastEntry[8]) && pastVisaFiles.length === 0) { showError("Visa document is required for foreign nationals"); return; }
    setLoading(true);
    try {
      const entry = [...pastEntry]; entry[0] = new Date().toISOString();
      if (isForeignNationality(entry[8])) entry[13] = "passport";

      if (pastIdFiles.length > 0) {
        const links: string[] = [];
        for (const file of pastIdFiles) {
          const fd = new FormData();
          fd.append("file", file); fd.append("name", entry[3] || "Guest"); fd.append("type", "id"); fd.append("password", password);
          try {
            const uploadRes = await fetch("/api/admin/upload", { method: "POST", body: fd });
            if (uploadRes.ok) {
              const data = await uploadRes.json();
              if (data.link) links.push(data.link);
            } else {
              const errText = await uploadRes.text();
              showError("File upload failed. Entry will be saved without ID document.", errText);
            }
          } catch (err: any) {
            showError("File upload error. Entry will be saved without ID document.", err?.message || "Network error");
          }
        }
        if (links.length > 0) entry[14] = links.join(" | ");
      }

      if (pastVisaFiles.length > 0) {
        const links: string[] = [];
        for (const file of pastVisaFiles) {
          const fd = new FormData();
          fd.append("file", file); fd.append("name", entry[3] || "Guest"); fd.append("type", "visa"); fd.append("password", password);
          try {
            const uploadRes = await fetch("/api/admin/upload", { method: "POST", body: fd });
            if (uploadRes.ok) {
              const data = await uploadRes.json();
              if (data.link) links.push(data.link);
            } else {
              const errText = await uploadRes.text();
              showError("Visa upload failed. Entry was not saved because a visa document is required.", errText);
            }
          } catch (err: any) {
            showError("Visa upload error. Entry was not saved because a visa document is required.", err?.message || "Network error");
          }
        }
        if (links.length > 0) entry[15] = links.join(" | ");
      }

      const isForeigner = isForeignNationality(entry[8]);
      const formCData = isForeigner ? JSON.stringify(pastFormCFields) : undefined;
      const res = await apiCall({ action: "addPast", entry, checkoutDate: pastCheckoutDate, formCData, bookingPlatform: pastBookingPlatform, bookingId: pastBookingId, dob: pastDob });
      if (res.ok) { setShowPastForm(false); setPastEntry(getDefaults()); setPastFirstName(""); setPastLastName(""); setPastIdFiles([]); setPastVisaFiles([]); setPastCheckoutDate(""); setPastFormCFields({}); setPastBookingPlatform(""); setPastBookingId(""); setPastDob(""); refresh(); }
      else { const errData = await res.json().catch(() => ({})); showError("Failed to save past record", errData.error); }
    } finally { setLoading(false); }
  };

  const handleVibeMatch = async (checkinId: number, origIdx: number) => {
    setVibeMatchingId(checkinId);
    try {
      const res = await apiCall({ action: "markVibeMatched", checkinId });
      if (res.ok) {
        setRows((prev) => prev.map((r, i) => i === origIdx ? [...r.slice(0, 21), "1", r[22] || ""] : r));
      }
    } finally { setVibeMatchingId(null); }
  };

  const undoCheckout = async (origIdx: number) => {
    if (!confirm("Re-activate this guest? They will appear in the 'unassigned beds' list.")) return;
    setLoading(true);
    try {
      const checkinId = parseInt(rows[origIdx][17] || "0", 10);
      const res = await apiCall({ action: "undoCheckout", checkinId });
      if (res.ok) refresh();
      else { const d = await res.json(); showError("Failed", d.error); }
    } finally { setLoading(false); }
  };

  const verifyManually = async (origIdx: number, verified: boolean) => {
    setVerifying(true);
    try {
      const rowId = parseInt(rows[origIdx][17] || "0", 10);
      const res = await apiCall({ action: "verifyCheckin", rowId, verified });
      if (res.ok) { setVerifyPopup(null); refresh(); }
    } finally { setVerifying(false); }
  };

  const handleInlineUpload = async () => {
    if (!uploadPopup || uploadFiles.length === 0) return;
    if (uploadPopup.type === "id" && !uploadIdType) { showError("Please select ID type"); return; }
    setUploading(true);
    try {
      const links: string[] = [];
      for (const file of uploadFiles) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("name", uploadPopup.guestName || "Guest");
        fd.append("type", uploadPopup.type);
        fd.append("password", password);
        const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
        if (res.ok) {
          const data = await res.json();
          if (data.link) links.push(data.link);
        } else {
          const errText = await res.text();
          showError("Upload failed", `${res.status}: ${errText}`);
        }
      }
      if (links.length > 0) {
        const updated = Array(17).fill("").map((_, i) => rows[uploadPopup.origIdx][i] || "");
        if (uploadPopup.type === "id") {
          updated[14] = links.join(" | ");
          if (uploadIdType) updated[13] = uploadIdType;
        } else {
          updated[15] = links.join(" | ");
        }
        const rowId = parseInt(rows[uploadPopup.origIdx][17] || "0", 10);
        const updateRes = await apiCall({ action: "update", rowId, entry: updated, tab: currentTab });
        if (!updateRes.ok) {
          const errData = await updateRes.json();
          showError("Record update failed", errData.error || "Unknown error");
        }
      } else if (uploadFiles.length > 0) {
        showError("All file uploads failed. Please try again.");
      }
      setUploadPopup(null);
      setUploadFiles([]);
      setUploadIdType("");
      refresh();
    } finally { setUploading(false); }
  };

  const openFormC = async (origIdx: number, row: string[]) => {
    setFormCLoading(true);
    setFrroStatus("");
    setFormCEditing(false);
    try {
      const rowId = parseInt(row[17] || "0", 10);
      const res = await apiCall({ action: "getFormCData", rowId });
      if (res.ok) {
        const d = await res.json();
        setFormCPopup({ origIdx, row, data: d.formCData ? JSON.parse(d.formCData) : {} });
      } else {
        setFormCPopup({ origIdx, row, data: {} });
      }
      const userRes = await apiCall({ action: "getSetting", key: "frro_username" });
      if (userRes.ok) { const ud = await userRes.json(); setFrroUsername(ud.value || ""); }
      const passRes = await apiCall({ action: "getSetting", key: "frro_password" });
      if (passRes.ok) { const pd = await passRes.json(); setFrroPassword(pd.value || ""); }
    } catch {
      setFormCPopup({ origIdx, row, data: {} });
    } finally {
      setFormCLoading(false);
    }
  };

  const removeFormCSubmission = async (index: number) => {
    const submissions = formCSubmissions(formCPopup?.data || {});
    const submission = submissions[index];
    if (!formCPopup || !submission || !confirm(`Delete incorrect FRRO submission ${submission.id}? This removes it from Goko history only.`)) return;
    setFrroDeleting(index);
    try {
      const rowId = parseInt(formCPopup.row[17] || "0", 10);
      const res = await apiCall({ action: "removeFormCSubmission", rowId, submissionIndex: index });
      if (!res.ok) {
        showError("Could not delete submission", "The FRRO history was not changed.");
        return;
      }
      const data = await res.json();
      setFormCPopup({ ...formCPopup, data: data.formCData ? JSON.parse(data.formCData) : formCPopup.data });
      showSuccess("Incorrect FRRO submission removed from Goko history");
    } finally {
      setFrroDeleting(null);
    }
  };

  if (loading && rows.length === 0) {
    return <AdminLoading message="Loading records..." />;
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-xl font-bold text-brand-green md:text-2xl">Check-in Records</h2>
        <div className="flex flex-wrap gap-2">
          {hasPermission(role, permissions, "canAddCheckin") && (
            <Button type="button" variant="ctaOutline" onClick={() => { setShowAddForm(true); setShowPastForm(false); }} disabled={loading}>
              <PlusIcon className="mr-1 h-4 w-4" /> Add
            </Button>
          )}
          {hasPermission(role, permissions, "canAddCheckin") && (
            <Button type="button" variant="ctaOutline" onClick={() => { setShowPastForm(true); setShowAddForm(false); }} disabled={loading}>
              <PlusIcon className="mr-1 h-4 w-4" /> Past
            </Button>
          )}
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
              className={cn("relative rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                tab === currentTab ? "text-white" : "bg-white dark:bg-card text-brand-green-dark/70 hover:bg-brand-green/[0.06]"
              )}>
              {tab === currentTab && (
                <motion.span layoutId="records-month-pill" className="absolute inset-0 rounded-full bg-brand-green" transition={{ type: "spring", stiffness: 400, damping: 30 }} />
              )}
              <span className="relative z-10">{tab}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search and filters */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="max-w-xs" />
          <select value={sortField || ""} onChange={(e) => setSortField(e.target.value ? e.target.value as any : null)} className="rounded-md border border-input bg-background px-3 py-2 text-xs">
            <option value="">Sort by...</option>
            <option value="date">Date</option>
            <option value="place">Coming from</option>
          </select>
          {sortField && <button type="button" onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} className="rounded-md border border-input bg-background px-2 py-2 text-xs">{sortDir === "asc" ? "A-Z" : "Z-A"}</button>}
          {hasActiveFilters && <button type="button" onClick={clearFilters} className="rounded-md bg-brand-red/10 px-3 py-2 text-xs font-medium text-brand-red hover:bg-brand-red/20">Clear</button>}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-brand-green-dark/70">{filteredRows.length}{filteredRows.length !== rows.length ? ` of ${rows.length}` : ""} records</p>
          <div className="flex rounded-lg border border-brand-mist bg-white dark:bg-card p-0.5">
            <button type="button" onClick={() => setViewMode("card")} className={cn("relative rounded-md p-1.5 transition-colors", viewMode === "card" ? "text-white" : "text-brand-green-dark/50 hover:bg-brand-sand")} title="Card view">
              {viewMode === "card" && <motion.span layoutId="records-view-pill" className="absolute inset-0 rounded-md bg-brand-green" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
              <LayoutListIcon className="relative z-10 h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setViewMode("table")} className={cn("relative rounded-md p-1.5 transition-colors", viewMode === "table" ? "text-white" : "text-brand-green-dark/50 hover:bg-brand-sand")} title="Table view">
              {viewMode === "table" && <motion.span layoutId="records-view-pill" className="absolute inset-0 rounded-md bg-brand-green" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
              <TableIcon className="relative z-10 h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Add entry form */}
      <AnimatePresence>
      {showAddForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: [0.33, 1, 0.68, 1] }} className="overflow-hidden">
        <div className="mt-4 rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 sm:p-6 shadow-card dark:shadow-none">
          <h3 className="font-display text-lg font-bold text-brand-green">Add manual entry</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {TEXT_FIELDS.map((field) => (
              field.type === "name_split" ? (
                <div key={field.index} className="sm:col-span-2 md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">First Name</Label>
                    <Input value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} placeholder="First name" className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Last Name</Label>
                    <Input value={newLastName} onChange={(e) => setNewLastName(e.target.value)} placeholder="Last name" className="mt-1" />
                  </div>
                </div>
              ) : (
              <div key={field.index}>
                <Label className="text-xs">{field.label}</Label>
                {field.type === "select" ? (
                  <select value={newEntry[field.index]} onChange={(e) => { const u = [...newEntry]; u[field.index] = e.target.value; if (field.index === 8) { if (isForeignNationality(e.target.value)) u[13] = "passport"; else setNewVisaFiles([]); } setNewEntry(u); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">Select...</option>
                    {(field.index === 13 ? getIdTypeOptions(newEntry[8]) : field.options!).map((opt) => <option key={opt} value={opt}>{opt.replace("_", " ")}</option>)}
                  </select>
                ) : field.type === "country" ? (
                  <select value={newEntry[field.index]} onChange={(e) => { const u = [...newEntry]; u[field.index] = e.target.value; if (field.index === 8) { if (isForeignNationality(e.target.value)) u[13] = "passport"; else setNewVisaFiles([]); } setNewEntry(u); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <Input type={field.type} value={newEntry[field.index]} onChange={(e) => { const u = [...newEntry]; u[field.index] = e.target.value; setNewEntry(u); }} placeholder={field.label} className="mt-1" />
                )}
              </div>
              )
            ))}
            <div className="sm:col-span-2 md:col-span-3 rounded-lg border border-brand-mist bg-brand-sand/20 p-3">
              <p className="mb-2 text-xs font-semibold text-brand-green-dark">Booking details</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Booking Platform</Label>
                  <select value={newBookingPlatform} onChange={(e) => { setNewBookingPlatform(e.target.value); if (e.target.value === "Offline booking" || e.target.value === "Walk-in") setNewBookingId(""); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">Select...</option>
                    {BOOKING_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                {newBookingPlatform && newBookingPlatform !== "Offline booking" && newBookingPlatform !== "Walk-in" && (
                  <div>
                    <Label className="text-xs">Booking ID</Label>
                    <Input value={newBookingId} onChange={(e) => setNewBookingId(e.target.value)} placeholder="e.g. 4829173650" className="mt-1" />
                  </div>
                )}
                {(newBookingPlatform === "Offline booking" || newBookingPlatform === "Walk-in") && (
                  <div className="flex items-end">
                    <p className="pb-2 text-xs text-brand-green-dark/50">Booking ID will be auto-generated</p>
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs">Date of Birth</Label>
              <Input type="date" value={newDob} onChange={(e) => setNewDob(e.target.value)} className="mt-1" />
            </div>
            {isForeignNationality(newEntry[8]) && (
              <div className="sm:col-span-2 md:col-span-3 rounded-lg border border-blue-100 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/30 p-3">
                <p className="mb-2 text-xs font-semibold text-blue-800 dark:text-blue-300">Form C fields (foreign guest)</p>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {FORM_C_FIELDS.map((f) => (
                    <div key={f.key}>
                      <Label className="text-xs">{f.label}</Label>
                      {f.type === "select" ? (
                        <select value={newFormCFields[f.key] || ""} onChange={(e) => setNewFormCFields((p) => ({ ...p, [f.key]: e.target.value }))} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                          <option value="">Select...</option>
                          {f.options!.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : f.type === "country" ? (
                        <select value={newFormCFields[f.key] || ""} onChange={(e) => setNewFormCFields((p) => ({ ...p, [f.key]: e.target.value }))} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                          <option value="">Select...</option>
                          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <Input type={f.type} value={newFormCFields[f.key] || ""} onChange={(e) => setNewFormCFields((p) => ({ ...p, [f.key]: e.target.value }))} placeholder={f.label} className="mt-1" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isForeignNationality(newEntry[8]) && (
              <div className="sm:col-span-2 md:col-span-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/30 p-3">
                <Label className="text-xs">Visa document photo(s) <span className="text-brand-red">*</span></Label>
                <p className="mt-1 text-[10px] text-amber-800/70 dark:text-amber-300/70">Required for non-Indian guests. Upload the visa page(s).</p>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-brand-sand/50">
                  <UploadIcon className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                  {newVisaFiles.length === 0 ? "Choose visa files" : `${newVisaFiles.length} visa file(s)`}
                  <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => { if (e.target.files) setNewVisaFiles(Array.from(e.target.files)); }} />
                </label>
                {newVisaFiles.length > 0 && <button type="button" onClick={() => setNewVisaFiles([])} className="ml-2 text-xs text-brand-red hover:underline">Remove</button>}
              </div>
            )}
            <div className="sm:col-span-2 md:col-span-3">
              <Label className="text-xs">ID Card photos</Label>
              {newIdFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {newIdFiles.map((file, i) => (
                    <div key={i} className="relative">
                      {file.type === "application/pdf" ? (
                        <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-brand-mist bg-brand-sand/30 text-xs font-medium text-brand-green-dark/60">PDF</div>
                      ) : (
                        <img src={URL.createObjectURL(file)} alt={`ID ${i + 1}`} className="h-20 w-20 rounded-lg border border-brand-mist object-cover" />
                      )}
                      <button type="button" onClick={() => setNewIdFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm dark:shadow-none hover:bg-red-600">
                        <XIcon className="h-3 w-3" />
                      </button>
                      <p className="mt-1 max-w-[80px] truncate text-center text-[10px] text-brand-green-dark/50">{i === 0 ? "Front" : i === 1 ? "Back" : `Page ${i + 1}`}</p>
                    </div>
                  ))}
                </div>
              )}
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-brand-sand/50">
                <UploadIcon className="h-4 w-4 text-brand-green" />
                {newIdFiles.length === 0 ? "Choose files" : "Add more photos"}
                <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => { if (e.target.files) setNewIdFiles((prev) => [...prev, ...Array.from(e.target.files!)]); }} />
              </label>
              {newIdFiles.length > 0 && (
                <p className="mt-1 text-[10px] text-brand-green-dark/50">{newIdFiles.length} file(s) — upload front & back of ID</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={addEntry} disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
          </div>
        </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Past check-in form */}
      <AnimatePresence>
      {showPastForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: [0.33, 1, 0.68, 1] }} className="overflow-hidden">
        <div className="mt-4 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/30 p-4 sm:p-6 shadow-card dark:shadow-none">
          <h3 className="font-display text-lg font-bold text-amber-800 dark:text-amber-300">Add past check-in record</h3>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">This record is for archival purposes only — no bed assignment needed.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {TEXT_FIELDS.map((field) => (
              field.type === "name_split" ? (
                <div key={field.index} className="sm:col-span-2 md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">First Name</Label>
                    <Input value={pastFirstName} onChange={(e) => setPastFirstName(e.target.value)} placeholder="First name" className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Last Name</Label>
                    <Input value={pastLastName} onChange={(e) => setPastLastName(e.target.value)} placeholder="Last name" className="mt-1" />
                  </div>
                </div>
              ) : (
              <div key={field.index}>
                <Label className="text-xs">{field.label}</Label>
                {field.type === "select" ? (
                  <select value={pastEntry[field.index]} onChange={(e) => { const u = [...pastEntry]; u[field.index] = e.target.value; if (field.index === 8) { if (isForeignNationality(e.target.value)) u[13] = "passport"; else setPastVisaFiles([]); } setPastEntry(u); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">Select...</option>
                    {(field.index === 13 ? getIdTypeOptions(pastEntry[8]) : field.options!).map((opt) => <option key={opt} value={opt}>{opt.replace("_", " ")}</option>)}
                  </select>
                ) : field.type === "country" ? (
                  <select value={pastEntry[field.index]} onChange={(e) => { const u = [...pastEntry]; u[field.index] = e.target.value; if (field.index === 8) { if (isForeignNationality(e.target.value)) u[13] = "passport"; else setPastVisaFiles([]); } setPastEntry(u); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <Input type={field.type} value={pastEntry[field.index]} onChange={(e) => { const u = [...pastEntry]; u[field.index] = e.target.value; setPastEntry(u); }} placeholder={field.label} className="mt-1" />
                )}
              </div>
              )
            ))}
            <div>
              <Label className="text-xs">Checkout Date</Label>
              <Input type="date" value={pastCheckoutDate} onChange={(e) => setPastCheckoutDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Date of Birth</Label>
              <Input type="date" value={pastDob} onChange={(e) => setPastDob(e.target.value)} className="mt-1" />
            </div>
            <div className="sm:col-span-2 md:col-span-3 rounded-lg border border-brand-mist bg-brand-sand/20 p-3">
              <p className="mb-2 text-xs font-semibold text-brand-green-dark">Booking details</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Booking Platform</Label>
                  <select value={pastBookingPlatform} onChange={(e) => { setPastBookingPlatform(e.target.value); if (e.target.value === "Offline booking" || e.target.value === "Walk-in") setPastBookingId(""); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">Select...</option>
                    {BOOKING_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                {pastBookingPlatform && pastBookingPlatform !== "Offline booking" && pastBookingPlatform !== "Walk-in" && (
                  <div>
                    <Label className="text-xs">Booking ID</Label>
                    <Input value={pastBookingId} onChange={(e) => setPastBookingId(e.target.value)} placeholder="e.g. 4829173650" className="mt-1" />
                  </div>
                )}
                {(pastBookingPlatform === "Offline booking" || pastBookingPlatform === "Walk-in") && (
                  <div className="flex items-end">
                    <p className="pb-2 text-xs text-brand-green-dark/50">Booking ID will be auto-generated</p>
                  </div>
                )}
              </div>
            </div>
            {isForeignNationality(pastEntry[8]) && (
              <div className="sm:col-span-2 md:col-span-3 rounded-lg border border-blue-100 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/30 p-3">
                <p className="mb-2 text-xs font-semibold text-blue-800 dark:text-blue-300">Form C fields (foreign guest)</p>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {FORM_C_FIELDS.map((f) => (
                    <div key={f.key}>
                      <Label className="text-xs">{f.label}</Label>
                      {f.type === "select" ? (
                        <select value={pastFormCFields[f.key] || ""} onChange={(e) => setPastFormCFields((p) => ({ ...p, [f.key]: e.target.value }))} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                          <option value="">Select...</option>
                          {f.options!.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : f.type === "country" ? (
                        <select value={pastFormCFields[f.key] || ""} onChange={(e) => setPastFormCFields((p) => ({ ...p, [f.key]: e.target.value }))} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                          <option value="">Select...</option>
                          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : (
                        <Input type={f.type} value={pastFormCFields[f.key] || ""} onChange={(e) => setPastFormCFields((p) => ({ ...p, [f.key]: e.target.value }))} placeholder={f.label} className="mt-1" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isForeignNationality(pastEntry[8]) && (
              <div className="sm:col-span-2 md:col-span-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/30 p-3">
                <Label className="text-xs">Visa document photo(s) <span className="text-brand-red">*</span></Label>
                <p className="mt-1 text-[10px] text-amber-800/70 dark:text-amber-300/70">Required for non-Indian guests. Upload the visa page(s).</p>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-brand-sand/50">
                  <UploadIcon className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                  {pastVisaFiles.length === 0 ? "Choose visa files" : `${pastVisaFiles.length} visa file(s)`}
                  <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => { if (e.target.files) setPastVisaFiles(Array.from(e.target.files)); }} />
                </label>
                {pastVisaFiles.length > 0 && <button type="button" onClick={() => setPastVisaFiles([])} className="ml-2 text-xs text-brand-red hover:underline">Remove</button>}
              </div>
            )}
            <div className="sm:col-span-2 md:col-span-3">
              <Label className="text-xs">ID Card photos</Label>
              {pastIdFiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {pastIdFiles.map((file, i) => (
                    <div key={i} className="relative">
                      {file.type === "application/pdf" ? (
                        <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-brand-mist bg-brand-sand/30 text-xs font-medium text-brand-green-dark/60">PDF</div>
                      ) : (
                        <img src={URL.createObjectURL(file)} alt={`ID ${i + 1}`} className="h-20 w-20 rounded-lg border border-brand-mist object-cover" />
                      )}
                      <button type="button" onClick={() => setPastIdFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm dark:shadow-none hover:bg-red-600">
                        <XIcon className="h-3 w-3" />
                      </button>
                      <p className="mt-1 max-w-[80px] truncate text-center text-[10px] text-brand-green-dark/50">{i === 0 ? "Front" : i === 1 ? "Back" : `Page ${i + 1}`}</p>
                    </div>
                  ))}
                </div>
              )}
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-brand-sand/50">
                <UploadIcon className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                {pastIdFiles.length === 0 ? "Choose files" : "Add more photos"}
                <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => { if (e.target.files) setPastIdFiles((prev) => [...prev, ...Array.from(e.target.files!)]); }} />
              </label>
              {pastIdFiles.length > 0 && (
                <p className="mt-1 text-[10px] text-brand-green-dark/50">{pastIdFiles.length} file(s) — upload front & back of ID</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={addPastEntry} disabled={loading}>{loading ? "Saving..." : "Save Past Record"}</Button>
            <Button type="button" variant="ghost" onClick={() => setShowPastForm(false)}>Cancel</Button>
          </div>
        </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Edit form */}
      {editIndex !== null && (
        <div ref={editFormRef} className="mt-4 rounded-2xl border-2 border-brand-green/20 bg-white dark:bg-card p-4 sm:p-6 shadow-card dark:shadow-none">
          <h3 className="font-display text-lg font-bold text-brand-green">Edit entry</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {CHECKIN_COLUMNS.map((col, i) => (
              i === 0 ? null : col === "Name" ? (
                <div key={col} className="sm:col-span-2 md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">First Name</Label>
                    <Input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} placeholder="First name" className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Last Name</Label>
                    <Input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} placeholder="Last name" className="mt-1" />
                  </div>
                </div>
              ) : (
              <div key={col}>
                <Label className="text-xs">{col}</Label>
                {col === "ID Type" ? (
                  <select value={editEntry[i]} onChange={(e) => { const u = [...editEntry]; u[i] = e.target.value; setEditEntry(u); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {!isForeignNationality(editEntry[8]) && <option value="">Select...</option>}
                    {getIdTypeOptions(editEntry[8]).map((opt) => <option key={opt} value={opt}>{opt.replace("_", " ")}</option>)}
                  </select>
                ) : col === "Nationality" ? (
                  <select value={editEntry[i]} onChange={(e) => { const u = [...editEntry]; u[i] = e.target.value; if (isForeignNationality(e.target.value)) u[13] = "passport"; setEditEntry(u); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {countries.map((country) => <option key={country} value={country}>{country}</option>)}
                  </select>
                ) : col === "ID Card" || col === "Visa" ? (
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
              )
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={updateRow} disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
            <Button type="button" variant="ghost" onClick={() => setEditIndex(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Card View */}
      {viewMode === "card" && (
        <div className="mt-6 space-y-2">
          {filteredRows.length === 0 ? (
            <p className="py-12 text-center text-brand-green-dark/50">{rows.length === 0 ? "No records" : "No matches"}</p>
          ) : (
            filteredRows.map(({ row, origIdx }) => {
              const isExpanded = expandedCard === origIdx;
              const guestDob = row[20] || "";
              const guestDobFromId = row[22] || "";
              const guestAge = getAgeFromDob(resolveDobForChecks(guestDob, guestDobFromId) || "");
              const guestVibeMatched = row[21] === "1";
              const guestFlagged = guestAge !== null && !guestVibeMatched && (guestAge < ageRange.min || guestAge > ageRange.max);
              const guestUnderage = guestAge !== null && guestAge < ageRange.min;
              const guestDobMismatch = !!(guestDob && guestDobFromId && !guestVibeMatched && !dobsMatch(guestDob, guestDobFromId));
              const guestAnyFlag = guestFlagged || guestDobMismatch;
              const verified = row[16] || "";
              const checkinId = parseInt(row[17] || "0", 10);
              const idLinks = (row[14] || "").includes(" | ") ? (row[14] || "").split(" | ").filter((u: string) => u.startsWith("http")) : (row[14] || "").startsWith("http") ? [row[14]] : [];
              const visaLinks = (row[15] || "").includes(" | ") ? (row[15] || "").split(" | ").filter((u: string) => u.startsWith("http")) : (row[15] || "").startsWith("http") ? [row[15]] : [];

              return (
                <div key={origIdx} data-record-id={row[17] || origIdx} className={cn("rounded-xl border border-brand-mist bg-white dark:bg-card shadow-sm dark:shadow-none transition-all duration-200 hover:shadow-soft dark:hover:shadow-none", guestAnyFlag && "border-orange-200 dark:border-orange-800 bg-orange-50/30 dark:bg-orange-950/30")}>
                  {/* Collapsed — always visible */}
                  <button
                    type="button"
                    onClick={() => setExpandedCard(isExpanded ? null : origIdx)}
                    className="flex w-full items-start justify-between gap-2 p-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-brand-green-dark">{row[3] || "—"}</span>
                        {verified === "yes" ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-green-700 dark:text-green-400"><ShieldCheckIcon className="h-2.5 w-2.5" />Verified</span>
                        ) : verified === "no" ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 dark:bg-red-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-red-700 dark:text-red-400"><ShieldAlertIcon className="h-2.5 w-2.5" />Rejected</span>
                        ) : verified === "spoof_warning" ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-400"><ShieldAlertIcon className="h-2.5 w-2.5" />Spoof</span>
                        ) : verified === "pending" ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-yellow-700 dark:text-yellow-400"><ShieldAlertIcon className="h-2.5 w-2.5" />Pending</span>
                        ) : null}
                        {guestFlagged && <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", guestUnderage ? "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400" : "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400")}>{guestUnderage ? `Underage (${guestAge})` : `Overage (${guestAge})`}</span>}
                        {guestDobMismatch && <span className="rounded-full bg-red-100 dark:bg-red-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-red-700 dark:text-red-400">DOB mismatch</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-green-dark/60">
                        <span className="flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{row[1] || "—"} {row[2] || ""}</span>
                        <span className="flex items-center gap-1"><PhoneIcon className="h-3 w-3" />{row[5] || "—"}</span>
                        <span className="flex items-center gap-1"><MapPinIcon className="h-3 w-3" />{row[7] || "—"}</span>
                      </div>
                    </div>
                    <ChevronDownIcon className={cn("h-4 w-4 shrink-0 text-brand-green-dark/40 transition-transform mt-1", isExpanded && "rotate-180")} />
                  </button>

                  {/* Expanded — details + actions */}
                  {isExpanded && (
                    <div className="border-t border-brand-mist px-3 pb-3 pt-2">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <div><span className="text-brand-green-dark/50">Persons:</span> <span className="text-brand-green-dark">{row[4] || "—"}</span></div>
                        <div><span className="text-brand-green-dark/50">Days:</span> <span className="text-brand-green-dark">{row[6] || "—"}</span></div>
                        <div><span className="text-brand-green-dark/50">Nationality:</span> <span className="text-brand-green-dark">{row[8] || "—"}</span></div>
                        <div><span className="text-brand-green-dark/50">ID Type:</span> <span className="text-brand-green-dark">{row[13] || "—"}</span></div>
                        <div><span className="text-brand-green-dark/50">Platform:</span> <span className="text-brand-green-dark">{row[11] || "—"}</span></div>
                        <div><span className="text-brand-green-dark/50">Booking ID:</span> <span className="text-brand-green-dark">{row[12] || "—"}</span></div>
                        <div><span className="text-brand-green-dark/50">Emergency:</span> <span className="text-brand-green-dark">{row[9] || "—"}</span></div>
                        <div><span className="text-brand-green-dark/50">Emerg. Ph:</span> <span className="text-brand-green-dark">{row[10] || "—"}</span></div>
                      </div>

                      {/* Document links */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {idLinks.length > 0 ? idLinks.map((url: string, li: number) => (
                          <a key={`id-${li}`} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-brand-green/[0.06] px-2 py-1 text-[10px] font-medium text-brand-green hover:bg-brand-green/[0.12]">
                            ID {idLinks.length > 1 ? (li === 0 ? "Front" : "Back") : "Card"} <ExternalLinkIcon className="h-2.5 w-2.5" />
                          </a>
                        )) : hasPermission(role, permissions, "canEditRecords") ? (
                          <button type="button" onClick={() => openUploadPopup(origIdx, "id", row[3] || "Guest", row[8] || "")} className="inline-flex items-center gap-1 rounded-md bg-brand-green/[0.06] px-2 py-1 text-[10px] font-medium text-brand-green hover:bg-brand-green/[0.12]">
                            <UploadIcon className="h-2.5 w-2.5" /> Upload ID
                          </button>
                        ) : null}
                        {visaLinks.length > 0 ? visaLinks.map((url: string, li: number) => (
                          <a key={`visa-${li}`} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50">
                            Visa {visaLinks.length > 1 ? `#${li + 1}` : ""} <ExternalLinkIcon className="h-2.5 w-2.5" />
                          </a>
                        )) : isForeignNationality(row[8]) && hasPermission(role, permissions, "canEditRecords") ? (
                          <button type="button" onClick={() => openUploadPopup(origIdx, "visa", row[3] || "Guest", row[8] || "")} className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50">
                            <UploadIcon className="h-2.5 w-2.5" /> Upload Visa
                          </button>
                        ) : null}
                      </div>

                      {/* Actions */}
                      {(hasPermission(role, permissions, "canEditRecords") || hasPermission(role, permissions, "canDeleteRecords")) && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-brand-mist pt-2">
                          {isForeignNationality(row[8]) && hasPermission(role, permissions, "canEditRecords") && (
                            <button type="button" onClick={() => openFormC(origIdx, row)} className="flex items-center gap-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 px-2 py-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50">
                              <FileTextIcon className="h-3 w-3" /> Form C
                            </button>
                          )}
                          {row[18] === "checked_out" && row[19] && (Date.now() - new Date(row[19]).getTime() < 24 * 60 * 60 * 1000) && hasPermission(role, permissions, "canEditRecords") && (
                            <button type="button" onClick={() => undoCheckout(origIdx)} className="flex items-center gap-1 rounded-lg bg-blue-50 dark:bg-blue-950 px-2 py-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50">Reactivate</button>
                          )}
                          {hasPermission(role, permissions, "canEditRecords") && (
                            <button type="button" onClick={() => startEdit(origIdx)} className="flex items-center gap-1 rounded-lg bg-brand-sand px-2 py-1 text-[10px] font-medium text-brand-green-dark/70 hover:bg-brand-green/10">
                              <PencilIcon className="h-3 w-3" /> Edit
                            </button>
                          )}
                          {hasPermission(role, permissions, "canDeleteRecords") && (
                            <button type="button" onClick={() => deleteRow(origIdx)} className="flex items-center gap-1 rounded-lg bg-red-50 dark:bg-red-950 px-2 py-1 text-[10px] font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50">
                              <Trash2Icon className="h-3 w-3" /> Delete
                            </button>
                          )}
                          {(verified === "pending" || verified === "spoof_warning") && (
                            <button type="button" onClick={() => setVerifyPopup({ origIdx, row })} className="flex items-center gap-1 rounded-lg bg-yellow-50 dark:bg-yellow-950 px-2 py-1 text-[10px] font-medium text-yellow-700 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/50">
                              <ShieldAlertIcon className="h-3 w-3" /> Verify
                            </button>
                          )}
                          {guestAnyFlag && (
                            <button type="button" onClick={() => handleVibeMatch(checkinId, origIdx)} disabled={vibeMatchingId === checkinId} className="rounded-lg bg-orange-50 dark:bg-orange-950 px-2 py-1 text-[10px] font-medium text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900/50 disabled:opacity-50">
                              {vibeMatchingId === checkinId ? "..." : "Vibe?"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Table */}
      {viewMode === "table" && <div className="mt-6 overflow-x-auto rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-card dark:shadow-none">
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr className="border-b border-brand-mist bg-brand-sand/50">
              {CHECKIN_COLUMNS.map((col, ci) => ci === 0 ? null : (
                <th key={col} className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">{col}</th>
              ))}
              {(hasPermission(role, permissions, "canEditRecords") || hasPermission(role, permissions, "canDeleteRecords")) && <th className="px-3 py-3 text-xs font-bold uppercase">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr><td colSpan={CHECKIN_COLUMNS.length} className="px-4 py-12 text-center text-brand-green-dark/50">{rows.length === 0 ? "No records" : "No matches"}</td></tr>
            ) : (
              filteredRows.map(({ row, origIdx }) => {
                const guestDob = row[20] || "";
                const guestDobFromId = row[22] || "";
                const guestAge = getAgeFromDob(resolveDobForChecks(guestDob, guestDobFromId) || "");
                const guestVibeMatched = row[21] === "1";
                const guestFlagged = guestAge !== null && !guestVibeMatched && (guestAge < ageRange.min || guestAge > ageRange.max);
                const guestUnderage = guestAge !== null && guestAge < ageRange.min;
                const guestDobMismatch = !!(guestDob && guestDobFromId && !guestVibeMatched && !dobsMatch(guestDob, guestDobFromId));
                const guestAnyFlag = guestFlagged || guestDobMismatch;
                return (
                <tr key={origIdx} data-record-id={row[17] || origIdx} className={cn("border-b border-brand-mist/60 last:border-b-0 transition-colors duration-150 hover:bg-brand-sand/40", guestAnyFlag && "bg-orange-50/40 dark:bg-orange-950/40")}>
                  {CHECKIN_COLUMNS.map((col, ci) => {
                    if (ci === 0) return null;
                    const cell = row[ci] || "";
                    const links = cell.includes(" | ") ? cell.split(" | ").filter((u) => u.startsWith("http")) : cell.startsWith("http") ? [cell] : [];

                    if (col === "Name") {
                      return (
                        <td key={ci} className="whitespace-nowrap px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-brand-green-dark/90">{cell}</span>
                            {showDobInRecords && guestDob && (
                              <span className="text-[10px] text-brand-green-dark/40">DOB: {guestDob}</span>
                            )}
                            {guestFlagged && (
                              <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", guestUnderage ? "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400" : "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400")}>
                                {guestUnderage ? `Underage (${guestAge})` : `Overage (${guestAge})`}
                              </span>
                            )}
                            {guestDobMismatch && (
                              <span className="rounded-full bg-red-100 dark:bg-red-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-red-700 dark:text-red-400">DOB mismatch</span>
                            )}
                          </div>
                        </td>
                      );
                    }

                    if (col === "Verified") {
                      const checkinId = parseInt(row[17] || "0", 10);
                      return (
                        <td key={ci} className="whitespace-nowrap px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {cell === "yes" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/50 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                                <ShieldCheckIcon className="h-3 w-3" /> Verified
                              </span>
                            ) : cell === "no" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/50 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                                <ShieldAlertIcon className="h-3 w-3" /> Rejected
                              </span>
                            ) : cell === "spoof_warning" ? (
                              <button type="button" onClick={() => setVerifyPopup({ origIdx, row })}
                                className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-800">
                                <ShieldAlertIcon className="h-3 w-3" /> Possibly fake
                              </button>
                            ) : (
                              <button type="button" onClick={() => setVerifyPopup({ origIdx, row })}
                                className="inline-flex items-center gap-1 rounded-full bg-yellow-100 dark:bg-yellow-900/50 px-2 py-0.5 text-[10px] font-semibold text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-800">
                                <ShieldAlertIcon className="h-3 w-3" /> Pending
                              </button>
                            )}
                            {guestAnyFlag && (
                              <button
                                type="button"
                                onClick={() => handleVibeMatch(checkinId, origIdx)}
                                disabled={vibeMatchingId === checkinId}
                                className="rounded-full bg-orange-100 dark:bg-orange-900/50 px-2 py-0.5 text-[9px] font-semibold text-orange-700 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-800 disabled:opacity-50"
                              >
                                {vibeMatchingId === checkinId ? "..." : "Vibe?"}
                              </button>
                            )}
                            {guestVibeMatched && (
                              (guestAge !== null && (guestAge < ageRange.min || guestAge > ageRange.max)) ||
                              (guestDob && guestDobFromId && !dobsMatch(guestDob, guestDobFromId))
                            ) && (
                              <span className="rounded-full bg-green-100 dark:bg-green-900/50 px-1.5 py-0.5 text-[9px] font-semibold text-green-700 dark:text-green-400">Vibe OK</span>
                            )}
                          </div>
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
                        ) : col === "ID Card" && !cell && hasPermission(role, permissions, "canEditRecords") ? (
                          <button type="button" onClick={() => openUploadPopup(origIdx, "id", row[3] || "Guest", row[8] || "")}
                            className="inline-flex items-center gap-1 rounded-md bg-brand-green/[0.06] px-2 py-1 text-[10px] font-medium text-brand-green hover:bg-brand-green/[0.12]">
                            <UploadIcon className="h-3 w-3" /> Upload ID
                          </button>
                        ) : col === "Visa" && !cell && isForeignNationality(row[8]) && hasPermission(role, permissions, "canEditRecords") ? (
                          <button type="button" onClick={() => openUploadPopup(origIdx, "visa", row[3] || "Guest", row[8] || "")}
                            className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50">
                            <UploadIcon className="h-3 w-3" /> Upload Visa
                          </button>
                        ) : <span className="text-brand-green-dark/90">{cell}</span>}
                      </td>
                    );
                  })}
                  {(hasPermission(role, permissions, "canEditRecords") || hasPermission(role, permissions, "canDeleteRecords")) && (
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {isForeignNationality(row[8]) && hasPermission(role, permissions, "canEditRecords") && (
                          <button type="button" onClick={() => openFormC(origIdx, row)}
                            className="flex items-center gap-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 px-2 py-1 text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/50">
                            <FileTextIcon className="h-3 w-3" /> Form C
                          </button>
                        )}
                        {row[18] === "checked_out" && row[19] && (Date.now() - new Date(row[19]).getTime() < 24 * 60 * 60 * 1000) && hasPermission(role, permissions, "canEditRecords") && (
                          <button type="button" onClick={() => undoCheckout(origIdx)} className="flex items-center gap-1 rounded-lg bg-blue-50 dark:bg-blue-950 px-2 py-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50">Reactivate</button>
                        )}
                        {hasPermission(role, permissions, "canEditRecords") && (
                          <button type="button" onClick={() => startEdit(origIdx)} className="flex h-8 w-8 items-center justify-center rounded-lg text-brand-green/70 hover:bg-brand-green/[0.06]"><PencilIcon className="h-4 w-4" /></button>
                        )}
                        {hasPermission(role, permissions, "canDeleteRecords") && (
                          <button type="button" onClick={() => deleteRow(origIdx)} className="flex h-8 w-8 items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-950"><Trash2Icon className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>}

      {/* Manual verification popup */}
      {verifyPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setVerifyPopup(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-card p-6 shadow-lift" onClick={(e) => e.stopPropagation()}>
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
                const idCell = verifyPopup.row[14] || "";
                const visaCell = verifyPopup.row[15] || "";
                const idLinks = idCell.split(" | ").filter((u) => u.startsWith("http"));
                const visaLinks = visaCell.split(" | ").filter((u) => u.startsWith("http"));
                return (
                  <>
                    {idLinks.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs text-brand-green-dark/50">ID ({verifyPopup.row[13]}):</span>
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

      {/* Inline upload popup */}
      {uploadPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => { if (!uploading) { setUploadPopup(null); setUploadFiles([]); setUploadIdType(""); } }}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-card p-6 shadow-lift" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-brand-green-dark">
                Upload {uploadPopup.type === "id" ? "ID Card" : "Visa"}
              </h3>
              <button type="button" disabled={uploading} onClick={() => { setUploadPopup(null); setUploadFiles([]); setUploadIdType(""); }} className="rounded-lg p-1 hover:bg-brand-sand">
                <XIcon className="h-5 w-5 text-brand-green-dark/50" />
              </button>
            </div>
            <p className="mt-2 text-sm text-brand-green-dark/70">
              Upload documents for <strong>{uploadPopup.guestName}</strong>
            </p>

            <div className="mt-4 space-y-4">
              {uploadPopup.type === "id" && (
                <div>
                  <Label className="text-xs">ID Type</Label>
                  <select value={uploadIdType} onChange={(e) => setUploadIdType(e.target.value)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {!isForeignNationality(uploadPopup.nationality) && <option value="">Select type...</option>}
                    {getIdTypeOptions(uploadPopup.nationality).map((opt) => <option key={opt} value={opt}>{opt.replace("_", " ")}</option>)}
                  </select>
                </div>
              )}

              <div>
                <Label className="text-xs">Files (images or PDF)</Label>
                <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-brand-sand/50">
                  <UploadIcon className="h-4 w-4 text-brand-green" />
                  {uploadFiles.length > 0 ? `${uploadFiles.length} file(s) selected` : "Choose files"}
                  <input type="file" accept="image/*,.pdf" multiple className="hidden" onChange={(e) => { if (e.target.files) setUploadFiles(Array.from(e.target.files)); }} />
                </label>
                {uploadFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {uploadFiles.map((f, i) => (
                      <p key={i} className="truncate text-xs text-brand-green-dark/60">{f.name}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button type="button" disabled={uploading || uploadFiles.length === 0}
                onClick={handleInlineUpload}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-green px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-green/90 disabled:opacity-50">
                {uploading ? <><Loader2Icon className="h-4 w-4 animate-spin" /> Uploading...</> : <><UploadIcon className="h-4 w-4" /> Upload</>}
              </button>
              <button type="button" disabled={uploading}
                onClick={() => { setUploadPopup(null); setUploadFiles([]); setUploadIdType(""); }}
                className="rounded-xl border border-input px-4 py-3 text-sm font-medium text-brand-green-dark/70 transition-colors hover:bg-brand-sand/50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form C preview modal */}
      {formCPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => { if (!formCEditing) setFormCPopup(null); }}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white dark:bg-card p-4 sm:p-6 shadow-lift" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-indigo-800 dark:text-indigo-300">Form C Data — {formCPopup.row[3]}</h3>
                <p className="mt-0.5 text-[11px] text-indigo-700/70 dark:text-indigo-300/70">
                  Draft ID: <span className="font-semibold">{formCPopup.data.draftId || `CHECKIN-${formCPopup.row[17]}`}</span>
                  {formCPopup.data.frroApplicationId ? " · Submitted" : " · Ready for review"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!formCEditing && (
                  <button type="button" onClick={async () => {
                    if (!confirm("Re-read passport/visa images and extract data again?")) return;
                    setFormCLoading(true);
                    try {
                      const rowId = parseInt(formCPopup.row[17] || "0", 10);
                      const res = await apiCall({ action: "reExtractFormC", rowId });
                      if (res.ok) {
                        const d = await res.json();
                        setFormCPopup({ ...formCPopup, data: d.formCData ? JSON.parse(d.formCData) : formCPopup.data });
                        showSuccess("Data re-extracted from images!");
                      } else { showError("Re-extraction failed"); }
                    } finally { setFormCLoading(false); }
                  }} className="rounded-lg bg-purple-100 dark:bg-purple-900/50 px-3 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800">
                    Re-extract
                  </button>
                )}
                {!formCEditing && (
                  <button type="button" onClick={() => {
                    setFormCEditing(true);
                    const p = formCPopup.data.extractedPassport || {};
                    const v = formCPopup.data.extractedVisa || {};
                    const nameParts = (formCPopup.row[3] || "").split(" ");
                    setFormCEditData({
                      surname: p.surname || nameParts.slice(-1).join("") || "",
                      givenName: p.givenName || nameParts.slice(0, -1).join(" ") || "",
                      passportNumber: p.passportNumber || "",
                      dateOfBirth: p.dateOfBirth || "",
                      sex: p.sex || "",
                      expiryDate: p.expiryDate || "",
                      passportDateOfIssue: p.dateOfIssue || "",
                      placeOfIssue: p.placeOfIssue || "",
                      passportNationality: p.nationality || formCPopup.row[8] || "",
                      passportCountry: formCPopup.row[8] || "",
                      visaNumber: v.visaNumber || "",
                      visaType: v.type || "Tourist",
                      visaDateOfIssue: v.dateOfIssue || "",
                      visaValidTill: v.validTill || "",
                      visaPlaceOfIssue: v.placeOfIssue || "",
                      visaCountry: "INDIA",
                      arrivedFromCountry: formCPopup.data.arrivedFromCountry || "",
                      arrivedFromCity: formCPopup.data.arrivedFromCity || "",
                      arrivedFromPlace: formCPopup.data.arrivedFromPlace || "",
                      dateOfArrivalInIndia: formCPopup.data.dateOfArrivalInIndia || "",
                      dateOfArrivalInHotel: formCPopup.row[1] || "",
                      timeOfArrivalInHotel: formCPopup.row[2] || "",
                      durationOfStay: formCPopup.row[6] || "",
                      purposeOfVisit: formCPopup.data.purposeOfVisit || "Tourism",
                      employedInIndia: formCPopup.data.employedInIndia || "No",
                      nextDestination: formCPopup.data.nextDestination || "",
                      nextDestState: formCPopup.data.nextDestState || "",
                      nextDestCity: formCPopup.data.nextDestCity || "",
                      homeAddress: formCPopup.data.homeAddress || "",
                      homeCity: formCPopup.data.homeCity || "",
                      homeCountry: formCPopup.row[8] || "",
                      homeCountryPhone: formCPopup.data.homeCountryPhone || "",
                      contactIndia: formCPopup.row[5] || "",
                      indiaAddress: "Near Hema Shree, Gokarna Main Beach",
                      indiaState: "KARNATAKA",
                      indiaCity: "UTTARA KANNADA",
                      indiaPinCode: "581421",
                    });
                  }} className="rounded-lg bg-brand-green/10 px-3 py-1.5 text-xs font-medium text-brand-green hover:bg-brand-green/20">
                    <PencilIcon className="mr-1 inline h-3 w-3" /> Edit
                  </button>
                )}
                <button type="button" onClick={() => { setFormCPopup(null); setFormCEditing(false); }} className="rounded-lg p-1 hover:bg-brand-sand">
                  <XIcon className="h-5 w-5 text-brand-green-dark/50" />
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-brand-green-dark/60">
              {formCEditing ? "Edit Form C data — changes will be saved to the record" : "FRRO Form C data extracted from passport, visa, and check-in form"}
            </p>

            {formCEditing ? (
              <div className="mt-4 space-y-4">
                <FormCEditSection title="Personal Details" fields={[
                  { key: "surname", label: "Surname" },
                  { key: "givenName", label: "Given Name" },
                  { key: "sex", label: "Sex" },
                  { key: "dateOfBirth", label: "Date of Birth (DD/MM/YYYY)" },
                  { key: "passportNationality", label: "Nationality" },
                ]} data={formCEditData} onChange={setFormCEditData} />
                <FormCEditSection title="Home Address" fields={[
                  { key: "homeAddress", label: "Address" },
                  { key: "homeCity", label: "City" },
                  { key: "homeCountry", label: "Country" },
                ]} data={formCEditData} onChange={setFormCEditData} />
                <FormCEditSection title="India Address (Hotel)" fields={[
                  { key: "indiaAddress", label: "Address" },
                  { key: "indiaState", label: "State" },
                  { key: "indiaCity", label: "City/District" },
                  { key: "indiaPinCode", label: "Pin Code" },
                ]} data={formCEditData} onChange={setFormCEditData} />
                <FormCEditSection title="Passport Details" fields={[
                  { key: "passportNumber", label: "Passport No" },
                  { key: "placeOfIssue", label: "Place of Issue (City)" },
                  { key: "passportCountry", label: "Place of Issue (Country)" },
                  { key: "passportDateOfIssue", label: "Date of Issue (DD/MM/YYYY)" },
                  { key: "expiryDate", label: "Valid Till (DD/MM/YYYY)" },
                ]} data={formCEditData} onChange={setFormCEditData} />
                <FormCEditSection title="Visa Details" fields={[
                  { key: "visaNumber", label: "Visa No" },
                  { key: "visaType", label: "Type of Visa" },
                  { key: "visaDateOfIssue", label: "Date of Issue (DD/MM/YYYY)" },
                  { key: "visaValidTill", label: "Valid Till (DD/MM/YYYY)" },
                  { key: "visaPlaceOfIssue", label: "Place of Issue (City)" },
                  { key: "visaCountry", label: "Place of Issue (Country)" },
                ]} data={formCEditData} onChange={setFormCEditData} />
                <FormCEditSection title="Arrival Information" fields={[
                  { key: "arrivedFromCountry", label: "Arrived from Country" },
                  { key: "arrivedFromCity", label: "Arrived from City" },
                  { key: "arrivedFromPlace", label: "Arrived from Place" },
                  { key: "dateOfArrivalInIndia", label: "Date of Arrival in India" },
                  { key: "dateOfArrivalInHotel", label: "Date of Arrival in Hotel" },
                  { key: "timeOfArrivalInHotel", label: "Time of Arrival in Hotel" },
                  { key: "durationOfStay", label: "Duration of Stay (days)" },
                ]} data={formCEditData} onChange={setFormCEditData} />
                <FormCEditSection title="Other Details" fields={[
                  { key: "employedInIndia", label: "Employed in India" },
                  { key: "purposeOfVisit", label: "Purpose of Visit" },
                  { key: "nextDestination", label: "Next Destination" },
                  { key: "nextDestState", label: "State" },
                  { key: "nextDestCity", label: "City" },
                  { key: "contactIndia", label: "Contact Phone (India)" },
                  { key: "homeCountryPhone", label: "Phone (Home Country)" },
                ]} data={formCEditData} onChange={setFormCEditData} />
                <div className="flex gap-2">
                  <Button type="button" disabled={formCSaving} onClick={async () => {
                    setFormCSaving(true);
                    try {
                      const updatedData = {
                        ...formCPopup.data,
                        extractedPassport: { surname: formCEditData.surname, givenName: formCEditData.givenName, passportNumber: formCEditData.passportNumber, dateOfBirth: formCEditData.dateOfBirth, sex: formCEditData.sex, dateOfIssue: formCEditData.passportDateOfIssue, expiryDate: formCEditData.expiryDate, placeOfIssue: formCEditData.placeOfIssue, nationality: formCEditData.passportNationality },
                        extractedVisa: { visaNumber: formCEditData.visaNumber, type: formCEditData.visaType, dateOfIssue: formCEditData.visaDateOfIssue, validTill: formCEditData.visaValidTill, placeOfIssue: formCEditData.visaPlaceOfIssue },
                        arrivedFromCountry: formCEditData.arrivedFromCountry, arrivedFromCity: formCEditData.arrivedFromCity, arrivedFromPlace: formCEditData.arrivedFromPlace,
                        dateOfArrivalInIndia: formCEditData.dateOfArrivalInIndia, purposeOfVisit: formCEditData.purposeOfVisit, employedInIndia: formCEditData.employedInIndia,
                        nextDestination: formCEditData.nextDestination, nextDestState: formCEditData.nextDestState, nextDestCity: formCEditData.nextDestCity,
                        homeAddress: formCEditData.homeAddress, homeCity: formCEditData.homeCity, homeCountryPhone: formCEditData.homeCountryPhone,
                      };
                      const rowId = parseInt(formCPopup.row[17] || "0", 10);
                      const res = await apiCall({ action: "updateFormCData", rowId, formCData: JSON.stringify(updatedData) });
                      if (res.ok) {
                        setFormCPopup({ ...formCPopup, data: updatedData });
                        setFormCEditing(false);
                      } else { showError("Failed to save"); }
                    } finally { setFormCSaving(false); }
                  }}>{formCSaving ? "Saving..." : "Save Changes"}</Button>
                  <Button type="button" variant="ghost" onClick={() => setFormCEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {(() => {
                  const p = formCPopup.data.extractedPassport || {};
                  const v = formCPopup.data.extractedVisa || {};
                  const dob = p.dateOfBirth || "";
                  let age = "";
                  if (dob) {
                    const parts = dob.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                    if (parts) { age = String(new Date().getFullYear() - parseInt(parts[3])); }
                  }
                  return (
                    <>
                      <FormCSection title="Personal Details" items={[
                        { label: "Surname", value: p.surname },
                        { label: "Given Name", value: p.givenName || formCPopup.row[3] },
                        { label: "Sex", value: p.sex },
                        { label: "Date of Birth", value: dob },
                        { label: "Age", value: age },
                        { label: "Special Category", value: "Others" },
                        { label: "Nationality", value: formCPopup.row[8] },
                      ]} />

                      <FormCSection title="Home Address" items={[
                        { label: "Address", value: formCPopup.data.homeAddress },
                        { label: "City", value: formCPopup.data.homeCity },
                        { label: "Country", value: formCPopup.row[8] },
                      ]} />

                      <FormCSection title="Address in India (Hotel)" items={[
                        { label: "Address", value: "Near Hema Shree, Gokarna Main Beach" },
                        { label: "State", value: "KARNATAKA" },
                        { label: "City/District", value: "UTTARA KANNADA" },
                        { label: "Pin Code", value: "581421" },
                      ]} />

                      <FormCSection title="Passport Details" items={[
                        { label: "Passport No", value: p.passportNumber },
                        { label: "Place of Issue (City)", value: p.placeOfIssue },
                        { label: "Place of Issue (Country)", value: p.nationality || formCPopup.row[8] },
                        { label: "Date of Issue", value: p.dateOfIssue },
                        { label: "Valid Till", value: p.expiryDate },
                      ]} />

                      <FormCSection title="Visa Details" items={[
                        { label: "Visa No", value: v.visaNumber, unreliable: true },
                        { label: "Place of Issue (City)", value: v.placeOfIssue, unreliable: true },
                        { label: "Place of Issue (Country)", value: "INDIA" },
                        { label: "Date of Issue", value: v.dateOfIssue, unreliable: true },
                        { label: "Valid Till", value: v.validTill, unreliable: true },
                        { label: "Type of Visa", value: v.type, unreliable: true },
                      ]} />

                      <FormCSection title="Arrival Information" items={[
                        { label: "Arrived from Country", value: formCPopup.data.arrivedFromCountry },
                        { label: "Arrived from City", value: formCPopup.data.arrivedFromCity },
                        { label: "Arrived from Place", value: formCPopup.data.arrivedFromPlace },
                        { label: "Date of Arrival in India", value: formCPopup.data.dateOfArrivalInIndia },
                        { label: "Date of Arrival in Hotel", value: formCPopup.row[1] },
                        { label: "Time of Arrival in Hotel", value: formCPopup.row[2] },
                        { label: "Duration of Stay (days)", value: formCPopup.row[6] },
                      ]} />

                      <FormCSection title="Other Details" items={[
                        { label: "Employed in India", value: formCPopup.data.employedInIndia || "No" },
                        { label: "Purpose of Visit", value: formCPopup.data.purposeOfVisit },
                        { label: "Next Destination", value: [formCPopup.data.nextDestination, formCPopup.data.nextDestState, formCPopup.data.nextDestCity].filter(Boolean).join(", ") },
                        { label: "Contact Phone (India)", value: formCPopup.row[5] },
                        { label: "Mobile (India)", value: formCPopup.row[5] },
                        { label: "Phone (Home Country)", value: formCPopup.data.homeCountryPhone },
                      ]} />
                    </>
                  );
                })()}
              </div>
            )}

            <div className="mt-6 space-y-3">
              {formCSubmissions(formCPopup.data).length > 0 && (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-4">
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Form C submitted to FRRO</p>
                  <div className="mt-1 space-y-1.5">
                    {formCSubmissions(formCPopup.data).map((sub, i) => (
                      <div key={`${sub.id}-${i}`} className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-emerald-700 dark:text-emerald-400">#{i + 1} Application ID: <span className="font-bold">{sub.id}</span></span>
                        {sub.date && <span className="text-[10px] text-emerald-600">({new Date(sub.date).toLocaleString()})</span>}
                        <button type="button" onClick={() => removeFormCSubmission(i)} disabled={frroDeleting !== null} className="ml-auto rounded px-2 py-0.5 text-[10px] font-medium text-red-700 underline hover:text-red-900 disabled:opacity-50">
                          {frroDeleting === i ? "Removing..." : "Delete incorrect entry"}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 p-2">
                    <p className="text-[11px] text-emerald-800 dark:text-emerald-300"><strong>Next steps:</strong> Review the details and submit permanently by logging in here:</p>
                    <a href="https://indianfrro.gov.in/frro/FormC/login.jsp" target="_blank" rel="noopener" className="mt-1 inline-block text-xs font-medium text-emerald-700 dark:text-emerald-400 underline hover:text-emerald-900 dark:hover:text-emerald-300">https://indianfrro.gov.in/frro/FormC/login.jsp</a>
                    <p className="mt-1 text-[10px] text-emerald-700 dark:text-emerald-400">Enter latest Application ID → review → click &quot;Save and Continue&quot; to submit permanently.</p>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={frroSubmitting}
                  onClick={async () => {
                    const guardrailIssues = formCSubmissionGuardrails(formCPopup.data);
                    if (guardrailIssues.length > 0) {
                      setFrroStatus(`Cannot submit: ${guardrailIssues.join(" ")}`);
                      return;
                    }
                    setFrroSubmitting(true);
                    setFrroStatus("Connecting to local server...");
                    try {
                      const checkinId = formCPopup.row[17];
                      const secret = password;
                      const expiry = Date.now() + 60 * 60 * 1000;
                      const payload = `${checkinId}:${expiry}`;
                      const hash = btoa(payload + ":" + secret).replace(/=/g, "");
                      const token = `${btoa(payload).replace(/=/g, "")}.${hash}`;
                      const apiUrl = `${window.location.origin}/api/form-c/${checkinId}?token=${token}`;
                      const res = await fetch("http://localhost:3456/fill-form-c", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ apiUrl, frroUsername, frroPassword }),
                      }).catch(() => null);
                      if (!res) { setFrroStatus("Local server not running. Start with: frro (in terminal)"); return; }
                      const data = await res.json();
                      if (data.success) {
                        const appId = String(data.applicationId || "").trim();
                        if (!isUsableFrroApplicationId(appId)) {
                          setFrroStatus("FRRO did not return a valid application ID. Nothing was marked as submitted.");
                        } else {
                          setFrroStatus(`Success! Application ID: ${appId}`);
                          const rowId = parseInt(formCPopup.row[17] || "0", 10);
                          const prevSubs = formCPopup.data.frroSubmissions || [];
                          if (formCPopup.data.frroApplicationId && !prevSubs.length) {
                            prevSubs.push({ id: formCPopup.data.frroApplicationId, date: formCPopup.data.frroSubmittedAt || new Date().toISOString() });
                          }
                          prevSubs.push({ id: appId, date: new Date().toISOString() });
                          const updatedData = { ...formCPopup.data, status: "submitted", frroApplicationId: appId, frroSubmittedAt: new Date().toISOString(), frroSubmissions: prevSubs };
                          await apiCall({ action: "updateFormCData", rowId, formCData: JSON.stringify(updatedData) });
                          setFormCPopup({ ...formCPopup, data: updatedData });
                        }
                      } else if (data.waitingForCaptcha) {
                        setFrroStatus("Solve CAPTCHA in browser window... (polling for result)");
                        const poll = setInterval(async () => {
                          try {
                            const statusRes = await fetch("http://localhost:3456/status");
                            const statusData = await statusRes.json();
                            if (statusData.lastResult) {
                              clearInterval(poll);
                              if (statusData.lastResult.success) {
                                const appId = String(statusData.lastResult.applicationId || "").trim();
                                if (!isUsableFrroApplicationId(appId)) {
                                  setFrroStatus("FRRO did not return a valid application ID. Nothing was marked as submitted.");
                                } else {
                                  setFrroStatus(`Success! Application ID: ${appId}`);
                                  const rowId = parseInt(formCPopup!.row[17] || "0", 10);
                                  const prevSubs = formCPopup!.data.frroSubmissions || [];
                                  if (formCPopup!.data.frroApplicationId && !prevSubs.length) {
                                    prevSubs.push({ id: formCPopup!.data.frroApplicationId, date: formCPopup!.data.frroSubmittedAt || new Date().toISOString() });
                                  }
                                  prevSubs.push({ id: appId, date: new Date().toISOString() });
                                  const updatedData = { ...formCPopup!.data, status: "submitted", frroApplicationId: appId, frroSubmittedAt: new Date().toISOString(), frroSubmissions: prevSubs };
                                  apiCall({ action: "updateFormCData", rowId, formCData: JSON.stringify(updatedData) });
                                  setFormCPopup({ ...formCPopup!, data: updatedData });
                                }
                              } else { setFrroStatus(statusData.lastResult.error || "Failed"); }
                              setFrroSubmitting(false);
                            }
                          } catch { clearInterval(poll); }
                        }, 3000);
                        return;
                      }
                      else { setFrroStatus(data.error || "Failed"); }
                    } catch (e: any) { setFrroStatus(e.message || "Connection failed"); }
                    finally { setFrroSubmitting(false); }
                  }}
                  className="rounded-xl bg-brand-green px-4 py-3 text-sm font-semibold text-white shadow-sm dark:shadow-none transition-colors hover:bg-brand-green-dark disabled:opacity-50"
                >
                  {frroSubmitting ? "Submitting..." : "Review & Submit (Desktop)"}
                </button>
              </div>
              {frroStatus && (
                <p className={cn("text-center text-xs font-medium", frroStatus.includes("Success") ? "text-emerald-600" : frroStatus.includes("Failed") || frroStatus.includes("not running") ? "text-red-600" : "text-amber-600")}>{frroStatus}</p>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const checkinId = formCPopup.row[17];
                    const secret = password;
                    const expiry = Date.now() + 60 * 60 * 1000;
                    const payload = `${checkinId}:${expiry}`;
                    const hash = btoa(payload + ":" + secret).replace(/=/g, "");
                    const token = `${btoa(payload).replace(/=/g, "")}.${hash}`;
                    const res = await fetch(`/api/form-c/${checkinId}?token=${token}`);
                    if (!res.ok) { showError("Failed to fetch photo"); return; }
                    const data = await res.json();
                    if (!data.passportPhotoBase64) { showError("No photo available for this guest"); return; }
                    const img = new Image();
                    img.onload = () => {
                      const canvas = document.createElement("canvas");
                      canvas.width = 300; canvas.height = 400;
                      const ctx = canvas.getContext("2d")!;
                      ctx.drawImage(img, 0, 0, 300, 400);
                      let quality = 0.85;
                      let dataUrl = canvas.toDataURL("image/jpeg", quality);
                      while (dataUrl.length * 0.75 > 48000 && quality > 0.2) {
                        quality -= 0.05;
                        dataUrl = canvas.toDataURL("image/jpeg", quality);
                      }
                      const a = document.createElement("a");
                      a.href = dataUrl;
                      a.download = "photo.jpg";
                      a.click();
                    };
                    img.src = "data:image/jpeg;base64," + data.passportPhotoBase64;
                  } catch (e: any) { showError("Error", e.message); }
                }}
                className="w-full rounded-lg bg-amber-100 dark:bg-amber-900/50 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800"
              >
                Download Photo for FRRO Upload (under 48KB)
              </button>
              <div className="text-center text-[10px] text-brand-green-dark/50">
                <span>Desktop automation only</span>
                <span className="mx-2">·</span>
                <a href="/frro-setup-guide.txt" download className="font-medium text-brand-green underline hover:text-brand-green-dark">Setup guide</a>
                <span className="mx-1">·</span>
                <a href="/frro-setup-macos-linux.sh" download className="font-medium text-brand-green underline hover:text-brand-green-dark">macOS/Linux setup</a>
                <span className="mx-1">·</span>
                <a href="/frro-setup-windows.ps1" download className="font-medium text-brand-green underline hover:text-brand-green-dark">Windows setup</a>
              </div>

              <button type="button" onClick={() => setFrroSettingsOpen(!frroSettingsOpen)} className="w-full text-left text-xs font-medium text-brand-green-dark/60 hover:text-brand-green-dark">
                {frroSettingsOpen ? "▼" : "▶"} FRRO Login Credentials
              </button>
              {frroSettingsOpen && (
                <div className="grid gap-2 rounded-lg border border-brand-mist bg-brand-sand/30 p-3 sm:grid-cols-2">
                  <p className="sm:col-span-2 text-[10px] text-brand-green-dark/60">Desktop automation only. Credentials are stored in the admin settings.</p>
                  <div>
                    <label className="text-[10px] text-brand-green-dark/50">FRRO Username</label>
                    <input type="text" value={frroUsername} onChange={(e) => setFrroUsername(e.target.value)} placeholder="Username" className="mt-0.5 w-full rounded-md border border-input bg-white dark:bg-card px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] text-brand-green-dark/50">FRRO Password</label>
                    <div className="relative mt-0.5">
                      <input type={showFrroPassword ? "text" : "password"} value={frroPassword} onChange={(e) => setFrroPassword(e.target.value)} placeholder="••••••" className="w-full rounded-md border border-input bg-white pr-9 dark:bg-card px-2 py-1.5 text-sm" />
                      <button type="button" onClick={() => setShowFrroPassword((shown) => !shown)} aria-label={showFrroPassword ? "Hide FRRO password" : "Show FRRO password"} className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-brand-green-dark/60 hover:text-brand-green">
                        {showFrroPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <button type="button" onClick={async () => {
                    await apiCall({ action: "setSetting", key: "frro_username", value: frroUsername });
                    await apiCall({ action: "setSetting", key: "frro_password", value: frroPassword });
                    showSuccess("FRRO credentials saved");
                  }} className="sm:col-span-2 rounded-md bg-brand-green/10 px-3 py-1.5 text-xs font-medium text-brand-green hover:bg-brand-green/20">
                    Save Credentials
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormCSection({ title, items }: { title: string; items: { label: string; value?: string; unreliable?: boolean }[] }) {
  const hasUnreliable = items.some((i) => i.unreliable && i.value);
  const missingCount = items.filter((i) => !i.value).length;
  return (
    <div className={cn("rounded-xl border p-4", missingCount > 0 ? "border-red-200 dark:border-red-800 bg-red-50/20 dark:bg-red-950/20" : hasUnreliable ? "border-amber-200 dark:border-amber-800 bg-amber-50/20 dark:bg-amber-950/20" : "border-brand-mist")}>
      <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-brand-green-dark/50">
        {title}
        {missingCount > 0 && <span className="text-[9px] font-normal normal-case text-red-600">⚠ {missingCount} missing — fill before submitting</span>}
        {hasUnreliable && !missingCount && <span className="text-[9px] font-normal normal-case text-amber-600">⚠ verify handwritten fields</span>}
      </h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label}>
            <span className={cn("text-[10px]", !item.value ? "text-red-500 font-medium" : item.unreliable ? "text-amber-600 font-medium" : "text-brand-green-dark/50")}>
              {item.label}{!item.value ? " ⚠" : item.unreliable ? " ⚠" : ""}
            </span>
            {item.value ? (
              <p className={cn("text-sm font-medium", item.unreliable ? "text-amber-800 dark:text-amber-300" : "text-brand-green-dark")}>{item.value}</p>
            ) : (
              <p className="text-sm font-medium italic text-red-400">Missing — click Edit to fill</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FormCEditSection({ title, fields, data, onChange }: {
  title: string;
  fields: { key: string; label: string }[];
  data: Record<string, any>;
  onChange: (d: Record<string, any>) => void;
}) {
  return (
    <div className="rounded-xl border border-indigo-100 dark:border-indigo-800 bg-indigo-50/20 dark:bg-indigo-950/20 p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-indigo-600/70">{title}</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="text-[10px] text-brand-green-dark/50">{f.label}</label>
            <input
              type="text"
              value={data[f.key] || ""}
              onChange={(e) => onChange({ ...data, [f.key]: e.target.value })}
              className="mt-0.5 w-full rounded-md border border-input bg-white dark:bg-card px-2 py-1.5 text-sm"
              placeholder={f.label}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
