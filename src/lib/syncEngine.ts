import { eq, and, gt, sql, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import type { Database } from "@/db";
import * as schema from "@/db/schema";
import { getRuntimeName, getBuildVersion } from "@/lib/runtime";
import { rebuildBookingPaymentProjection } from "@/lib/bookingPaymentJournal";
import { collectInBatches } from "@/lib/dbBatch";

// --- Table Configuration ---

const SYNCED_TABLES_WITH_DELETE = [
  "checkins", "dorms", "beds", "bookings", "menu_categories", "menu_items",
  "food_orders", "accounts", "vendors", "employees", "users", "tasks", "expenses", "daily_income",
  "employee_attendance", "employee_leave_policy", "employee_compensation_history",
  "platform_payment_profiles",
] as const;

const SYNCED_TABLES_APPEND = [
  "bed_history", "food_order_items", "order_modifications", "salary_payments",
  "daily_ledger", "qr_history", "booking_cycle_snapshots", "booking_payment_events", "guest_receipts",
  "employee_attendance_history",
  "platform_receivable_entries", "platform_settlements", "platform_settlement_allocations",
] as const;

const SYNCABLE_SETTINGS = [
  "image_validation", "guest_min_age", "guest_max_age", "show_dob_in_records",
  "log_level", "food_tax_rate", "booking_tax_rate", "food_kitchen_hours", "food_tab_limit",
  "food_kitchen_busy", "food_confirm_with_guest", "food_kannada_labels",
  "food_cafe_tables", "primary_server",
  "food_online_receipt_account_id", "room_online_receipt_account_id",
  "expense_categories", "income_categories",
] as const;

// --- Table Name to Drizzle Schema Mapping ---

const TABLE_MAP: Record<string, any> = {
  checkins: schema.checkins,
  dorms: schema.dorms,
  beds: schema.beds,
  bookings: schema.bookings,
  menu_categories: schema.menuCategories,
  menu_items: schema.menuItems,
  food_orders: schema.foodOrders,
  accounts: schema.accounts,
  vendors: schema.vendors,
  employees: schema.employees,
  employee_attendance: schema.employeeAttendance,
  employee_attendance_history: schema.employeeAttendanceHistory,
  employee_leave_policy: schema.employeeLeavePolicy,
  employee_compensation_history: schema.employeeCompensationHistory,
  expenses: schema.expenses,
  tasks: schema.tasks,
  daily_income: schema.dailyIncome,
  users: schema.users,
  bed_history: schema.bedHistory,
  food_order_items: schema.foodOrderItems,
  order_modifications: schema.orderModifications,
  salary_payments: schema.salaryPayments,
  daily_ledger: schema.dailyLedger,
  qr_history: schema.qrHistory,
  guest_receipts: schema.guestReceipts,
  booking_cycle_snapshots: schema.bookingCycleSnapshots,
  booking_payment_events: schema.bookingPaymentEvents,
  platform_payment_profiles: schema.platformPaymentProfiles,
  platform_receivable_entries: schema.platformReceivableEntries,
  platform_settlements: schema.platformSettlements,
  platform_settlement_allocations: schema.platformSettlementAllocations,
  settings: schema.settings,
};

// FK columns that need remapping per table (column name -> parent table name)
const FK_REMAP: Record<string, Record<string, string>> = {
  beds: { dormId: "dorms" },
  menu_items: { categoryId: "menu_categories" },
  food_orders: { checkinId: "checkins" },
  food_order_items: { orderId: "food_orders", menuItemId: "menu_items" },
  order_modifications: { orderId: "food_orders" },
  salary_payments: { employeeId: "employees", accountId: "accounts" },
  employee_attendance: { employeeId: "employees" },
  employee_attendance_history: { employeeId: "employees" },
  employee_leave_policy: { employeeId: "employees" },
  employee_compensation_history: { employeeId: "employees" },
  daily_income: { accountId: "accounts" },
  daily_ledger: { accountId: "accounts" },
  expenses: { vendorId: "vendors", accountId: "accounts", taskId: "tasks" },
  tasks: { assigneeUserId: "users" },
  guest_receipts: { accountId: "accounts" },
  booking_cycle_snapshots: { bookingId: "bookings" },
  booking_payment_events: { bookingId: "bookings", accountId: "accounts" },
  platform_payment_profiles: { virtualAccountId: "accounts" },
  platform_receivable_entries: { bookingId: "bookings" },
  platform_settlements: { bankAccountId: "accounts" },
  platform_settlement_allocations: { settlementId: "platform_settlements", bookingId: "bookings" },
};

/** Parse an FK integer from a sync payload. null/"" must not become 0. */
export function parseSyncFkId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// --- Types ---

export interface SyncRecord {
  syncId: string;
  data: Record<string, any>;
  syncUpdatedAt: string;
  syncSource: string;
  deletedAt?: string | null;
}

export interface SyncPayload {
  table: string;
  records: SyncRecord[];
  cursor?: string;
  hasMore?: boolean;
}

export interface SyncPullRequest {
  action: "pull";
  since: string;
  tables?: string[];
  limit?: number;
}

export interface SyncPushRequest {
  action: "push";
  source: "pi" | "cloudflare";
  bundles: SyncBundle[];
}

export interface SyncBundle {
  table: string;
  records: SyncRecord[];
  children?: { table: string; records: SyncRecord[] }[];
}

export interface SyncResult {
  applied: number;
  conflicts: SyncConflictRecord[];
  idMappings: { table: string; syncId: string; localId: number; remoteId: number }[];
}

export interface SyncConflictRecord {
  tableName: string;
  syncId: string;
  conflictType: "update_update" | "update_delete" | "unique_violation";
  cloudData: Record<string, any>;
  piData: Record<string, any>;
  cloudUpdatedAt: string;
  piUpdatedAt: string;
}

export interface HeartbeatPayload {
  server: "cloudflare" | "pi";
  buildVersion: string;
  uptime: string;
  dbCounts: Record<string, number>;
  lastSync: string;
  pendingChanges: number;
  unresolvedConflicts: number;
  primaryServer: string;
}

// --- Sync ID Generation ---

export function generateSyncId(): string {
  return crypto.randomUUID();
}

// --- Table Helpers ---

export function getSyncableTableNames(): string[] {
  return [
    ...SYNCED_TABLES_WITH_DELETE,
    ...SYNCED_TABLES_APPEND,
  ];
}

export function getTableSchema(tableName: string) {
  const table = TABLE_MAP[tableName];
  if (!table) throw new Error(`Unknown sync table: ${tableName}`);
  return table;
}

function hasSoftDelete(tableName: string): boolean {
  return (SYNCED_TABLES_WITH_DELETE as readonly string[]).includes(tableName);
}

function isSettingsKey(key: string): boolean {
  return (SYNCABLE_SETTINGS as readonly string[]).includes(key);
}

// --- Pull: Prepare Response ---

export async function preparePullResponse(
  db: Database,
  since: string,
  tables?: string[],
  limit = 200,
): Promise<SyncPayload[]> {
  const payloads: SyncPayload[] = [];
  const tableNames = tables?.length
    ? tables.filter((t) => getSyncableTableNames().includes(t))
    : getSyncableTableNames();

  for (const tableName of tableNames) {
    const table = getTableSchema(tableName);
    const rows = await db
      .select()
      .from(table)
      .where(gt(table.syncUpdatedAt, since))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    if (pageRows.length === 0) continue;

    const records: SyncRecord[] = pageRows.map((row: any) => ({
      syncId: row.syncId,
      data: row,
      syncUpdatedAt: row.syncUpdatedAt,
      syncSource: row.syncSource,
      deletedAt: row.deletedAt ?? null,
    }));

    const cursor = hasMore
      ? pageRows[pageRows.length - 1].syncUpdatedAt
      : undefined;

    payloads.push({ table: tableName, records, cursor, hasMore });
  }

  // Settings sync
  if (!tables || tables.includes("settings")) {
    const settingsRows = await db
      .select()
      .from(schema.settings)
      .where(gt(schema.settings.syncUpdatedAt, since));

    const syncableSettings = settingsRows.filter((r) => isSettingsKey(r.key));
    if (syncableSettings.length > 0) {
      payloads.push({
        table: "settings",
        records: syncableSettings.map((r) => ({
          syncId: r.key,
          data: { key: r.key, value: r.value },
          syncUpdatedAt: r.syncUpdatedAt || since,
          syncSource: r.syncSource || "cloudflare",
          deletedAt: null,
        })),
      });
    }
  }

  return payloads;
}

// --- Pull: Apply Records Locally ---

export async function applyPullRecords(
  db: Database,
  payloads: SyncPayload[],
  source: "pi" | "cloudflare",
): Promise<SyncResult> {
  let applied = 0;
  const conflicts: SyncConflictRecord[] = [];
  const idMappings: SyncResult["idMappings"] = [];

  for (const payload of payloads) {
    if (payload.table === "settings") {
      for (const record of payload.records) {
        if (!isSettingsKey(record.syncId)) continue;
        const existing = await db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, record.syncId));

        if (existing.length > 0 && existing[0].syncUpdatedAt && existing[0].syncUpdatedAt > record.syncUpdatedAt) {
          continue; // local is newer
        }

        await db.insert(schema.settings).values({
          key: record.syncId,
          value: record.data.value,
          syncUpdatedAt: record.syncUpdatedAt,
          syncSource: record.syncSource,
        }).onConflictDoUpdate({
          target: schema.settings.key,
          set: {
            value: record.data.value,
            syncUpdatedAt: record.syncUpdatedAt,
            syncSource: record.syncSource,
          },
        });
        applied++;
      }
      continue;
    }

    const table = getTableSchema(payload.table);

    for (const record of payload.records) {
      if (!record.syncId) continue;

      const existing = await db
        .select()
        .from(table)
        .where(eq(table.syncId, record.syncId));

      if (existing.length > 0) {
        const local = existing[0];
        const conflict = detectConflict(
          { syncUpdatedAt: local.syncUpdatedAt, syncSource: local.syncSource, deletedAt: local.deletedAt },
          { syncUpdatedAt: record.syncUpdatedAt, syncSource: record.syncSource, deletedAt: record.deletedAt },
          source,
        );

        if (conflict) {
          const conflictRecord: SyncConflictRecord = {
            tableName: payload.table,
            syncId: record.syncId,
            conflictType: conflict,
            cloudData: source === "pi" ? record.data : local,
            piData: source === "pi" ? local : record.data,
            cloudUpdatedAt: source === "pi" ? record.syncUpdatedAt : local.syncUpdatedAt,
            piUpdatedAt: source === "pi" ? local.syncUpdatedAt : record.syncUpdatedAt,
          };
          conflicts.push(conflictRecord);
          await db.insert(schema.syncConflicts).values({
            tableName: payload.table,
            syncId: record.syncId,
            conflictType: conflict,
            cloudData: JSON.stringify(conflictRecord.cloudData),
            piData: JSON.stringify(conflictRecord.piData),
            cloudUpdatedAt: conflictRecord.cloudUpdatedAt,
            piUpdatedAt: conflictRecord.piUpdatedAt,
            createdAt: new Date().toISOString(),
          });
          continue;
        }

        // No conflict — apply if remote is newer
        if (record.syncUpdatedAt > (local.syncUpdatedAt || "")) {
          const updateData = await prepareRecordForWrite(db, payload.table, record.data);
          await db.update(table).set({
            ...updateData,
            syncUpdatedAt: record.syncUpdatedAt,
            syncSource: record.syncSource,
            ...(hasSoftDelete(payload.table) ? { deletedAt: record.deletedAt || null } : {}),
          }).where(eq(table.syncId, record.syncId));
          applied++;
        }
      } else {
        // New record — insert with FK remapping
        const dataWithoutId = await prepareRecordForWrite(db, payload.table, record.data);

        const result = await db.insert(table).values({
          ...dataWithoutId,
          syncId: record.syncId,
          syncUpdatedAt: record.syncUpdatedAt,
          syncSource: record.syncSource,
          ...(hasSoftDelete(payload.table) ? { deletedAt: record.deletedAt || null } : {}),
        }).returning() as any[];

        const localId = result[0]?.id;
        if (localId && record.data.id) {
          await db.insert(schema.syncIdMap).values({
            tableName: payload.table,
            syncId: record.syncId,
            localId,
            remoteId: record.data.id,
          }).onConflictDoUpdate({
            target: [schema.syncIdMap.tableName, schema.syncIdMap.syncId],
            set: { localId, remoteId: record.data.id },
          });
          idMappings.push({
            table: payload.table,
            syncId: record.syncId,
            localId,
            remoteId: record.data.id,
          });
        }
        applied++;
      }
    }
  }

  const paymentEventIds = payloads.filter((payload) => payload.table === "booking_payment_events")
    .flatMap((payload) => payload.records.map((record) => record.syncId));
  await rebuildSyncedPaymentCycles(db, paymentEventIds);

  return { applied, conflicts, idMappings };
}

