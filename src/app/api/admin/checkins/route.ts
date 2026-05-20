import { NextRequest, NextResponse } from "next/server";
import { driveDeleteFile } from "@/lib/googleApiFetch";
import { getDb } from "@/db";
import {
  getCheckinsByMonth, addCheckin, updateCheckin, deleteCheckin, getCheckinMonths,
  getAllBeds, getBedById, updateBedStatus, getAllDorms, getDormByName, addDorm, addBed, deleteBed, deleteDormAndBeds,
  logBedHistoryEntry, getBedHistoryAll, deleteBedHistoryEntry,
  getSetting, setSetting,
  getAllStats, incrementStat, getMonthKey,
  getAllBookings, getUpcomingBookings, addBooking, updateBookingStatus, deleteBooking,
  getAllUsers, getUserByUsername, createUser, updateUser, deleteUser as deleteUserById,
  addAuditEntry, getAuditEntries,
  addSystemLog, getSystemLogs,
} from "@/db/queries";
import { beds, checkins } from "@/db/schema";
import { eq, and } from "drizzle-orm";

type UserRole = "admin" | "manager" | "staff";

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "goko-salt-2026");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password);
  return computed === hash;
}

async function authenticateUser(password: string, username?: string): Promise<UserRole | null> {
  if (!password) return null;

  if (!username) {
    if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) return "admin";
    if (process.env.MANAGER_PASSWORD && password === process.env.MANAGER_PASSWORD) return "manager";
    return null;
  }

  if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD && username === "admin") return "admin";
  if (process.env.MANAGER_PASSWORD && password === process.env.MANAGER_PASSWORD && username === "manager") return "manager";

  try {
    const user = await getUserByUsername(username);
    if (!user) return null;
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return null;
    return (user.role as UserRole) || "manager";
  } catch {
    return null;
  }
}

function isValidId(val: any): val is number {
  return typeof val === "number" && Number.isInteger(val) && val >= 0;
}

