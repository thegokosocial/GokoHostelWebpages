import { parseRateResults } from "@/lib/rateScrapeResults";
import { getMappingHealth } from "@/lib/aiosellMappingCheck";
import { NextRequest, NextResponse } from "next/server";
import { driveDeleteFile } from "@/lib/googleApiFetch";
import { getDb } from "@/db";
import { isOfflineMode } from "@/lib/runtime";
import { authenticateUser, hashPassword, verifyPassword, type UserRole } from "@/lib/auth";
import { actionAllowed, type ActionPerm } from "@/lib/actionPermissions";
import { isForeignNationality } from "@/lib/checkinSchema";
import { sqliteWriteCount } from "@/lib/sqliteWriteCount";
import { logListQuery, logSafePage } from "@/lib/logRetention";
import { todayIST } from "@/lib/utils";
import { addCalendarDays, sellableUnits } from "@/lib/inventoryAvailability";
import { stayDueAtHotel } from "@/lib/stayPayment";
import { checkinIdsMatchingContact } from "@/lib/foodTab";
import { getReconciliationStatus } from "@/lib/reconciliation";
import { activeCheckinIdsForContact, getPendingFoodTab } from "@/lib/foodTabDb";
import { dedupeCheckins } from "@/lib/checkinDuplicate";
import { dispatchPush, notificationFirstName } from "@/lib/pushNotify";
import { auditRetentionCutoff, AUDIT_RETENTION_SETTING, normalizeAuditRetentionMonths } from "@/lib/auditRetention";
import {
  getCheckinsByMonth, getActiveCheckins, addCheckin, updateCheckin, deleteCheckin, getCheckinDeleteInfo, getCheckinMonths, markVibeMatched,
  getAllBeds, getBedById, updateBedStatus, assignPhysicalBed, getAllDorms, getDormByName, addDorm, addBed, deleteBed, deleteDormAndBeds,
  logBedHistoryEntry, getBedHistoryAll, deleteBedHistoryEntry,
  getSetting, setSetting,
  getAllStats, incrementStat, getMonthKey,
  getAllBookings, getUpcomingBookings, addBooking, updateBookingStatus, deleteBooking,
  createRateScrape, getLatestRateScrape, getRateScrapeById, updateRateScrape,
  getAllUsers, getUserByUsername, createUser, updateUser, deleteUser as deleteUserById,
  addAuditEntry, getAuditEntries, getAuditEntriesBefore, deleteAuditEntriesBefore, getAuditRetention,
  addSystemLog, getSystemLogs,
  createReviewRequest, getReviewRequestByCheckinId,
} from "@/db/queries";
import { beds, checkins, foodOrders, bookings, bookingHistory, bookingBedAssignments } from "@/db/schema";
import { eq, and, sql, inArray, or, desc, lte } from "drizzle-orm";

async function triggerGithubScrape(scrapeId: number, city: string, startDate: string, endDate: string, propertyType: string, proxyUrl: string = "") {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "thegokosocial/GokoHostelWebpages";
  if (!token) throw new Error("GITHUB_TOKEN not set");

  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/scrape-rates.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "GokoHostel-RateScraper",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { scrapeId: String(scrapeId), city, startDate, endDate, propertyType, proxyUrl },
    }),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
}

function isValidId(val: any): val is number {
  return typeof val === "number" && Number.isInteger(val) && val >= 0;
}

function checkinIdentity(name: string | null | undefined, contact: string | null | undefined): string {
  return `${String(contact || "").trim().toLowerCase()}::${String(name || "").trim().toLowerCase()}`;
}