// --- Push: Prepare Payload ---

export async function preparePushPayload(
  db: Database,
  since: string,
  source: "pi" | "cloudflare",
): Promise<SyncBundle[]> {
  const bundles: SyncBundle[] = [];

  for (const tableName of getSyncableTableNames()) {
    if (tableName === "food_order_items" || tableName === "order_modifications") {
      continue; // bundled with food_orders
    }

    const table = getTableSchema(tableName);
    const rows = await db
      .select()
      .from(table)
      .where(
        and(
          eq(table.syncSource, source),
          gt(table.syncUpdatedAt, since),
        ),
      );

    if (rows.length === 0) continue;

    if (tableName === "food_orders") {
      // Bundle food orders with their items and modifications
      for (const order of rows) {
        const items = await db
          .select()
          .from(schema.foodOrderItems)
          .where(eq(schema.foodOrderItems.orderId, order.id));

        const mods = await db
          .select()
          .from(schema.orderModifications)
          .where(eq(schema.orderModifications.orderId, order.id));

        const bundle: SyncBundle = {
          table: "food_orders",
          records: [rowToSyncRecord(order)],
          children: [],
        };

        if (items.length > 0) {
          bundle.children!.push({
            table: "food_order_items",
            records: items.map(rowToSyncRecord),
          });
        }
        if (mods.length > 0) {
          bundle.children!.push({
            table: "order_modifications",
            records: mods.map(rowToSyncRecord),
          });
        }

        bundles.push(bundle);
      }
    } else {
      bundles.push({
        table: tableName,
        records: rows.map(rowToSyncRecord),
      });
    }
  }

  return bundles;
}