export async function POST(req: NextRequest) {
  let role: UserRole | null = null;

  try {
    const body = await req.json();
    const { password, action, month, username, ...rest } = body;

    role = await authenticateUser(password, username);
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actingUser = username || role;

    // --- Check-in Records ---

    if (action === "list" || !action) {
      const tabName = month || getMonthKey();
      const dbRows = await getCheckinsByMonth(tabName);
      const rows = dbRows.map((r) => [
        r.submittedAt, r.arrivalDate, r.arrivalTime, r.name, r.persons,
        r.contact, r.stayingDays, r.comingFrom, r.nationality, r.emergencyName,
        r.emergencyPhone, r.idType, r.idCardLink, r.visaLink, r.verified,
        String(r.id), r.status || "active", r.checkedOutAt || "",
      ]);
      const months = await getCheckinMonths();
      return NextResponse.json({ rows, role, tabs: months, currentTab: tabName });
    }

    if (action === "add") {
      const { entry } = rest;
      if (!entry) return NextResponse.json({ error: "No entry data" }, { status: 400 });

      const e = Array.isArray(entry) ? entry : [];
      await addCheckin({
        submittedAt: e[0] || new Date().toISOString(),
        arrivalDate: e[1] || "", arrivalTime: e[2] || "", name: e[3] || "",
        persons: e[4] || "1", contact: e[5] || "", stayingDays: e[6] || "1",
        comingFrom: e[7] || "", nationality: e[8] || "", emergencyName: e[9] || "",
        emergencyPhone: e[10] || "", idType: e[11] || "", idCardLink: e[12] || "",
        visaLink: e[13] || "", verified: e[14] || "pending", createdMonth: getMonthKey(),
      });
      await addAuditEntry({ username: actingUser, action: "checkin_add", target: e[3] || "unknown" });
      return NextResponse.json({ success: true });
    }

    if (action === "update") {
      if (role !== "admin") return NextResponse.json({ error: "Only admin can modify entries" }, { status: 403 });
      const { rowId, entry } = rest;
      if (!isValidId(rowId) || !entry) return NextResponse.json({ error: "Missing data" }, { status: 400 });

      const e = Array.isArray(entry) ? entry : null;
      const data = e ? {
        submittedAt: e[0], arrivalDate: e[1], arrivalTime: e[2], name: e[3],
        persons: e[4], contact: e[5], stayingDays: e[6], comingFrom: e[7],
        nationality: e[8], emergencyName: e[9], emergencyPhone: e[10],
        idType: e[11], idCardLink: e[12], visaLink: e[13], verified: e[14],
      } : entry;

      await updateCheckin(rowId, data);
      await addAuditEntry({ username: actingUser, action: "record_edit", target: String(rowId) });
      return NextResponse.json({ success: true });
    }

    if (action === "delete") {
      if (role !== "admin") return NextResponse.json({ error: "Only admin can delete entries" }, { status: 403 });
      const { rowId, driveFileIds } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

      await deleteCheckin(rowId);

      if (driveFileIds && driveFileIds.length > 0) {
        for (const fileId of driveFileIds) {
          try { await driveDeleteFile(fileId); } catch (err: any) {
            console.error(`Failed to delete Drive file ${fileId}:`, err?.message);
          }
        }
      }
      await addAuditEntry({ username: actingUser, action: "record_delete", target: String(rowId) });
      return NextResponse.json({ success: true });
    }

    if (action === "verifyCheckin") {
      const { rowId, verified } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      await updateCheckin(rowId, { verified: verified ? "yes" : "no" });
      await addAuditEntry({ username: actingUser, action: "verify_id", target: String(rowId) });
      return NextResponse.json({ success: true });
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
      if (role !== "admin") return NextResponse.json({ error: "Only admin can change settings" }, { status: 403 });
      const { key, value } = rest;
      await setSetting(key, value);
      await addAuditEntry({ username: actingUser, action: "setting_changed", target: key });
      return NextResponse.json({ success: true });
    }

    // --- Bed History ---

    if (action === "getBedHistory") {
      const dbRows = await getBedHistoryAll();
      const rows = dbRows.map((r) => [r.createdAt, r.bedIdLabel, r.dormName, r.action, r.guestName, r.guestContact, String(r.id)]);
      return NextResponse.json({ rows, role });
    }

    if (action === "deleteBedHistory") {
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const { rowId } = rest;
      if (!isValidId(rowId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      await deleteBedHistoryEntry(rowId);
      return NextResponse.json({ success: true });
    }

    // --- Dashboard ---

    if (action === "getDashboard") {
      const monthKey = getMonthKey();
      const allCheckins = await getCheckinsByMonth(monthKey);
      const today = new Date().toISOString().split("T")[0];
      const todayCheckins = allCheckins.filter((r) => r.arrivalDate === today && r.status === "active");

      const allBeds = await getAllBeds();
      const total = allBeds.length;
      const occupied = allBeds.filter((b) => b.status === "occupied").length;
      const available = allBeds.filter((b) => b.status === "available").length;
      const cleanup = allBeds.filter((b) => b.status === "cleanup").length;

      const todayCheckoutBeds = allBeds.filter((b) => b.status === "occupied" && b.expectedCheckout && b.expectedCheckout <= today)
        .map((b) => ({ name: b.guestName || "", contact: b.guestContact || "", bedId: b.bedId, dorm: b.dormName, bedIdx: b.id, expectedCheckout: b.expectedCheckout || "" }));

      const assignedContacts = new Map<string, string>();
      for (const b of allBeds) {
        if (b.status === "occupied" && b.guestContact) assignedContacts.set(b.guestContact, `${b.dormName} / ${b.bedId}`);
      }

      const todayCheckinsWithBed = todayCheckins.map((r) => ({
        row: [r.submittedAt, r.arrivalDate, r.arrivalTime, r.name, r.persons, r.contact, r.stayingDays, r.comingFrom, r.nationality, r.emergencyName, r.emergencyPhone, r.idType, r.idCardLink, r.visaLink, r.verified, String(r.id)],
        assignedBed: assignedContacts.get(r.contact) || null,
      }));

      const validationEnabled = (await getSetting("image_validation")) !== "off";

      return NextResponse.json({
        todayCheckins: todayCheckinsWithBed,
        todayCheckouts: todayCheckoutBeds,
        stats: { total, occupied, available, cleanup },
        validationEnabled,
        role,
      });
    }

    // --- Beds ---

    if (action === "getBeds") {
      const allBeds = await getAllBeds();
      const monthKey = getMonthKey();
      const monthCheckins = await getCheckinsByMonth(monthKey);

      const assignedContacts = new Set(allBeds.filter((b) => b.status === "occupied" && b.guestContact).map((b) => b.guestContact));
      const unassignedCheckins = monthCheckins.filter((r) => r.contact && r.status === "active" && !assignedContacts.has(r.contact));

      const bedsArr = allBeds.map((b) => [
        b.dormName, b.bedId, b.position, b.type, b.status,
        b.guestName, b.guestContact, b.checkinDate, b.expectedCheckout, b.stayingDays,
        String(b.id),
      ]);
      const unassignedArr = unassignedCheckins.map((r) => [
        r.submittedAt, r.arrivalDate, r.arrivalTime, r.name, r.persons,
        r.contact, r.stayingDays, r.comingFrom, r.nationality, r.emergencyName,
        r.emergencyPhone, r.idType, r.idCardLink, r.visaLink, r.verified,
        String(r.id),
      ]);

      return NextResponse.json({ beds: bedsArr, unassigned: unassignedArr, role });
    }

    if (action === "assignBed") {
      const { bedId, guestName, guestContact, checkinDate, stayingDays } = rest;
      if (!isValidId(bedId) || !guestName) return NextResponse.json({ error: "Missing data" }, { status: 400 });

      const bed = await getBedById(bedId);
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed.status !== "available") return NextResponse.json({ error: "Bed is not available" }, { status: 400 });

      const days = parseInt(stayingDays) || 1;
      const checkin = checkinDate || new Date().toISOString().split("T")[0];
      const coDate = new Date(checkin + "T12:00:00Z");
      coDate.setUTCDate(coDate.getUTCDate() + days);
      const checkoutDate = coDate.toISOString().split("T")[0];

      await updateBedStatus(bedId, { status: "occupied", guestName, guestContact: guestContact || "", checkinDate: checkin, expectedCheckout: checkoutDate, stayingDays: String(days) });
      await logBedHistoryEntry({ bedIdLabel: bed.bedId, dormName: bed.dormName, action: "assign", guestName, guestContact: guestContact || "" });
      await addAuditEntry({ username: actingUser, action: "bed_assign", target: `${bed.bedId} ${guestName}` });
      return NextResponse.json({ success: true });
    }

    if (action === "checkoutBed") {
      const { bedId } = rest;
      if (!isValidId(bedId)) return NextResponse.json({ error: "Invalid bed ID" }, { status: 400 });

      const bed = await getBedById(bedId);
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed.status !== "occupied") return NextResponse.json({ error: "Bed is not occupied" }, { status: 400 });

      await logBedHistoryEntry({ bedIdLabel: bed.bedId, dormName: bed.dormName, action: "checkout", guestName: bed.guestName || "", guestContact: bed.guestContact || "" });
      await updateBedStatus(bedId, { status: "cleanup" });

      if (bed.guestContact) {
        try {
          const db = getDb();
          await db.update(checkins).set({ status: "checked_out", checkedOutAt: new Date().toISOString() }).where(
            and(eq(checkins.contact, bed.guestContact), eq(checkins.status, "active"))
          );
        } catch {}
      }

      await addAuditEntry({ username: actingUser, action: "bed_checkout", target: `${bed.bedId} ${bed.guestName || ""}` });
      return NextResponse.json({ success: true });
    }

    if (action === "markClean") {
      const { bedId } = rest;
      if (!isValidId(bedId)) return NextResponse.json({ error: "Invalid bed ID" }, { status: 400 });

      const bed = await getBedById(bedId);
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed.status !== "cleanup") return NextResponse.json({ error: "Bed is not in cleanup status" }, { status: 400 });

      await logBedHistoryEntry({ bedIdLabel: bed.bedId, dormName: bed.dormName, action: "markClean", guestName: "", guestContact: "" });
      await updateBedStatus(bedId, { status: "available" });
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
      await updateBedStatus(bedId, { status: "available" });
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

      const { guestName, guestContact, checkinDate, expectedCheckout, stayingDays } = fromBed;
      await updateBedStatus(fromBedId, { status: "cleanup" });
      await updateBedStatus(toBedId, { status: "occupied", guestName: guestName || "", guestContact: guestContact || "", checkinDate: checkinDate || "", expectedCheckout: expectedCheckout || "", stayingDays: stayingDays || "" });
      await logBedHistoryEntry({ bedIdLabel: fromBed.bedId, dormName: fromBed.dormName, action: "change-out", guestName: guestName || "", guestContact: guestContact || "" });
      await logBedHistoryEntry({ bedIdLabel: toBed.bedId, dormName: toBed.dormName, action: "change-in", guestName: guestName || "", guestContact: guestContact || "" });
      await addAuditEntry({ username: actingUser, action: "bed_change", target: `${fromBed.bedId} → ${toBed.bedId}` });
      return NextResponse.json({ success: true });
    }

    // --- Dorm Setup ---

    if (action === "initDorms") {
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
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
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-U${i}`, position: "Upper", type: "Bunk2L1U" });
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-LA${i}`, position: "Lower", type: "Bunk2L1U" });
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-LB${i}`, position: "Lower", type: "Bunk2L1U" });
        } else if (bedType === "Single") {
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-S${i}`, position: "Single", type: "Single" });
        } else {
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-U${i}`, position: "Upper", type: "Bunk" });
          await addBed({ dormId: dorm.id, dormName: dorm.name, bedId: `${prefix}-L${i}`, position: "Lower", type: "Bunk" });
        }
      }
      await addAuditEntry({ username: actingUser, action: "dorm_created", target: dormName.trim() });
      return NextResponse.json({ success: true });
    }

    if (action === "removeDorm") {
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
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
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const { bedId } = rest;
      if (!isValidId(bedId)) return NextResponse.json({ error: "Invalid bed ID" }, { status: 400 });

      const bed = await getBedById(bedId);
      if (!bed) return NextResponse.json({ error: "Bed not found" }, { status: 404 });
      if (bed.status !== "available") return NextResponse.json({ error: "Can only remove available beds" }, { status: 400 });

      await deleteBed(bedId);
      await addAuditEntry({ username: actingUser, action: "bed_removed", target: bed.bedId });
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
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const { username: newUsername, displayName, password: userPass, role: userRole, permissions: perms } = rest;
      if (!newUsername || !displayName || !userPass) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      const existing = await getUserByUsername(newUsername);
      if (existing) return NextResponse.json({ error: "Username already exists" }, { status: 409 });
      const passwordHash = await hashPassword(userPass);
      await createUser({ username: newUsername, passwordHash, displayName, role: userRole || "staff", permissions: JSON.stringify(perms || {}) });
      await addAuditEntry({ username: actingUser, action: "user_created", target: newUsername });
      return NextResponse.json({ success: true });
    }

    if (action === "updateUser") {
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const { userId, displayName, password: userPass, role: userRole, permissions: perms } = rest;
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
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const { userId } = rest;
      if (!isValidId(userId)) return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
      await deleteUserById(userId);
      await addAuditEntry({ username: actingUser, action: "user_deleted", target: `userId:${userId}` });
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

    if (action === "getSystemLogs") {
      const logs = await getSystemLogs();
      return NextResponse.json({ logs });
    }

    if (action === "runBackup") {
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
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
      const { guestName, contact, platform, bookingRef, checkinDate, checkoutDate, roomType, persons, paymentStatus, specialRequests, source } = rest;
      if (!guestName || !checkinDate || !platform) return NextResponse.json({ error: "Guest name, date, and platform required" }, { status: 400 });
      await addBooking({ guestName, contact, platform, bookingRef, checkinDate, checkoutDate, roomType, persons: parseInt(persons) || 1, paymentStatus, specialRequests, source });
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
      if (role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const { bookingId } = rest;
      if (!isValidId(bookingId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
      await deleteBooking(bookingId);
      await addAuditEntry({ username: actingUser, action: "booking_deleted", target: `id:${bookingId}` });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin API error:", error?.message || error);
    try {
      await addSystemLog({ level: "error", source: "admin-checkins-api", message: error?.message || "Unknown error", details: error?.stack });
    } catch {}
    return NextResponse.json({ error: error?.message || "Internal server error", role }, { status: 500 });
  }
}