function normalizedPhone(value: string | null | undefined): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizedName(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function datesOverlap(startA: string | null | undefined, endA: string | null | undefined, startB: string | null | undefined, endB: string | null | undefined): boolean {
  return Boolean(startA && endA && startB && endB && startA < endB && endA > startB);
}

function generateBookingId(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let random = "";
  for (let i = 0; i < 6; i++) random += chars[Math.floor(Math.random() * chars.length)];
  return `GOKO${yyyy}${mm}${dd}${random}`;
}

export async function POST(req: NextRequest) {
  let role: UserRole | null = null;
  let permissions: Record<string, boolean> = {};

  try {
    const body = await req.json();
    const { password, action, month, username, ...rest } = body;

    const authResult = await authenticateUser(password, username);
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    role = authResult.role;
    permissions = authResult.permissions;
    const actingUser = username || role;

    if (action === "auth") {
      return NextResponse.json({ role, permissions });
    }

    const ACTION_PERMISSIONS: Record<string, ActionPerm> = {
      list: "canViewRecords", add: "canAddCheckin", addPast: "admin_only",
      update: "canEditRecords", delete: "canDeleteRecords",
      getDeleteInfo: "canDeleteRecords",
      verifyCheckin: "canViewRecords", getFormCData: "canViewRecords",
      reExtractFormC: "admin_only", updateFormCData: "admin_only",
      getDashboard: "canViewDashboard", markVibeMatched: "canViewDashboard",
      checkoutBed: ["canCheckout", "canViewDashboard"], checkoutGuest: ["canCheckout", "canViewDashboard"], undoCheckout: ["canCheckout", "canViewDashboard"],
      getPendingFoodTab: ["canCheckout", "canViewDashboard"],
      getBeds: ["canViewBeds", "canViewTimeline"], assignBed: ["canAssignBed", "canViewBeds"], unassignBed: ["canAssignBed", "canViewBeds"],
      changeBed: ["canAssignBed", "canViewBeds"], markClean: "canMarkClean",
      getBedHistory: "canViewBeds", deleteBedHistory: "admin_only",
      initDorms: "admin_only", removeDorm: "admin_only", removeBed: "admin_only",
      getSetting: "admin_only", setSetting: "admin_only", getStats: "admin_only", healthCheck: "admin_only",
      getBookings: "canViewBookings", getUpcomingBookings: "canViewBookings",
      addBooking: "canAddBooking", updateBookingStatus: "canViewBookings", deleteBooking: "canDeleteBooking",
      getUsers: "admin_only", createUser: "admin_only", updateUser: "admin_only", deleteUser: "admin_only",
      getAuditLog: "admin_only", getAuditRetention: "admin_only", setAuditRetention: "admin_only", cleanupAuditLog: "admin_only",
      getSystemLogs: "admin_only", runBackup: "admin_only",
      getLatestRateScrape: "admin_only", getRateScrapeStatus: "admin_only",
      startRateScrape: "admin_only", updateRateScrapeResults: "admin_only",
      backfillManagerPermissions: "admin_only",
    };

    const requiredPerm = action ? ACTION_PERMISSIONS[action] : ACTION_PERMISSIONS["list"];
    const gate = actionAllowed(role, permissions, requiredPerm);
    if (gate === "admin_required") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    if (gate === "forbidden") {
      return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    }

    // --- Check-in Records ---

    if (action === "getDeleteInfo") {
      const { rowId } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      return NextResponse.json({ orders: await getCheckinDeleteInfo(rowId) });
    }

    if (action === "list" || !action) {
      const tabName = month || getMonthKey();
      const dbRows = await getCheckinsByMonth(tabName);
      const rows = dbRows.map((r) => [
        r.submittedAt, r.arrivalDate, r.arrivalTime, r.name, r.persons,
        r.contact, r.stayingDays, r.comingFrom, r.nationality, r.emergencyName,
        r.emergencyPhone, r.bookingPlatform || "", r.bookingId || "",
        r.idType, r.idCardLink, r.visaLink, r.verified,
        String(r.id), r.status || "active", r.checkedOutAt || "",
        (r as any).dob || "", String((r as any).vibeMatched || 0), (r as any).dobFromId || "",
      ]);
      const months = await getCheckinMonths();
      return NextResponse.json({ rows, role, tabs: months, currentTab: tabName, permissions });
    }

    if (action === "add") {
      const { entry, formCData, bookingPlatform, bookingId: rawBookingId, dob: addDob } = rest;
      if (!entry) return NextResponse.json({ error: "No entry data" }, { status: 400 });

      const e = Array.isArray(entry) ? entry : [];
      const entryNationality = Array.isArray(entry) ? entry[8] : entry.nationality;
      const entryIdType = Array.isArray(entry) ? entry[13] : entry.idType;
      if (isForeignNationality(entryNationality) && entryIdType !== "passport") {
        return NextResponse.json({ error: "Foreign nationals must provide a passport" }, { status: 400 });
      }
      const entryVisaLink = Array.isArray(entry) ? entry[15] : entry.visaLink;
      if (isForeignNationality(entryNationality) && !entryVisaLink) {
        return NextResponse.json({ error: "Visa document is required for foreign nationals" }, { status: 400 });
      }
      const platform = bookingPlatform || e[11] || "";
      const rawBid = rawBookingId || e[12] || "";
      const finalBookingId = (platform === "Offline booking" || platform === "Walk-in")
        ? generateBookingId()
        : rawBid;

      const addData: Parameters<typeof addCheckin>[0] = {
        submittedAt: e[0] || new Date().toISOString(),
        arrivalDate: e[1] || "", arrivalTime: e[2] || "", name: e[3] || "",
        persons: e[4] || "1", contact: e[5] || "", stayingDays: e[6] || "1",
        comingFrom: e[7] || "", nationality: e[8] || "", emergencyName: e[9] || "",
        emergencyPhone: e[10] || "", idType: e[13] || "", idCardLink: e[14] || "",
        visaLink: e[15] || "", verified: e[16] || "pending",
        formCData: formCData || "", createdMonth: getMonthKey(),
        bookingPlatform: platform,
        bookingId: finalBookingId,
        dob: addDob || undefined,
      };
      try {
        await addCheckin(addData);
      } catch (err: any) {
        if (err?.message?.includes("dob") || err?.message?.includes("vibe_matched") || err?.message?.includes("dob_from_id")) {
          const { dob: _d, dobFromId: _di, ...fallback } = addData;
          await addCheckin(fallback as Parameters<typeof addCheckin>[0]);
        } else { throw err; }
      }
      await addAuditEntry({ username: actingUser, action: "checkin_add", target: e[3] || "unknown" });
      addSystemLog({ level: "info", source: "admin-api", message: `Check-in added: ${e[3] || "unknown"} by ${actingUser}` }).catch(() => {});
      await dispatchPush({
        title: "New Check-in",
        body: `${notificationFirstName(String(e[3] || "Guest"))} · ${e[4] || 1} ${Number(e[4] || 1) === 1 ? "guest" : "guests"} · ${finalBookingId ? `Booking ${finalBookingId}` : platform || "Walk-in"}`,
        url: "/admin?section=dashboard",
        eventId: `admin-checkin-${finalBookingId || addData.submittedAt}`,
        category: "checkin",
      });
      return NextResponse.json({ success: true });
    }

    if (action === "addPast") {
      const { entry, checkoutDate, formCData, bookingPlatform, bookingId: rawBookingId, dob: pastDob } = rest;
      if (!entry) return NextResponse.json({ error: "No entry data" }, { status: 400 });

      const e = Array.isArray(entry) ? entry : [];
      const entryNationality = Array.isArray(entry) ? entry[8] : entry.nationality;
      const entryIdType = Array.isArray(entry) ? entry[13] : entry.idType;
      if (isForeignNationality(entryNationality) && entryIdType !== "passport") {
        return NextResponse.json({ error: "Foreign nationals must provide a passport" }, { status: 400 });
      }
      const entryVisaLink = Array.isArray(entry) ? entry[15] : entry.visaLink;
      if (isForeignNationality(entryNationality) && !entryVisaLink) {
        return NextResponse.json({ error: "Visa document is required for foreign nationals" }, { status: 400 });
      }
      const arrivalDate = e[1] || "";
      const monthKey = arrivalDate ? getMonthKey(new Date(arrivalDate)) : getMonthKey();

      const db = getDb();
      const pastPlatform = bookingPlatform || e[11] || "";
      const pastRawBid = rawBookingId || e[12] || "";
      const finalBookingId = (pastPlatform === "Offline booking" || pastPlatform === "Walk-in")
        ? generateBookingId()
        : pastRawBid;

      const pastData: any = {
        submittedAt: e[0] || new Date().toISOString(),
        arrivalDate, arrivalTime: e[2] || "", name: e[3] || "",
        persons: e[4] || "1", contact: e[5] || "", stayingDays: e[6] || "1",
        comingFrom: e[7] || "", nationality: e[8] || "", emergencyName: e[9] || "",
        emergencyPhone: e[10] || "", idType: e[13] || "", idCardLink: e[14] || "",
        visaLink: e[15] || "", verified: e[16] || "pending",
        status: "checked_out",
        checkedOutAt: checkoutDate || "",
        formCData: formCData || "",
        bookingPlatform: pastPlatform,
        bookingId: finalBookingId,
        createdMonth: monthKey,
      };
      if (pastDob) pastData.dob = pastDob;
      try {
        await db.insert(checkins).values(pastData);
      } catch (err: any) {
        if (err?.message?.includes("dob") || err?.message?.includes("vibe_matched") || err?.message?.includes("dob_from_id")) {
          const { dob: _d, dobFromId: _di, ...fallback } = pastData;
          await db.insert(checkins).values(fallback);
        } else { throw err; }
      }
      await addAuditEntry({ username: actingUser, action: "past_checkin_add", target: e[3] || "unknown" });
      return NextResponse.json({ success: true });
    }

    if (action === "update") {
      const { rowId, entry } = rest;
      if (!isValidId(rowId) || !entry) return NextResponse.json({ error: "Missing data" }, { status: 400 });

      const e = Array.isArray(entry) ? entry : null;
      const entryNationality = e ? e[8] : entry.nationality;
      const entryIdType = e ? e[13] : entry.idType;
      if (isForeignNationality(entryNationality) && entryIdType !== "passport") {
        return NextResponse.json({ error: "Foreign nationals must provide a passport" }, { status: 400 });
      }
      const entryVisaLink = e ? e[15] : entry.visaLink;
      if (isForeignNationality(entryNationality) && !entryVisaLink) {
        return NextResponse.json({ error: "Visa document is required for foreign nationals" }, { status: 400 });
      }
      const data = e ? {
        submittedAt: e[0], arrivalDate: e[1], arrivalTime: e[2], name: e[3],
        persons: e[4], contact: e[5], stayingDays: e[6], comingFrom: e[7],
        nationality: e[8], emergencyName: e[9], emergencyPhone: e[10],
        bookingPlatform: e[11], bookingId: e[12],
        idType: e[13], idCardLink: e[14], visaLink: e[15], verified: e[16],
      } : entry;

      await updateCheckin(rowId, data);
      const guestName = e ? e[3] || "" : entry.name || "";
      const guestContact = e ? e[5] || "" : entry.contact || "";
      const newStayingDays = e ? e[6] : entry.stayingDays;
      const newArrivalDate = e ? e[1] : entry.arrivalDate;

      // Sync bed if stayingDays or arrivalDate changed
      if (newStayingDays && guestContact) {
        const allBeds = await getAllBeds();
        const guestBed = allBeds.find((b) => b.status === "occupied" && b.checkinId === rowId)
          || allBeds.find((b) => b.status === "occupied" && !b.checkinId && b.guestContact === guestContact);
        if (guestBed) {
          const days = parseInt(newStayingDays) || 1;
          const checkin = newArrivalDate || guestBed.checkinDate || todayIST();
          const coDate = new Date(checkin + "T12:00:00Z");
          coDate.setUTCDate(coDate.getUTCDate() + days);
          const checkoutDate = coDate.toISOString().split("T")[0];
          await updateBedStatus(guestBed.id, {
            status: "occupied",
            guestName: guestName || guestBed.guestName || "",
            guestContact,
            checkinDate: checkin,
            expectedCheckout: checkoutDate,
            stayingDays: String(days),
          });
        }
      }

      await addAuditEntry({ username: actingUser, action: "record_edit", target: `${guestName} (id:${rowId})`, details: JSON.stringify({ fields: Object.keys(data).filter((k) => data[k]) }) });
      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      const { rowId, driveFileIds, guestName } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

      await deleteCheckin(rowId);

      if (driveFileIds && driveFileIds.length > 0) {
        for (const fileId of driveFileIds) {
          try { await driveDeleteFile(fileId); } catch (err: any) {
            console.error(`Failed to delete Drive file ${fileId}:`, err?.message);
          }
        }
      }
      await addAuditEntry({ username: actingUser, action: "record_delete", target: `${guestName || ""} (id:${rowId})` });
      return NextResponse.json({ success: true });
    }

    if (action === "verifyCheckin") {
      const { rowId, verified } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      if (isOfflineMode()) {
        await updateCheckin(rowId, { verified: "yes" });
        await addAuditEntry({ username: actingUser, action: "verify_id", target: `${rowId} (offline)` });
        return NextResponse.json({ success: true });
      }
      await updateCheckin(rowId, { verified: verified ? "yes" : "no" });
      await addAuditEntry({ username: actingUser, action: "verify_id", target: String(rowId) });
      return NextResponse.json({ success: true });
    }

    // --- Form C Data ---

    if (action === "getFormCData") {
      const { rowId } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      const db = getDb();
      const rows = await db.select({ formCData: checkins.formCData }).from(checkins).where(eq(checkins.id, rowId));
      return NextResponse.json({ formCData: rows[0]?.formCData || "" });
    }

    if (action === "reExtractFormC") {
      const { rowId } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

      const db = getDb();
      const rows = await db.select().from(checkins).where(eq(checkins.id, rowId));
      const row = rows[0];
      if (!row) return NextResponse.json({ error: "Record not found" }, { status: 404 });

      const { visionAnalyze, getOAuthTokenWithDb } = await import("@/lib/googleApiFetch");
      const { parsePassportMRZ, parseVisaFromText } = await import("@/lib/parsePassportData");

      function extractDriveId(url: string): string | null {
        const match = url.match(/\/d\/([^/]+)\//);
        return match ? match[1] : null;
      }

      function arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += 8192) {
          chunks.push(String.fromCharCode(...bytes.slice(i, i + 8192)));
        }
        return btoa(chunks.join(""));
      }

      async function downloadDriveFile(fileId: string): Promise<ArrayBuffer | null> {
        const token = await getOAuthTokenWithDb();
        if (!token) return null;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return null;
        return res.arrayBuffer();
      }

      let extractedPassport: Record<string, any> | null = null;
      let extractedVisa: Record<string, any> | null = null;
      let rawPassportOcr = "";
      let rawVisaOcr = "";

      if (row.idCardLink) {
        const links = row.idCardLink.split(" | ").filter((l) => l.startsWith("http"));
        if (links.length > 0) {
          const fileId = extractDriveId(links[0]);
          if (fileId) {
            try {
              const buffer = await downloadDriveFile(fileId);
              if (buffer) {
                const base64 = arrayBufferToBase64(buffer);
                const analysis = await visionAnalyze(base64, "image/jpeg");
                rawPassportOcr = analysis.text || "";
                const parsed = parsePassportMRZ(analysis.text);
                if (Object.keys(parsed).length > 0) extractedPassport = parsed;
                incrementStat("vision", 1).catch(() => {});
              }
            } catch (e: any) {
              console.error("Passport re-OCR failed:", e?.message);
            }
          }
        }
      }

      if (row.visaLink) {
        const links = row.visaLink.split(" | ").filter((l) => l.startsWith("http"));
        if (links.length > 0) {
          const fileId = extractDriveId(links[0]);
          if (fileId) {
            try {
              const buffer = await downloadDriveFile(fileId);
              if (buffer) {
                const base64 = arrayBufferToBase64(buffer);
                const analysis = await visionAnalyze(base64, "image/jpeg");
                rawVisaOcr = analysis.text || "";
                const parsed = parseVisaFromText(analysis.text);
                if (Object.keys(parsed).length > 0) extractedVisa = parsed;
                incrementStat("vision", 1).catch(() => {});
              }
            } catch (e: any) {
              console.error("Visa re-OCR failed:", e?.message);
            }
          }
        }
      }

      let existingData: Record<string, any> = {};
      if (row.formCData) { try { existingData = JSON.parse(row.formCData); } catch {} }

      const updatedData = { ...existingData };
      if (extractedPassport) updatedData.extractedPassport = extractedPassport;
      if (extractedVisa) updatedData.extractedVisa = extractedVisa;
      if (rawPassportOcr) updatedData._rawPassportOcr = rawPassportOcr;
      if (rawVisaOcr) updatedData._rawVisaOcr = rawVisaOcr;
      await db.update(checkins).set({ formCData: JSON.stringify(updatedData) }).where(eq(checkins.id, rowId));

      return NextResponse.json({ success: true, formCData: JSON.stringify(updatedData) });
    }

    if (action === "updateFormCData") {
      const { rowId, formCData } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      const db = getDb();
      await db.update(checkins).set({ formCData: formCData || "" }).where(eq(checkins.id, rowId));
      await addAuditEntry({ username: actingUser, action: "formc_updated", target: String(rowId) });
      return NextResponse.json({ success: true });
    }

    // --- Health Check ---

    if (action === "healthCheck") {
      const d1 = await (async () => {
        try {
          const db = getDb();
          await db.select({ one: sql`1` }).from(sql`(SELECT 1)`);
          return { status: "ok" as const };
        } catch (e: any) {
          return { status: "error" as const, message: e.message || "Database connection failed" };
        }
      })();

      if (isOfflineMode()) {
        const offlineSkipped = { status: "skipped" as const, message: "Offline mode" };
        return NextResponse.json({ results: { d1, drive: offlineSkipped, vision: offlineSkipped, gmail: offlineSkipped } });
      }

      const { checkOAuthHealth, checkVisionHealth, checkGmailHealth } = await import("@/lib/googleApiFetch");
      const [drive, vision, gmail] = await Promise.all([
        checkOAuthHealth(),
        checkVisionHealth(),
        checkGmailHealth(),
      ]);

      return NextResponse.json({ results: { d1, drive, vision, gmail } });
    }

    // --- Stats & Settings ---

    if (action === "getStats") {
      const stats = await getAllStats();
      return NextResponse.json({ stats });
    }

    if (action === "getSetting") {
      const { key } = rest;
      const value = await getSetting(key);
      return NextResponse.json({ value });
    }

    if (action === "setSetting") {
      const { key, value } = rest;
      await setSetting(key, value);
      await addAuditEntry({ username: actingUser, action: "setting_changed", target: key });
      return NextResponse.json({ success: true });
    }

    if (action === "markVibeMatched") {
      const { checkinId } = rest;
      if (!isValidId(checkinId)) return NextResponse.json({ error: "Invalid checkin ID" }, { status: 400 });
      try {
        await markVibeMatched(checkinId);
      } catch {
        return NextResponse.json({ success: true });
      }
      await addAuditEntry({ username: actingUser, action: "vibe_matched", target: `checkin:${checkinId}` });
      return NextResponse.json({ success: true });
    }

    // --- Bed History ---

    if (action === "getBedHistory") {
      const dbRows = await getBedHistoryAll();
      const rows = dbRows.map((r) => [r.createdAt, r.bedIdLabel, r.dormName, r.action, r.guestName, r.guestContact, String(r.id)]);
      return NextResponse.json({ rows, role });
    }

    if (action === "deleteBedHistory") {
      const { rowId } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      await deleteBedHistoryEntry(rowId);
      return NextResponse.json({ success: true });
    }

    // --- Dashboard ---

    if (action === "getDashboard") {
      const monthKey = getMonthKey();
      const allCheckins = await getCheckinsByMonth(monthKey);
      const today = todayIST();
      const todayCheckins = allCheckins.filter((r) => r.arrivalDate === today && r.status === "active");
      const todayCompletedCheckinCount = allCheckins.filter((r) => r.arrivalDate === today && (r.status === "active" || r.status === "checked_out")).length;

      const allBeds = await getAllBeds();
      const allBookings = await getAllBookings();
      const dashboardDb = getDb();
      const currentAssignments = await dashboardDb.select({
        bedId: bookingBedAssignments.bedId,
        bookingId: bookingBedAssignments.bookingId,
        checkinDate: bookingBedAssignments.checkinDate,
        checkoutDate: bookingBedAssignments.checkoutDate,
      }).from(bookingBedAssignments).where(and(
        eq(bookingBedAssignments.status, "assigned"),
        lte(bookingBedAssignments.checkinDate, today),
      ));
      const bookingByReference = new Map<string, number>();
      for (const booking of allBookings) {
        for (const reference of [booking.bookingRef, booking.gokoBookingId, booking.cmBookingId]) {
          if (reference) bookingByReference.set(String(reference).trim(), booking.id);
        }
      }
      const total = allBeds.length;
      const occupied = allBeds.filter((b) => b.status === "occupied").length;
      const available = allBeds.filter((b) => b.status === "available").length;
      const cleanup = allBeds.filter((b) => b.status === "cleanup").length;

      const checkoutBeds = allBeds.filter((b) => b.status === "occupied" && b.expectedCheckout && b.expectedCheckout <= today);

      const activeCheckins = await getActiveCheckins();
      const bookingById = new Map(allBookings.map((booking) => [booking.id, booking]));
      const bookingByCheckinId = new Map<number, (typeof allBookings)[number]>();
      for (const checkin of activeCheckins) {
        const bookingId = checkin.bookingId ? bookingByReference.get(String(checkin.bookingId).trim()) : undefined;
        const booking = bookingId ? bookingById.get(bookingId) : undefined;
        if (booking) bookingByCheckinId.set(checkin.id, booking);
      }
      const uniqueCheckinIds = [...new Set(
        checkoutBeds.flatMap((b) => b.checkinId ? [b.checkinId] : checkinIdsMatchingContact(activeCheckins, b.guestContact || ""))
      )];
      const tabByCheckin = new Map<number, { pendingTab: number; paidTotal: number; totalOrders: number; pendingOrders: number }>();
      if (uniqueCheckinIds.length > 0) {
        const tabRows = await dashboardDb.select({
          checkinId: foodOrders.checkinId,
          paymentStatus: foodOrders.paymentStatus,
          total: sql<number>`COALESCE(SUM(${foodOrders.total}), 0)`,
          count: sql<number>`COUNT(*)`,
        }).from(foodOrders)
          .where(and(
            inArray(foodOrders.checkinId, uniqueCheckinIds),
            sql`${foodOrders.status} != 'cancelled'`,
          ))
          .groupBy(foodOrders.checkinId, foodOrders.paymentStatus);
        for (const row of tabRows) {
          if (row.checkinId == null) continue;
          const acc = tabByCheckin.get(row.checkinId) || { pendingTab: 0, paidTotal: 0, totalOrders: 0, pendingOrders: 0 };
          acc.totalOrders += Number(row.count) || 0;
          if (row.paymentStatus === "on_tab" || row.paymentStatus === "pending") {
            acc.pendingTab += Number(row.total) || 0;
            acc.pendingOrders += Number(row.count) || 0;
          } else if (row.paymentStatus === "paid") {
            acc.paidTotal += Number(row.total) || 0;
          }
          tabByCheckin.set(row.checkinId, acc);
        }
      }

      const todayCheckoutBeds = checkoutBeds.map((b) => {
        const matchedIds = b.checkinId
          ? [b.checkinId]
          : checkinIdsMatchingContact(activeCheckins, b.guestContact || "");
        const tab = { pendingTab: 0, paidTotal: 0, totalOrders: 0, pendingOrders: 0 };
        for (const id of matchedIds) {
          const part = tabByCheckin.get(id);
          if (!part) continue;
          tab.pendingTab += part.pendingTab;
          tab.paidTotal += part.paidTotal;
          tab.totalOrders += part.totalOrders;
          tab.pendingOrders += part.pendingOrders;
        }
        const checkinId = matchedIds[matchedIds.length - 1];
        const linkedByCheckin = [...matchedIds].reverse().map((id) => bookingByCheckinId.get(id)).find(Boolean);
        const phone = normalizedPhone(b.guestContact);
        const phoneMatches = phone
          ? allBookings.filter((booking) => !["cancelled", "no_show"].includes(booking.status) && normalizedPhone(booking.contact) === phone && datesOverlap(booking.checkinDate, booking.checkoutDate || addCalendarDays(booking.checkinDate, 1), b.checkinDate, b.expectedCheckout))
          : [];
        const name = normalizedName(b.guestName);
        const nameMatches = name
          ? allBookings.filter((booking) => !["cancelled", "no_show"].includes(booking.status) && normalizedName(booking.guestName) === name && datesOverlap(booking.checkinDate, booking.checkoutDate || addCalendarDays(booking.checkinDate, 1), b.checkinDate, b.expectedCheckout))
          : [];
        const linkedBooking = linkedByCheckin || (phoneMatches.length === 1 ? phoneMatches[0] : null) || (nameMatches.length === 1 ? nameMatches[0] : null);
        const roomDue = linkedBooking ? stayDueAtHotel(linkedBooking.paymentStatus, linkedBooking.amountTotal, linkedBooking.amountPaid) : null;
        const plannedBedLabels = linkedBooking
          ? currentAssignments
            .filter((assignment) => assignment.bookingId === linkedBooking.id && datesOverlap(assignment.checkinDate, assignment.checkoutDate, b.checkinDate, b.expectedCheckout))
            .map((assignment) => {
              const assignedBed = allBeds.find((candidate) => candidate.id === assignment.bedId);
              return assignedBed ? `${assignedBed.dormName} / ${assignedBed.bedId}` : "";
            })
            .filter((label, index, labels) => label && labels.indexOf(label) === index)
          : [];
        return {
          name: b.guestName || "",
          contact: b.guestContact || "",
          bedId: b.bedId,
          dorm: b.dormName,
          bedIdx: b.id,
          expectedCheckout: b.expectedCheckout || "",
          pendingTab: tab.pendingTab,
          paidTotal: tab.paidTotal,
          totalOrders: tab.totalOrders,
          pendingOrders: tab.pendingOrders,
          checkinId: checkinId || null,
          roomStatus: linkedBooking ? (roomDue != null && roomDue > 0 ? "pending" : "clear") : "not_linked",
          roomDue,
          plannedRoomType: linkedBooking?.roomType || "",
          plannedBedLabels,
        };
      });

      const assignedGuests = new Map<number, string>();
      const legacyAssignedGuests = new Map<string, string[]>();
      for (const b of allBeds) {
        if (b.status !== "occupied") continue;
        const label = `${b.dormName} / ${b.bedId}`;
        if (b.checkinId) assignedGuests.set(b.checkinId, label);
        else if (b.guestContact) {
          const key = checkinIdentity(b.guestName || "", b.guestContact);
          legacyAssignedGuests.set(key, [...(legacyAssignedGuests.get(key) || []), label]);
        }
      }

      const todayCheckinsWithBed = todayCheckins.map((r) => {
        const linkedBookingId = r.bookingId ? bookingByReference.get(String(r.bookingId).trim()) || null : null;
        return {
        row: [r.submittedAt, r.arrivalDate, r.arrivalTime, r.name, r.persons, r.contact, r.stayingDays, r.comingFrom, r.nationality, r.emergencyName, r.emergencyPhone, r.idType, r.idCardLink, r.visaLink, r.verified, String(r.id)],
        assignedBed: assignedGuests.get(r.id) || legacyAssignedGuests.get(checkinIdentity(r.name, r.contact))?.[0] || null,
        linkedBookingId,
        dob: (r as any).dob || "",
        dobFromId: (r as any).dobFromId || "",
        vibeMatched: (r as any).vibeMatched || 0,
        };
      });

      const validationEnabled = (await getSetting("image_validation")) !== "off";
      const guestMinAge = Number(await getSetting("guest_min_age")) || 18;
      const guestMaxAge = Number(await getSetting("guest_max_age")) || 40;

      const db = getDb();
      const unpaidCheckoutFrom = addCalendarDays(todayIST(), -14);
      const tomorrow = addCalendarDays(today, 1);
      const todayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
      const tomorrowStart = new Date(`${tomorrow}T00:00:00+05:30`).toISOString();
      const [inHouse, todayBookings, cancellationRows, expectedCheckinRows] = await Promise.all([
        db.select({
          id: bookings.id,
          guestName: bookings.guestName,
          contact: bookings.contact,
          checkinDate: bookings.checkinDate,
          checkoutDate: bookings.checkoutDate,
          amountTotal: bookings.amountTotal,
          amountPaid: bookings.amountPaid,
          paymentStatus: bookings.paymentStatus,
        }).from(bookings).where(or(
          eq(bookings.status, "checked_in"),
          and(eq(bookings.status, "checked_out"), sql`${bookings.checkoutDate} >= ${unpaidCheckoutFrom}`),
        )),
        db.select({
          id: bookings.id,
          guestName: bookings.guestName,
          platform: bookings.platform,
          bookingRef: bookings.bookingRef,
          checkinDate: bookings.checkinDate,
          checkoutDate: bookings.checkoutDate,
          persons: bookings.persons,
          status: bookings.status,
          createdAt: bookings.createdAt,
        }).from(bookings)
          .where(and(sql`${bookings.createdAt} >= ${todayStart}`, sql`${bookings.createdAt} < ${tomorrowStart}`))
          .orderBy(desc(bookings.createdAt)),
        db.select({ count: sql<number>`COUNT(*)` }).from(bookingHistory).where(and(
          inArray(bookingHistory.action, ["Cancelled", "Cancelled from Channel", "Partial Cancellation"]),
          sql`${bookingHistory.performedAt} >= ${todayStart}`,
          sql`${bookingHistory.performedAt} < ${tomorrowStart}`,
        )),
        db.select({ count: sql<number>`COUNT(*)` }).from(bookings).where(and(
          eq(bookings.checkinDate, today),
          sql`${bookings.status} IN ('received', 'confirmed', 'checked_in', 'checked_out')`,
        )),
      ]);
      const unpaidStays = inHouse
        .map((b) => {
          const due = stayDueAtHotel(b.paymentStatus, b.amountTotal, b.amountPaid);
          return { ...b, due };
        })
        .filter((b) => b.due > 0);
      const reconciliationWarning = role === "admin" || role === "manager"
        ? await getReconciliationStatus(addCalendarDays(today, -1))
        : null;

      return NextResponse.json({
        todayCheckins: todayCheckinsWithBed,
        todayCompletedCheckinCount,
        todayExpectedCheckinCount: Number(expectedCheckinRows[0]?.count) || 0,
        todayCheckouts: todayCheckoutBeds,
        todayBookings,
        todayBookingCount: todayBookings.length,
        todayCancellationCount: Number(cancellationRows[0]?.count) || 0,
        unpaidStays,
        stats: { total, occupied, available, cleanup },
        validationEnabled,
        guestMinAge,
        guestMaxAge,
        reconciliationWarning: reconciliationWarning?.isReconciled ? null : reconciliationWarning,
        mappingHealth: role === "admin" || role === "manager" ? await getMappingHealth().catch(() => ({ status: "failed", report: null })) : null,
        role,
      });
    }

    // --- Beds ---

    if (action === "getBeds") {
      const allBeds = await getAllBeds();
      const monthKey = getMonthKey();
      const monthCheckins = await getCheckinsByMonth(monthKey);
      const allBookings = await getAllBookings();
      const db = getDb();
      const bookingAssignments = await db.select({
        bookingId: bookingBedAssignments.bookingId,
        bedId: bookingBedAssignments.bedId,
        checkinDate: bookingBedAssignments.checkinDate,
        checkoutDate: bookingBedAssignments.checkoutDate,
        status: bookingBedAssignments.status,
      }).from(bookingBedAssignments).where(eq(bookingBedAssignments.status, "assigned"));
      const bookingByReference = new Map<string, number>();
      for (const booking of allBookings) {
        for (const reference of [booking.bookingRef, booking.gokoBookingId, booking.cmBookingId]) {
          if (reference) bookingByReference.set(String(reference).trim(), booking.id);
        }
      }

      const assignedCheckinIds = new Set<number>(allBeds
        .filter((b) => b.status === "occupied" && b.checkinId)
        .map((b) => b.checkinId)
        .filter((id): id is number => typeof id === "number"));
      const legacyAssignedCounts = new Map<string, number>();
      for (const bed of allBeds) {
        if (bed.status === "occupied" && !bed.checkinId && bed.guestContact) {
          const key = checkinIdentity(bed.guestName || "", bed.guestContact);
          legacyAssignedCounts.set(key, (legacyAssignedCounts.get(key) || 0) + 1);
        }
      }
      const dedupedMonthCheckins = dedupeCheckins(monthCheckins.filter((r) => r.status === "active" && r.contact), assignedCheckinIds);
      const unassignedCheckins = dedupedMonthCheckins.filter((r) => {
        if (assignedCheckinIds.has(r.id)) return false;
        const key = checkinIdentity(r.name, r.contact);
        const legacyCount = legacyAssignedCounts.get(key) || 0;
        if (legacyCount > 0) { legacyAssignedCounts.set(key, legacyCount - 1); return false; }
        return true;
      });

      const bedsArr = allBeds.map((b) => [
        b.dormName, b.bedId, b.position, b.type, b.status,
        b.guestName, b.guestContact, b.checkinDate, b.expectedCheckout, b.stayingDays,
        String(b.id), String(b.checkinId || ""),
      ]);
      const unassignedArr = unassignedCheckins.map((r) => [
        r.submittedAt, r.arrivalDate, r.arrivalTime, r.name, r.persons,
        r.contact, r.stayingDays, r.comingFrom, r.nationality, r.emergencyName,
        r.emergencyPhone, r.idType, r.idCardLink, r.visaLink, r.verified,
        String(r.id), r.bookingId || "",
      ]);

      const linkedBookingDetails: Record<string, { id: number; persons: number; roomType: string; reference: string; source: string; plannedBedLabels: string[]; matchMethod: "reference" | "phone" | "name" }> = {};
      for (const checkin of unassignedCheckins) {
        const reference = String(checkin.bookingId || "").trim();
        const checkoutDate = addCalendarDays(checkin.arrivalDate, Math.max(1, Number(checkin.stayingDays) || 1));
        const candidates = allBookings.filter((item) =>
          !["cancelled", "no_show"].includes(item.status) &&
          datesOverlap(item.checkinDate, item.checkoutDate || addCalendarDays(item.checkinDate, 1), checkin.arrivalDate, checkoutDate)
        );
        const directBooking = reference
          ? candidates.find((item) => [item.bookingRef, item.gokoBookingId, item.cmBookingId].some((value) => value && String(value).trim() === reference))
          : undefined;
        const phone = normalizedPhone(checkin.contact);
        const phoneMatches = phone ? candidates.filter((item) => normalizedPhone(item.contact) === phone) : [];
        const guestName = normalizedName(checkin.name);
        const nameMatches = guestName ? candidates.filter((item) => normalizedName(item.guestName) === guestName) : [];
        const matched = directBooking
          ? { booking: directBooking, matchMethod: "reference" as const }
          : phoneMatches.length === 1
            ? { booking: phoneMatches[0], matchMethod: "phone" as const }
            : nameMatches.length === 1
              ? { booking: nameMatches[0], matchMethod: "name" as const }
              : null;
        if (matched) {
          const plannedBedLabels = bookingAssignments
            .filter((assignment) => assignment.bookingId === matched.booking.id && datesOverlap(assignment.checkinDate, assignment.checkoutDate, checkin.arrivalDate, checkoutDate))
            .map((assignment) => {
              const assignedBed = allBeds.find((bed) => bed.id === assignment.bedId);
              return assignedBed ? `${assignedBed.dormName} / ${assignedBed.bedId}` : "";
            })
            .filter((label, index, labels) => label && labels.indexOf(label) === index);
          linkedBookingDetails[String(checkin.id)] = {
            id: matched.booking.id,
            persons: matched.booking.persons,
            roomType: matched.booking.roomType || "",
            reference: matched.booking.bookingRef || reference,
            source: matched.booking.platform || matched.booking.source || "booking",
            plannedBedLabels,
            matchMethod: matched.matchMethod,
          };
        }
      }
      return NextResponse.json({ beds: bedsArr, unassigned: unassignedArr, linkedBookingDetails, role });
    }

    if (action === "assignBed") {
      const { bedId, guestName, guestContact, checkinDate, stayingDays, checkinId } = rest;
      if (!isValidId(bedId) || !guestName) return NextResponse.json({ error: "Missing data" }, { status: 400 });

      const bed = await getBedById(bedId);
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed.status !== "available") return NextResponse.json({ error: "Bed is not available" }, { status: 400 });

      if (isValidId(checkinId)) {
        const guest = await getDb().select({ id: checkins.id, status: checkins.status }).from(checkins)
          .where(and(eq(checkins.id, Number(checkinId)), eq(checkins.status, "active"))).limit(1);
        if (guest.length === 0) return NextResponse.json({ error: "Active check-in not found" }, { status: 404 });
      }

      const days = parseInt(stayingDays) || 1;
      const checkin = checkinDate || todayIST();
      const coDate = new Date(checkin + "T12:00:00Z");
      coDate.setUTCDate(coDate.getUTCDate() + days);
      const checkoutDate = coDate.toISOString().split("T")[0];

      const assigned = await assignPhysicalBed(bedId, { guestName, guestContact: guestContact || "", checkinDate: checkin, expectedCheckout: checkoutDate, stayingDays: String(days), checkinId: isValidId(checkinId) ? Number(checkinId) : undefined });
      if (!assigned) return NextResponse.json({ error: "Bed was just assigned to another guest. Refresh and choose another available bed." }, { status: 409 });
      await logBedHistoryEntry({ bedIdLabel: bed.bedId, dormName: bed.dormName, action: "assign", guestName, guestContact: guestContact || "" });
      await addAuditEntry({ username: actingUser, action: "bed_assign", target: `${bed.bedId} ${guestName}` });
      addSystemLog({ level: "info", source: "admin-api", message: `Bed assigned: ${bed.bedId} → ${guestName} by ${actingUser}` }).catch(() => {});
      return NextResponse.json({ success: true });
    }

    if (action === "checkoutBed") {
      const { bedId } = rest;
      if (!isValidId(bedId)) return NextResponse.json({ error: "Invalid bed ID" }, { status: 400 });

      const bed = await getBedById(bedId);
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed.status !== "occupied") return NextResponse.json({ error: "Bed is not occupied" }, { status: 400 });

      await logBedHistoryEntry({ bedIdLabel: bed.bedId, dormName: bed.dormName, action: "checkout", guestName: bed.guestName || "", guestContact: bed.guestContact || "" });
      await updateBedStatus(bedId, { status: "cleanup", checkinId: null });

      if (bed.checkinId || bed.guestContact) {
        try {
          const db = getDb();
          const ids = bed.checkinId
            ? (await db.select({ id: checkins.id }).from(checkins).where(and(
              eq(checkins.id, bed.checkinId),
              eq(checkins.status, "active"),
            )).limit(1)).map((row) => row.id)
            : (await db.select({ id: checkins.id }).from(checkins).where(and(
              inArray(checkins.id, await activeCheckinIdsForContact(bed.guestContact || "")),
              eq(checkins.name, bed.guestName || ""),
              eq(checkins.status, "active"),
            )).limit(1000)).map((row) => row.id);
          if (ids.length > 0) {
            await db.update(checkins).set({ status: "checked_out", checkedOutAt: new Date().toISOString() }).where(
              and(inArray(checkins.id, ids), eq(checkins.status, "active"))
            );
            const guestRows = await db.select().from(checkins).where(inArray(checkins.id, ids)).limit(1);
            if (guestRows.length > 0) {
              const guest = guestRows[0];
              const existing = await getReviewRequestByCheckinId(guest.id);
              if (!existing) {
                const bytes = new Uint8Array(18);
                crypto.getRandomValues(bytes);
                const token = Array.from(bytes).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
                createReviewRequest({ token, checkinId: guest.id, guestName: guest.name, guestContact: guest.contact, bookingId: guest.bookingId || "" }).catch((e) => {
                  addSystemLog({ level: "warn", source: "review-funnel", message: `Failed to create review request for checkin ${guest.id}: ${e?.message || "unknown"}` }).catch(() => {});
                });
              }
            }
          }
        } catch (e: any) {
          addSystemLog({ level: "warn", source: "review-funnel", message: `Checkout review creation failed: ${e?.message || "unknown"}` }).catch(() => {});
        }
      }

      await addAuditEntry({ username: actingUser, action: "bed_checkout", target: `${bed.bedId} ${bed.guestName || ""}` });
      addSystemLog({ level: "info", source: "admin-api", message: `Checkout: ${bed.bedId} (${bed.guestName || "unknown"}) by ${actingUser}` }).catch(() => {});
      return NextResponse.json({ success: true });
    }

    if (action === "getPendingFoodTab") {
      const { checkinId, contact } = rest;
      const tab = await getPendingFoodTab({
        checkinId: typeof checkinId === "number" ? checkinId : parseInt(checkinId, 10) || undefined,
        contact: typeof contact === "string" ? contact : "",
      });
      return NextResponse.json(tab);
    }

    if (action === "checkoutGuest") {
      const { checkinId, guestName: checkoutGuestName } = rest;
      if (!isValidId(checkinId) || checkinId === 0) return NextResponse.json({ error: "Invalid check-in ID" }, { status: 400 });

      const db = getDb();
      const result = await db.update(checkins)
        .set({ status: "checked_out", checkedOutAt: new Date().toISOString() })
        .where(and(eq(checkins.id, checkinId), eq(checkins.status, "active")));

      const changed = sqliteWriteCount(result);
      if (changed === 0) {
        return NextResponse.json({ error: "Guest not found or already checked out" }, { status: 400 });
      }

      // Auto-create review request for directly checked-out guest
      try {
        const existing = await getReviewRequestByCheckinId(checkinId);
        if (!existing) {
          const guestRows = await db.select().from(checkins).where(eq(checkins.id, checkinId)).limit(1);
          if (guestRows.length > 0) {
            const guest = guestRows[0];
            const bytes = new Uint8Array(18);
            crypto.getRandomValues(bytes);
            const token = Array.from(bytes).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
            await createReviewRequest({ token, checkinId: guest.id, guestName: guest.name, guestContact: guest.contact, bookingId: guest.bookingId || "" });
          }
        }
      } catch (e: any) {
        addSystemLog({ level: "warn", source: "review-funnel", message: `Direct checkout review creation failed: ${e?.message || "unknown"}` }).catch(() => {});
      }

      await addAuditEntry({ username: actingUser, action: "guest_checkout_direct", target: checkoutGuestName || `id:${checkinId}` });
      addSystemLog({ level: "info", source: "admin-api", message: `Direct checkout: ${checkoutGuestName || "unknown"} (id:${checkinId}) by ${actingUser}` }).catch(() => {});
      return NextResponse.json({ success: true });
    }

    if (action === "markClean") {
      const { bedId } = rest;
      if (!isValidId(bedId)) return NextResponse.json({ error: "Invalid bed ID" }, { status: 400 });

      const bed = await getBedById(bedId);
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed.status !== "cleanup") return NextResponse.json({ error: "Bed is not in cleanup status" }, { status: 400 });

      await logBedHistoryEntry({ bedIdLabel: bed.bedId, dormName: bed.dormName, action: "markClean", guestName: "", guestContact: "" });
      await updateBedStatus(bedId, { status: "available", checkinId: null });
      await addAuditEntry({ username: actingUser, action: "bed_clean", target: bed.bedId });
      return NextResponse.json({ success: true });
    }

    if (action === "unassignBed") {
      const { bedId } = rest;
      if (!isValidId(bedId)) return NextResponse.json({ error: "Invalid bed ID" }, { status: 400 });

      const bed = await getBedById(bedId);
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed.status !== "occupied") return NextResponse.json({ error: "Bed is not occupied" }, { status: 400 });

      await logBedHistoryEntry({ bedIdLabel: bed.bedId, dormName: bed.dormName, action: "unassign", guestName: bed.guestName || "", guestContact: bed.guestContact || "" });
      await updateBedStatus(bedId, { status: "available", checkinId: null });
      await addAuditEntry({ username: actingUser, action: "bed_unassign", target: `${bed.bedId} ${bed.guestName || ""}` });
      return NextResponse.json({ success: true });
    }

    if (action === "changeBed") {
      const { fromBedId, toBedId } = rest;
      if (!isValidId(fromBedId) || !isValidId(toBedId)) return NextResponse.json({ error: "Invalid bed ID" }, { status: 400 });

      const fromBed = await getBedById(fromBedId);
      const toBed = await getBedById(toBedId);
      if (!fromBed || !toBed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (fromBed.status !== "occupied") return NextResponse.json({ error: "Source bed is not occupied" }, { status: 400 });
      if (toBed.status !== "available") return NextResponse.json({ error: "Target bed is not available" }, { status: 400 });

      const { guestName, guestContact, checkinDate, expectedCheckout, stayingDays, checkinId } = fromBed;
      await updateBedStatus(fromBedId, { status: "cleanup", checkinId: null });
      await updateBedStatus(toBedId, { status: "occupied", guestName: guestName || "", guestContact: guestContact || "", checkinDate: checkinDate || "", expectedCheckout: expectedCheckout || "", stayingDays: stayingDays || "", checkinId: checkinId || null });
      await logBedHistoryEntry({ bedIdLabel: fromBed.bedId, dormName: fromBed.dormName, action: "change-out", guestName: guestName || "", guestContact: guestContact || "" });
      await logBedHistoryEntry({ bedIdLabel: toBed.bedId, dormName: toBed.dormName, action: "change-in", guestName: guestName || "", guestContact: guestContact || "" });
      await addAuditEntry({ username: actingUser, action: "bed_change", target: `${fromBed.bedId} → ${toBed.bedId}` });
      return NextResponse.json({ success: true });
    }

    // --- Dorm Setup ---

    if (action === "initDorms") {
      const { dormName, bedCount, bedType } = rest;
      if (!dormName || !bedCount) return NextResponse.json({ error: "Missing data" }, { status: 400 });

      let dorm = await getDormByName(dormName.trim());
      if (!dorm) {
        await addDorm(dormName.trim());
        dorm = await getDormByName(dormName.trim());
      }
      if (!dorm) return NextResponse.json({ error: "Failed to create dorm" }, { status: 500 });

      const count = parseInt(bedCount) || 4;
      const prefix = dormName.trim().substring(0, 3).toUpperCase().replace(/[^A-Z]/g, "");

      for (let i = 1; i <= count; i++) {
        if (bedType === "Bunk2L1U") {
          const upperNum = (i - 1) * 2 + 1;
          const lowerNum = upperNum + 1;
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-${upperNum}`, position: "Upper", type: "Bunk2L1U" });
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-${lowerNum}a`, position: "Lower", type: "Bunk2L1U" });
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-${lowerNum}b`, position: "Lower", type: "Bunk2L1U" });
        } else if (bedType === "Double") {
          const firstBedNum = (i - 1) * 2 + 1;
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-${firstBedNum}`, position: "Lower", type: "Double" });
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-${firstBedNum + 1}`, position: "Lower", type: "Double" });
        } else if (bedType === "Single") {
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-${i}`, position: "Single", type: "Single" });
        } else {
          const upperNum = (i - 1) * 2 + 1;
          const lowerNum = upperNum + 1;
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-${upperNum}`, position: "Upper", type: "Bunk" });
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-${lowerNum}`, position: "Lower", type: "Bunk" });
        }
      }
      await addAuditEntry({ username: actingUser, action: "dorm_created", target: dormName.trim() });
      return NextResponse.json({ success: true });
    }

    if (action === "removeDorm") {
      const { dormName } = rest;
      if (!dormName) return NextResponse.json({ error: "Missing dorm name" }, { status: 400 });

      const dorm = await getDormByName(dormName);
      if (!dorm) return NextResponse.json({ error: "Dorm not found" }, { status: 404 });

      const db = getDb();
      const dormBeds = await db.select().from(beds).where(eq(beds.dormId, dorm.id));
      const hasOccupied = dormBeds.some((b) => b.status !== "available");
      if (hasOccupied) return NextResponse.json({ error: "Cannot delete dorm with occupied or cleanup beds" }, { status: 400 });

      await deleteDormAndBeds(dorm.id);
      await addAuditEntry({ username: actingUser, action: "dorm_deleted", target: dormName });
      return NextResponse.json({ success: true });
    }

    if (action === "removeBed") {
      const { bedId } = rest;
      if (!isValidId(bedId)) return NextResponse.json({ error: "Invalid bed ID" }, { status: 400 });

      const bed = await getBedById(bedId);
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed.status !== "available") return NextResponse.json({ error: "Can only remove available beds" }, { status: 400 });

      const unit = bed.type === "Double" ? sellableUnits(await getAllBeds()).find((u) => u.beds.some((b) => b.id === bed.id)) : undefined;
      const removal = unit?.beds || [bed];
      if (removal.some((slot) => slot.status !== "available")) {
        return NextResponse.json({ error: "Can only remove a double room when both guest slots are available" }, { status: 400 });
      }
      for (const slot of removal) if (slot.id != null) await deleteBed(slot.id);
      await addAuditEntry({ username: actingUser, action: "bed_removed", target: unit?.label || bed.bedId });
      return NextResponse.json({ success: true });
    }

    // --- User Management ---

    if (action === "getUsers") {
      const allUsers = await getAllUsers();
      const userList = allUsers.map((u) => ({
        id: u.id, username: u.username, displayName: u.displayName,
        role: u.role, permissions: JSON.parse(u.permissions || "{}"),
        createdAt: u.createdAt, isSystem: u.isSystem === 1,
      }));
      return NextResponse.json({ users: userList });
    }

    if (action === "createUser") {
      const { newUsername, displayName, userPassword: userPass, role: userRole, permissions: perms } = rest;
      if (!newUsername || !displayName || !userPass) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      const existing = await getUserByUsername(newUsername);
      if (existing) return NextResponse.json({ error: "Username already exists" }, { status: 409 });
      const passwordHash = await hashPassword(userPass);
      await createUser({ username: newUsername, passwordHash, displayName, role: userRole || "staff", permissions: JSON.stringify(perms || {}) });
      await addAuditEntry({ username: actingUser, action: "user_created", target: newUsername });
      return NextResponse.json({ success: true });
    }

    if (action === "updateUser") {
      const { userId, displayName, userPassword: userPass, role: userRole, permissions: perms } = rest;
      if (!isValidId(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
      const data: any = {};
      if (displayName) data.displayName = displayName;
      if (userRole) data.role = userRole;
      if (perms) data.permissions = JSON.stringify(perms);
      if (userPass) data.passwordHash = await hashPassword(userPass);
      await updateUser(userId, data);
      await addAuditEntry({ username: actingUser, action: "user_updated", target: `userId:${userId}` });
      return NextResponse.json({ success: true });
    }

    if (action === "deleteUser") {
      const { userId } = rest;
      if (!isValidId(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
      await deleteUserById(userId);
      await addAuditEntry({ username: actingUser, action: "user_deleted", target: `userId:${userId}` });
      return NextResponse.json({ success: true });
    }

    // --- Self-service Password Change ---

    if (action === "changeMyPassword") {
      const { currentPassword, newPassword } = rest;
      if (!currentPassword || !newPassword) return NextResponse.json({ error: "Current and new password required" }, { status: 400 });
      if (!username) return NextResponse.json({ error: "Password change only available for DB-based users" }, { status: 403 });

      const user = await getUserByUsername(username);
      if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });

      const newHash = await hashPassword(newPassword);
      await updateUser(user.id, { passwordHash: newHash });
      await addAuditEntry({ username: actingUser, action: "password_self_change", target: username });
      return NextResponse.json({ success: true });
    }

    // --- Undo Checkout ---

    if (action === "undoCheckout") {
      const { checkinId } = rest;
      if (!isValidId(checkinId)) return NextResponse.json({ error: "Invalid checkin ID" }, { status: 400 });
      const db = getDb();
      await db.update(checkins).set({ status: "active" }).where(eq(checkins.id, checkinId));
      await addAuditEntry({ username: actingUser, action: "undo_checkout", target: String(checkinId) });
      return NextResponse.json({ success: true });
    }

    // --- Audit & Logs ---

    if (action === "getAuditLog") {
      const entries = await getAuditEntries();
      return NextResponse.json({ entries });
    }

    if (action === "getAuditRetention") {
      return NextResponse.json(await getAuditRetention());
    }

    if (action === "setAuditRetention") {
      const years = Math.max(0, Math.floor(Number(rest.years)) || 0);
      const months = Math.max(0, Math.floor(Number(rest.months)) || 0);
      const requestedMonths = years * 12 + months;
      if (requestedMonths < 1) {
        return NextResponse.json({ error: "Retention must be at least 1 month" }, { status: 400 });
      }
      const totalMonths = normalizeAuditRetentionMonths(requestedMonths);
      await setSetting(AUDIT_RETENTION_SETTING, String(totalMonths));
      await addAuditEntry({
        username: actingUser,
        action: "audit_retention_updated",
        target: `${Math.floor(totalMonths / 12)} years ${totalMonths % 12} months`,
      });
      const cutoff = auditRetentionCutoff(totalMonths);
      return NextResponse.json({
        years: Math.floor(totalMonths / 12),
        months: totalMonths % 12,
        totalMonths,
        cutoff,
        eligible: await getAuditEntriesBefore(cutoff),
      });
    }

    if (action === "cleanupAuditLog") {
      const retention = await getAuditRetention();
      const deleted = await deleteAuditEntriesBefore(retention.cutoff);
      await addAuditEntry({
        username: actingUser,
        action: "audit_retention_cleanup",
        target: `before ${retention.cutoff}`,
        details: `${deleted.auditLog} general and ${deleted.bookingHistory} booking audit entries deleted`,
      });
      return NextResponse.json({ ...retention, deleted, eligible: { auditLog: 0, bookingHistory: 0, total: 0 } });
    }

    if (action === "getSystemLogs") {
      const { page, pageSize, offset } = logListQuery(rest);
      const { logs, total, sources } = await getSystemLogs(pageSize, {
        level: rest.level || undefined,
        source: rest.source || undefined,
        offset,
      });
      return NextResponse.json({ logs, total, page: logSafePage(total, pageSize, page), pageSize, sources });
    }

    if (action === "runBackup") {
      if (isOfflineMode()) {
        return NextResponse.json({ error: "Backup requires internet" }, { status: 503 });
      }
      await setSetting("last_backup", new Date().toISOString());
      await addAuditEntry({ username: actingUser, action: "backup_run", target: "manual" });
      return NextResponse.json({ success: true, message: "Backup timestamp recorded." });
    }

    // --- Bookings ---

    if (action === "getBookings") {
      const allBookings = await getAllBookings();
      return NextResponse.json({ bookings: allBookings });
    }

    if (action === "getUpcomingBookings") {
      const upcoming = await getUpcomingBookings();
      return NextResponse.json({ bookings: upcoming });
    }

    if (action === "addBooking") {
      const { guestName, contact, platform, bookingRef, checkinDate, checkoutDate, roomType, persons, paymentStatus, specialRequests, source, property } = rest;
      if (!guestName || !checkinDate || !platform) return NextResponse.json({ error: "Guest name, date, and platform required" }, { status: 400 });
      await addBooking({ guestName, contact, platform, bookingRef, checkinDate, checkoutDate, roomType, persons: parseInt(persons) || 1, paymentStatus, specialRequests, source, property });
      await addAuditEntry({ username: actingUser, action: "booking_added", target: `${guestName} (${platform})` });
      return NextResponse.json({ success: true });
    }

    if (action === "updateBookingStatus") {
      const { bookingId, status: bookingStatus } = rest;
      if (!isValidId(bookingId) || !bookingStatus) return NextResponse.json({ error: "Missing data" }, { status: 400 });
      await updateBookingStatus(bookingId, bookingStatus);
      await addAuditEntry({ username: actingUser, action: "booking_status_changed", target: `id:${bookingId} → ${bookingStatus}` });
      return NextResponse.json({ success: true });
    }

    if (action === "deleteBooking") {
      const { bookingId } = rest;
      if (!isValidId(bookingId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      await deleteBooking(bookingId);
      await addAuditEntry({ username: actingUser, action: "booking_deleted", target: `id:${bookingId}` });
      return NextResponse.json({ success: true });
    }

    // --- Rate Scrapes ---

    if (action === "getLatestRateScrape") {
      const { city: scrapeCity } = rest;
      const scrape = await getLatestRateScrape(scrapeCity || "Gokarna");
      return NextResponse.json({ scrape });
    }

    if (action === "getRateScrapeStatus") {
      const { scrapeId } = rest;
      if (!isValidId(scrapeId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      const scrape = await getRateScrapeById(scrapeId);
      return NextResponse.json({ scrape });
    }

    if (action === "startRateScrape") {
      if (isOfflineMode()) {
        return NextResponse.json({ error: "Rate scraping requires internet" }, { status: 503 });
      }
      const { city: scrapeCity, startDate: sDate, endDate: eDate, propertyType: pType, proxyUrl: pUrl } = rest;
      if (!scrapeCity || !sDate || !eDate) return NextResponse.json({ error: "City and dates required" }, { status: 400 });

      if (!process.env.GITHUB_TOKEN) {
        return NextResponse.json({ error: "GITHUB_TOKEN not configured. Add it in Cloudflare env vars." }, { status: 500 });
      }

      const scrape = await createRateScrape({ city: scrapeCity, startDate: sDate, endDate: eDate, propertyType: pType || "hostels" });
      await addAuditEntry({ username: actingUser, action: "rate_scrape_started", target: `${scrapeCity} ${sDate} → ${eDate}` });

      try {
        await triggerGithubScrape(scrape.id, scrapeCity, sDate, eDate, pType || "hostels", pUrl || "");
      } catch (err: any) {
        await updateRateScrape(scrape.id, { status: "failed", completedAt: new Date().toISOString() });
        return NextResponse.json({ error: `Failed to trigger scraper: ${err.message}` }, { status: 500 });
      }

      return NextResponse.json({ success: true, id: scrape.id });
    }

    if (action === "updateRateScrapeResults") {
      const { scrapeId, results, status: scrapeStatus } = rest;
      if (!isValidId(scrapeId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      try {
        parseRateResults(results);
        if (scrapeStatus && !["done", "partial", "failed"].includes(scrapeStatus)) throw new Error("Invalid status");
      } catch {
        return NextResponse.json({ error: "Invalid scrape results" }, { status: 400 });
      }
      await updateRateScrape(scrapeId, {
        results: typeof results === "string" ? results : JSON.stringify(results),
        status: scrapeStatus || "done",
        completedAt: new Date().toISOString(),
      });
      return NextResponse.json({ success: true });
    }

    if (action === "backfillManagerPermissions") {
      const db = getDb();
      const allUsers = await getAllUsers();
      const managers = allUsers.filter((u) => u.role === "manager");
      const ALL_PERMISSION_KEYS = [
        "canAddCheckin", "canAssignBed", "canCheckout", "canMarkClean", "canEditRecords", "canDeleteRecords",
        "canViewFoodOrders", "canPlaceOrders", "canManageInventory", "canMarkPaid",
        "canViewMenu", "canManageMenuCategories", "canManageMenuItems", "canToggleMenuAvailability", "canManageFoodSettings",
        "canViewExpenses", "canViewFoodBills", "canUseQRGenerator", "canManageAttendance", "canAddIncome",
        "canViewDashboard", "canViewBookings", "canViewBeds", "canViewTimeline", "canViewRecords", "canViewAccounts", "canViewSplits", "canViewManagement",
        "canAddBooking", "canCheckIn", "canCheckOut", "canDeleteBooking", "canManageBookingTemplates", "canViewAnalytics",
        "canAddExpense", "canEditExpense", "canDeleteExpense", "canViewFoodTabs", "canEditFoodOrders", "canVoidFoodOrders", "canApplyFoodDiscounts", "canGenerateFoodBills",
        "canReconcileAccounts", "canManageAccountSettings", "canManageVendors", "canManageEmployees", "canManagePayroll", "canViewInventory", "canManageRates", "canManageInventoryBlocks",
        "canSendReviewRequests", "canEditReviewRequests", "canManageReviewSettings",
        "canAddSplitExpense", "canEditSplitExpense", "canDeleteSplitExpense", "canSettleSplits", "canManageSplits",
      ];
      let updated = 0;
      for (const mgr of managers) {
        let existing: Record<string, boolean> = {};
        try { existing = JSON.parse(mgr.permissions || "{}"); } catch {}
        const merged = { ...existing };
        for (const key of ALL_PERMISSION_KEYS) {
          merged[key] = true;
        }
        await updateUser(mgr.id, { permissions: JSON.stringify(merged) });
        updated++;
      }
      await addAuditEntry({ username: actingUser, action: "backfill_manager_permissions", target: `${updated} managers updated` });
      return NextResponse.json({ success: true, updated });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin API error:", error?.message || error);
    try {
      await addSystemLog({ level: "error", source: "admin-checkins-api", message: error?.message || "Unknown error", details: error?.stack });
    } catch {}
    const raw = error?.message || "Internal server error";
    const userMessage = raw.includes("Failed query") || raw.includes("D1_ERROR")
      ? "Database temporarily unavailable. Please try again."
      : raw;
    return NextResponse.json({ error: userMessage, role }, { status: 500 });
  }
}