// --- Push: Apply Records ---

export async function applyPushRecords(
  db: Database,
  bundles: SyncBundle[],
  source: "pi" | "cloudflare",
): Promise<SyncResult> {
  let applied = 0;
  const conflicts: SyncConflictRecord[] = [];
  const idMappings: SyncResult["idMappings"] = [];

  for (const bundle of bundles) {
    const parentResult = await applyBundleRecords(
      db, bundle.table, bundle.records, source, conflicts, idMappings,
    );
    applied += parentResult;

    if (bundle.children) {
      for (const child of bundle.children) {
        const childResult = await applyBundleRecords(
          db, child.table, child.records, source, conflicts, idMappings,
        );
        applied += childResult;
      }
    }
  }

  const paymentEventIds = bundles.flatMap((bundle) => [
    ...(bundle.table === "booking_payment_events" ? bundle.records : []),
    ...(bundle.children || []).filter((child) => child.table === "booking_payment_events").flatMap((child) => child.records),
  ]).map((record) => record.syncId);
  await rebuildSyncedPaymentCycles(db, paymentEventIds);

  return { applied, conflicts, idMappings };
}

async function rebuildSyncedPaymentCycles(db: Database, eventIds: string[]) {
  const ids = [...new Set(eventIds.filter(Boolean))];
  if (ids.length === 0) return;
  const rows = await collectInBatches(ids, (batch) => db.select({ bookingId: schema.bookingPaymentEvents.bookingId, bookingCycle: schema.bookingPaymentEvents.bookingCycle })
    .from(schema.bookingPaymentEvents).where(inArray(schema.bookingPaymentEvents.syncId, batch)));
  const cycles = new Set(rows.map((row) => `${row.bookingId}:${row.bookingCycle}`));
  for (const key of cycles) {
    const [bookingId, bookingCycle] = key.split(":").map(Number);
    await rebuildBookingPaymentProjection(bookingId, bookingCycle, db);
  }
}

async function applyBundleRecords(
  db: Database,
  tableName: string,
  records: SyncRecord[],
  source: "pi" | "cloudflare",
  conflicts: SyncConflictRecord[],
  idMappings: SyncResult["idMappings"],
): Promise<number> {
  const table = getTableSchema(tableName);
  let applied = 0;

  for (const record of records) {
    if (!record.syncId) continue;

    const existing = await db
      .select()
      .from(table)
      .where(eq(table.syncId, record.syncId));

    if (existing.length > 0) {
      const local = existing[0];
      const conflict = detectConflict(
        { syncUpdatedAt: local.syncUpdatedAt, syncSource: local.syncSource, deletedAt: local.deletedAt },
        { syncUpdatedAt: record.syncUpdatedAt, syncSource: record.syncSource, deletedAt: record.deletedAt },
        source,
      );

      if (conflict) {
        const conflictRecord: SyncConflictRecord = {
          tableName,
          syncId: record.syncId,
          conflictType: conflict,
          cloudData: source === "pi" ? local : record.data,
          piData: source === "pi" ? record.data : local,
          cloudUpdatedAt: source === "pi" ? local.syncUpdatedAt : record.syncUpdatedAt,
          piUpdatedAt: source === "pi" ? record.syncUpdatedAt : local.syncUpdatedAt,
        };
        conflicts.push(conflictRecord);
        await db.insert(schema.syncConflicts).values({
          tableName,
          syncId: record.syncId,
          conflictType: conflict,
          cloudData: JSON.stringify(conflictRecord.cloudData),
          piData: JSON.stringify(conflictRecord.piData),
          cloudUpdatedAt: conflictRecord.cloudUpdatedAt,
          piUpdatedAt: conflictRecord.piUpdatedAt,
          createdAt: new Date().toISOString(),
        });
        continue;
      }

      if (record.syncUpdatedAt > (local.syncUpdatedAt || "")) {
        const updateData = await prepareRecordForWrite(db, tableName, record.data);
        await db.update(table).set({
          ...updateData,
          syncUpdatedAt: record.syncUpdatedAt,
          syncSource: record.syncSource,
          ...(hasSoftDelete(tableName) ? { deletedAt: record.deletedAt || null } : {}),
        }).where(eq(table.syncId, record.syncId));
        applied++;
      }
    } else {
      const dataWithoutId = await prepareRecordForWrite(db, tableName, record.data);

      try {
        const result = await db.insert(table).values({
          ...dataWithoutId,
          syncId: record.syncId,
          syncUpdatedAt: record.syncUpdatedAt,
          syncSource: record.syncSource,
          ...(hasSoftDelete(tableName) ? { deletedAt: record.deletedAt || null } : {}),
        }).returning() as any[];

        const localId = result[0]?.id;
        if (localId && record.data.id) {
          await db.insert(schema.syncIdMap).values({
            tableName,
            syncId: record.syncId,
            localId,
            remoteId: record.data.id,
          }).onConflictDoUpdate({
            target: [schema.syncIdMap.tableName, schema.syncIdMap.syncId],
            set: { localId, remoteId: record.data.id },
          });
          idMappings.push({
            table: tableName,
            syncId: record.syncId,
            localId,
            remoteId: record.data.id,
          });
        }
        applied++;
      } catch (err: any) {
        if (err?.message?.includes("UNIQUE constraint")) {
          conflicts.push({
            tableName,
            syncId: record.syncId,
            conflictType: "unique_violation",
            cloudData: source === "pi" ? {} : record.data,
            piData: source === "pi" ? record.data : {},
            cloudUpdatedAt: source === "pi" ? "" : record.syncUpdatedAt,
            piUpdatedAt: source === "pi" ? record.syncUpdatedAt : "",
          });
          await db.insert(schema.syncConflicts).values({
            tableName,
            syncId: record.syncId,
            conflictType: "unique_violation",
            cloudData: JSON.stringify(source === "pi" ? {} : record.data),
            piData: JSON.stringify(source === "pi" ? record.data : {}),
            cloudUpdatedAt: source === "pi" ? "" : record.syncUpdatedAt,
            piUpdatedAt: source === "pi" ? record.syncUpdatedAt : "",
            createdAt: new Date().toISOString(),
          });
        } else {
          throw err;
        }
      }
    }
  }

  return applied;
}

// --- Conflict Detection ---

export function detectConflict(
  localRecord: { syncUpdatedAt?: string | null; syncSource?: string | null; deletedAt?: string | null },
  remoteRecord: { syncUpdatedAt?: string | null; syncSource?: string | null; deletedAt?: string | null },
  _source: "pi" | "cloudflare",
): "update_update" | "update_delete" | null {
  const localUpdated = localRecord.syncUpdatedAt || "";
  const remoteUpdated = remoteRecord.syncUpdatedAt || "";

  // If one is empty, no conflict possible
  if (!localUpdated || !remoteUpdated) return null;

  // If same source updated it, no conflict
  if (localRecord.syncSource === remoteRecord.syncSource) return null;

  // Check for update_delete conflict
  const localDeleted = !!localRecord.deletedAt;
  const remoteDeleted = !!remoteRecord.deletedAt;
  if ((localDeleted && !remoteDeleted) || (!localDeleted && remoteDeleted)) {
    return "update_delete";
  }

  // Both modified by different sources = update_update conflict
  return "update_update";
}

// --- Conflict Resolution ---

export async function resolveConflict(
  db: Database,
  conflictId: number,
  resolution: "accept_cloud" | "accept_pi" | "manual",
  resolvedBy?: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(schema.syncConflicts)
    .where(eq(schema.syncConflicts.id, conflictId));

  if (rows.length === 0) throw new Error(`Conflict ${conflictId} not found`);
  const conflict = rows[0];

  const now = new Date().toISOString();

  if (resolution === "accept_cloud" || resolution === "accept_pi") {
    const winningData = resolution === "accept_cloud"
      ? JSON.parse(conflict.cloudData)
      : JSON.parse(conflict.piData);

    const table = getTableSchema(conflict.tableName);
    const updateData = await prepareRecordForWrite(db, conflict.tableName, winningData);

    await db.update(table).set({
      ...updateData,
      syncUpdatedAt: now,
      syncSource: resolution === "accept_cloud" ? "cloudflare" : "pi",
    }).where(eq(table.syncId, conflict.syncId));
  }

  await db.update(schema.syncConflicts).set({
    resolved: 1,
    resolution,
    resolvedAt: now,
    resolvedBy: resolvedBy || "",
  }).where(eq(schema.syncConflicts.id, conflictId));
}

// --- Heartbeat ---

export async function getHeartbeatData(db: Database): Promise<HeartbeatPayload> {
  const server = getRuntimeName();
  const dbCounts: Record<string, number> = {};

  for (const tableName of getSyncableTableNames()) {
    const table = getTableSchema(tableName);
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(table);
    dbCounts[tableName] = result[0]?.count ?? 0;
  }

  const lastSync = await getLastSyncTimestamp(db);
  const pendingChanges = await getPendingChangesCount(db, server);
  const unresolvedConflicts = await getUnresolvedConflictsCount(db);

  const settingsRows = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "primary_server"));
  const primaryServer = settingsRows[0]?.value || "cloudflare";

  return {
    server,
    buildVersion: getBuildVersion(),
    uptime: process.uptime ? `${Math.floor(process.uptime())}s` : "unknown",
    dbCounts,
    lastSync,
    pendingChanges,
    unresolvedConflicts,
    primaryServer,
  };
}

// --- Pending Changes ---

export async function getPendingChangesCount(
  db: Database,
  source: "cloudflare" | "pi",
): Promise<number> {
  const lastSync = await getLastSyncTimestamp(db);
  let total = 0;

  for (const tableName of getSyncableTableNames()) {
    const table = getTableSchema(tableName);
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(
        and(
          eq(table.syncSource, source),
          gt(table.syncUpdatedAt, lastSync),
        ),
      );
    total += result[0]?.count ?? 0;
  }

  return total;
}

// --- Unresolved Conflicts ---

export async function getUnresolvedConflictsCount(db: Database): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.syncConflicts)
    .where(eq(schema.syncConflicts.resolved, 0));
  return result[0]?.count ?? 0;
}

// --- Sync Status ---

export async function getSyncStatus(db: Database): Promise<{
  lastSync: string;
  lastDirection: string;
  lastStatus: string;
  pendingChanges: number;
  unresolvedConflicts: number;
}> {
  const source = getRuntimeName();
  const lastSync = await getLastSyncTimestamp(db);
  const pendingChanges = await getPendingChangesCount(db, source);
  const unresolvedConflicts = await getUnresolvedConflictsCount(db);

  const lastLogRows = await db
    .select()
    .from(schema.syncLog)
    .orderBy(sql`${schema.syncLog.id} DESC`)
    .limit(1);

  const lastLog = lastLogRows[0];

  return {
    lastSync,
    lastDirection: lastLog?.direction || "none",
    lastStatus: lastLog?.status || "none",
    pendingChanges,
    unresolvedConflicts,
  };
}

// --- Backfill Sync IDs ---

export async function backfillSyncIds(
  db: Database,
  source: "pi" | "cloudflare",
): Promise<{ table: string; count: number }[]> {
  const results: { table: string; count: number }[] = [];
  const now = new Date().toISOString();

  for (const tableName of getSyncableTableNames()) {
    const table = getTableSchema(tableName);
    const rows = await db
      .select()
      .from(table)
      .where(sql`${table.syncId} IS NULL OR ${table.syncId} = '' OR ${table.syncUpdatedAt} IS NULL OR ${table.syncUpdatedAt} = ''`);

    let count = 0;
    for (const row of rows) {
      const syncId = row.syncId || generateSyncId();
      await db.update(table).set({
        syncId,
        syncUpdatedAt: now,
        syncSource: source,
      }).where(eq(table.id, row.id));

      await db.insert(schema.syncIdMap).values({
        tableName,
        syncId,
        localId: row.id,
      }).onConflictDoUpdate({
        target: [schema.syncIdMap.tableName, schema.syncIdMap.syncId],
        set: { localId: row.id },
      });

      count++;
    }

    if (count > 0) results.push({ table: tableName, count });
  }

  return results;
}

// --- Internal Helpers ---

async function getLastSyncTimestamp(db: Database): Promise<string> {
  const rows = await db
    .select()
    .from(schema.syncLog)
    .where(eq(schema.syncLog.status, "completed"))
    .orderBy(sql`${schema.syncLog.id} DESC`)
    .limit(1);

  return rows[0]?.completedAt || "1970-01-01T00:00:00.000Z";
}

function rowToSyncRecord(row: any): SyncRecord {
  return {
    syncId: row.syncId,
    data: row,
    syncUpdatedAt: row.syncUpdatedAt,
    syncSource: row.syncSource,
    deletedAt: row.deletedAt ?? null,
  };
}

/** Strip local autoincrement id and remap FK integers to this DB's ids. */
async function prepareRecordForWrite(
  db: Database,
  tableName: string,
  data: Record<string, any>,
): Promise<Record<string, any>> {
  const remapped = await remapForeignKeys(db, tableName, data);
  const { id: _id, ...rest } = remapped;
  return rest;
}

async function remapForeignKeys(
  db: Database,
  tableName: string,
  data: Record<string, any>,
): Promise<Record<string, any>> {
  const fkConfig = FK_REMAP[tableName];
  if (!fkConfig) return { ...data };

  const remapped = { ...data };

  for (const [column, parentTable] of Object.entries(fkConfig)) {
    const remoteId = parseSyncFkId(remapped[column]);
    if (remoteId == null) continue;

    const mapping = await db
      .select()
      .from(schema.syncIdMap)
      .where(
        and(
          eq(schema.syncIdMap.tableName, parentTable),
          eq(schema.syncIdMap.remoteId, remoteId),
        ),
      );

    if (mapping.length > 0) {
      remapped[column] = mapping[0].localId;
    } else {
      // Do not fall back to "parent exists at this numeric id" — D1 and Pi
      // autoincrements have diverged (e.g. CF dorm 9 = EXECUTIVE, Pi dorm 9 = Dorm 1).
      remapped[column] = null;
    }
  }

  // Booking receipt sourceId is polymorphic rather than declared as a database FK.
  // New journal receipts can resolve it through the already-applied event; legacy
  // receipts use the booking sync map so a reused numeric ID cannot point at another guest.
  if (tableName === "guest_receipts" && remapped.sourceType === "booking") {
    let resolvedByEvent = false;
    if (typeof remapped.bookingEventId === "string" && remapped.bookingEventId) {
      const event = await db.select({ bookingId: schema.bookingPaymentEvents.bookingId })
        .from(schema.bookingPaymentEvents).where(eq(schema.bookingPaymentEvents.eventId, remapped.bookingEventId)).limit(1);
      if (event[0]) {
        remapped.sourceId = event[0].bookingId;
        resolvedByEvent = true;
      }
    }
    if (!Number.isInteger(remapped.sourceId) || remapped.sourceId < 0) remapped.sourceId = null;
    if (!resolvedByEvent && remapped.sourceId != null) {
      const mapping = await db.select({ localId: schema.syncIdMap.localId }).from(schema.syncIdMap).where(and(
        eq(schema.syncIdMap.tableName, "bookings"), eq(schema.syncIdMap.remoteId, remapped.sourceId),
      )).limit(1);
      if (mapping[0]) remapped.sourceId = mapping[0].localId;
    }
  }

  return remapped;
}
