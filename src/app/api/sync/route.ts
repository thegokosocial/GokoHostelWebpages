import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import {
  preparePullResponse,
  applyPullRecords,
  preparePushPayload,
  applyPushRecords,
  resolveConflict,
  getHeartbeatData,
  getSyncStatus,
  backfillSyncIds,
  type SyncBundle,
  type HeartbeatPayload,
} from "@/lib/syncEngine";
import { getRuntimeName, isPiRuntime } from "@/lib/runtime";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { exec } from "child_process";
import { getAuthSession } from "@/lib/authSession";

async function authenticateSync(password: string, syncSecret?: string): Promise<boolean> {
  const session = await getAuthSession("admin");
  if (session?.role === "admin") return true;
  const adminPw = process.env.ADMIN_PASSWORD;
  const secret = process.env.SYNC_SECRET;

  if (adminPw && password === adminPw) return true;
  if (secret && syncSecret === secret) return true;
  return false;
}

function getRemoteUrl(): string | null {
  if (isPiRuntime()) {
    return process.env.CLOUDFLARE_SITE_URL || null;
  }
  return process.env.PI_PUBLIC_URL || null;
}

async function fetchRemoteHeartbeat(
  remoteUrl: string,
): Promise<HeartbeatPayload | null> {
  try {
    const res = await fetch(`${remoteUrl}/api/sync`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as HeartbeatPayload;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, password, syncSecret } = body;

    if (action === "heartbeat") {
      const db = getDb();
      const data = await getHeartbeatData(db);
      return NextResponse.json(data);
    }

    if (!(await authenticateSync(password, syncSecret))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getDb();

    switch (action) {
      case "status": {
        const syncStatus = await getSyncStatus(db);
        const localHeartbeat = await getHeartbeatData(db);
        const localRuntime = getRuntimeName();
        const totalRecords = Object.values(localHeartbeat.dbCounts).reduce((a, b) => a + b, 0);

        const localServer = {
          online: true,
          build: localHeartbeat.buildVersion,
          records: totalRecords,
          lastSeen: new Date().toISOString(),
        };

        let remoteServer = { online: false, build: "unknown", records: 0, lastSeen: null as string | null };
        let remoteReachable = false;

        const remoteUrl = getRemoteUrl();
        if (remoteUrl) {
          const remoteHeartbeat = await fetchRemoteHeartbeat(remoteUrl);
          if (remoteHeartbeat) {
            remoteReachable = true;
            const remoteTotal = Object.values(remoteHeartbeat.dbCounts).reduce((a, b) => a + b, 0);
            remoteServer = {
              online: true,
              build: remoteHeartbeat.buildVersion,
              records: remoteTotal,
              lastSeen: new Date().toISOString(),
            };
            await db.insert(schema.settings).values({
              key: "last_remote_heartbeat",
              value: JSON.stringify(remoteServer),
            }).onConflictDoUpdate({
              target: schema.settings.key,
              set: { value: JSON.stringify(remoteServer) },
            });
          } else {
            const cachedRows = await db
              .select()
              .from(schema.settings)
              .where(eq(schema.settings.key, "last_remote_heartbeat"));
            if (cachedRows[0]?.value) {
              try {
                const cached = JSON.parse(cachedRows[0].value);
                remoteServer = { ...cached, online: false };
              } catch {}
            }
          }
        } else {
          remoteReachable = true;
        }

        // On Cloudflare this request already proved the public internet is up.
        // On the Pi, "internet" means we can reach the live site.
        const internetConnected = isPiRuntime()
          ? (remoteUrl ? remoteReachable : true)
          : true;

        let piUnreachableSince: string | null = null;
        if (localRuntime === "cloudflare") {
          const existing = await db
            .select()
            .from(schema.settings)
            .where(eq(schema.settings.key, "pi_unreachable_since"));
          const stored = existing[0]?.value || "";
          if (!remoteServer.online) {
            if (stored) {
              piUnreachableSince = stored;
            } else {
              piUnreachableSince = new Date().toISOString();
              await db.insert(schema.settings).values({
                key: "pi_unreachable_since",
                value: piUnreachableSince,
              }).onConflictDoUpdate({
                target: schema.settings.key,
                set: { value: piUnreachableSince },
              });
            }
          } else if (stored) {
            await db
              .insert(schema.settings)
              .values({ key: "pi_unreachable_since", value: "" })
              .onConflictDoUpdate({
                target: schema.settings.key,
                set: { value: "" },
              });
          }
        }

        const settingsRows = await db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, "primary_server"));
        const primaryServer = (settingsRows[0]?.value || "cloudflare") as "cloudflare" | "pi";

        const autoSyncRows = await db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, "auto_sync_enabled"));
        const autoSync = autoSyncRows[0]?.value === "true";

        const lastLogRows = await db
          .select()
          .from(schema.syncLog)
          .where(eq(schema.syncLog.status, "completed"))
          .orderBy(sql`${schema.syncLog.id} DESC`)
          .limit(1);
        const lastLog = lastLogRows[0];

        const status = {
          runtime: localRuntime,
          cloudflare: localRuntime === "cloudflare" ? localServer : remoteServer,
          pi: localRuntime === "pi" ? localServer : remoteServer,
          internetConnected,
          primaryServer,
          lastSync: syncStatus.lastSync !== "1970-01-01T00:00:00.000Z" ? syncStatus.lastSync : null,
          recordsPulled: lastLog?.recordsPulled ?? 0,
          recordsPushed: lastLog?.recordsPushed ?? 0,
          conflicts: syncStatus.unresolvedConflicts,
          pendingChanges: syncStatus.pendingChanges,
          autoSync,
        };

        const barStatus = {
          runtime: localRuntime,
          internetConnected,
          piOnline: localRuntime === "pi" ? true : remoteServer.online,
          lastSync: status.lastSync,
          pendingChanges: syncStatus.pendingChanges,
          buildsMatch: status.cloudflare.build === status.pi.build,
          syncFailed: syncStatus.lastStatus === "error",
          piUnreachableSince,
        };

        return NextResponse.json({ status, barStatus });
      }

      case "sync": {
        const { mode = "full" } = body;
        const localRuntime = getRuntimeName();
        const remoteUrl = getRemoteUrl();
        const remotePassword = process.env.ADMIN_PASSWORD;

        if (!remoteUrl) {
          return NextResponse.json(
            { error: "No remote server URL configured. Set CLOUDFLARE_SITE_URL on the Pi." },
            { status: 400 },
          );
        }

        const now = new Date().toISOString();
        const logRows = await db
          .select()
          .from(schema.syncLog)
          .where(eq(schema.syncLog.status, "completed"))
          .orderBy(sql`${schema.syncLog.id} DESC`)
          .limit(1);
        const sinceTs = logRows[0]?.completedAt || "1970-01-01T00:00:00.000Z";

        const direction = mode === "pull" ? "pull" : mode === "push" ? "push" : "full";

        const [logEntry] = await db
          .insert(schema.syncLog)
          .values({
            direction,
            status: "started",
            startedAt: now,
          })
          .returning();

        let pulled = 0;
        let pushed = 0;
        let conflictsFound = 0;

        try {
          if (mode === "pull" || mode === "full") {
            const pullRes = await fetch(`${remoteUrl}/api/sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "pull",
                password: remotePassword,
                since: sinceTs,
              }),
              signal: AbortSignal.timeout(30000),
            });

            if (!pullRes.ok) {
              const errBody = await pullRes.json().catch(() => ({}));
              throw new Error(`Remote pull failed (${pullRes.status}): ${(errBody as any).error || "Unknown"}`);
            }

            const pullData = await pullRes.json();
            const payloads = (pullData as any).payloads || [];

            if (payloads.length > 0) {
              const remoteSource = localRuntime === "pi" ? "cloudflare" : "pi";
              const pullResult = await applyPullRecords(db, payloads, remoteSource as "cloudflare" | "pi");
              pulled = pullResult.applied;
              conflictsFound += pullResult.conflicts.length;
            }
          }

          if (mode === "push" || mode === "full") {
            const pushBundles = await preparePushPayload(db, sinceTs, localRuntime);
            if (pushBundles.length > 0) {
              const pushRes = await fetch(`${remoteUrl}/api/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "push",
                  password: remotePassword,
                  bundles: pushBundles,
                  source: localRuntime,
                }),
                signal: AbortSignal.timeout(30000),
              });

              if (!pushRes.ok) {
                const errBody = await pushRes.json().catch(() => ({}));
                throw new Error(`Remote push failed (${pushRes.status}): ${(errBody as any).error || "Unknown"}`);
              }

              const pushResult = await pushRes.json();
              pushed = (pushResult as any).applied || 0;
              conflictsFound += ((pushResult as any).conflicts?.length || 0);
            }
          }

          const completedAt = new Date().toISOString();
          await db
            .update(schema.syncLog)
            .set({
              status: "completed",
              recordsPulled: pulled,
              recordsPushed: pushed,
              conflictsFound,
              completedAt,
            })
            .where(eq(schema.syncLog.id, logEntry.id));

          return NextResponse.json({
            ok: true,
            pulled,
            pushed,
            conflicts: conflictsFound,
            direction,
          });
        } catch (syncErr: any) {
          await db
            .update(schema.syncLog)
            .set({
              status: "error",
              errorMessage: syncErr.message || "Sync failed",
              completedAt: new Date().toISOString(),
              recordsPulled: pulled,
              recordsPushed: pushed,
              conflictsFound,
            })
            .where(eq(schema.syncLog.id, logEntry.id));

          return NextResponse.json(
            { error: syncErr.message || "Sync failed", pulled, pushed, conflicts: conflictsFound },
            { status: 500 },
          );
        }
      }

      case "pull": {
        const { since, tables, limit } = body;
        if (!since) {
          return NextResponse.json({ error: "Missing 'since' timestamp" }, { status: 400 });
        }
        const payloads = await preparePullResponse(db, since, tables, limit || 200);
        return NextResponse.json({ payloads });
      }

      case "push": {
        const { bundles, source: pushSource } = body as { bundles: SyncBundle[]; source: string };
        if (!bundles || !pushSource) {
          return NextResponse.json({ error: "Missing 'bundles' or 'source'" }, { status: 400 });
        }
        const validSource = pushSource === "pi" ? "pi" : "cloudflare";
        const result = await applyPushRecords(db, bundles, validSource as "cloudflare" | "pi");
        return NextResponse.json(result);
      }

      case "getConflicts": {
        const rows = await db
          .select()
          .from(schema.syncConflicts)
          .where(eq(schema.syncConflicts.resolved, 0))
          .orderBy(schema.syncConflicts.id);
        return NextResponse.json({ conflicts: rows });
      }

      case "resolveConflict": {
        const { conflictId, resolution, resolvedBy } = body;
        if (!conflictId || !resolution) {
          return NextResponse.json({ error: "Missing conflictId or resolution" }, { status: 400 });
        }
        await resolveConflict(db, conflictId, resolution, resolvedBy);
        return NextResponse.json({ ok: true });
      }

      case "resolveAll": {
        const { resolution, resolvedBy } = body;
        if (!resolution) {
          return NextResponse.json({ error: "Missing resolution" }, { status: 400 });
        }
        const unresolved = await db
          .select()
          .from(schema.syncConflicts)
          .where(eq(schema.syncConflicts.resolved, 0));

        for (const conflict of unresolved) {
          await resolveConflict(db, conflict.id, resolution, resolvedBy);
        }
        return NextResponse.json({ ok: true, resolved: unresolved.length });
      }

      case "getSyncLog": {
        const { limit: logLimit = 20, offset = 0 } = body;
        const rows = await db
          .select()
          .from(schema.syncLog)
          .orderBy(sql`${schema.syncLog.id} DESC`)
          .limit(logLimit)
          .offset(offset);
        return NextResponse.json({ logs: rows });
      }

      case "setPrimary": {
        const { server } = body;
        if (server !== "cloudflare" && server !== "pi") {
          return NextResponse.json({ error: "Invalid server value" }, { status: 400 });
        }
        await db
          .insert(schema.settings)
          .values({ key: "primary_server", value: server })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value: server },
          });
        return NextResponse.json({ ok: true, primaryServer: server });
      }

      case "toggleAutoSync": {
        const { enabled } = body;
        await db
          .insert(schema.settings)
          .values({ key: "auto_sync_enabled", value: enabled ? "true" : "false" })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value: enabled ? "true" : "false" },
          });
        return NextResponse.json({ ok: true, autoSync: enabled });
      }

      case "backfillSyncIds": {
        const source = body.source || getRuntimeName();
        const result = await backfillSyncIds(db, source);
        return NextResponse.json({ ok: true, backfilled: result });
      }

      case "toggleFailover": {
        const { enabled: failoverEnabled } = body;
        await db
          .insert(schema.settings)
          .values({ key: "failover_enabled", value: failoverEnabled ? "true" : "false" })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value: failoverEnabled ? "true" : "false" },
          });
        return NextResponse.json({ ok: true, failoverEnabled: failoverEnabled });
      }

      case "getFailoverStatus": {
        const enabledRows = await db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, "failover_enabled"));
        const failoverEnabled = enabledRows[0]?.value === "true";

        const piUrlRows = await db
          .select()
          .from(schema.settings)
          .where(eq(schema.settings.key, "pi_local_url"));
        const piLocalUrl = piUrlRows[0]?.value || null;

        let failoverActive = false;
        if (isPiRuntime()) {
          try {
            const fs = require("fs");
            const hostsContent = fs.readFileSync("/etc/dnsmasq.d/failover-hosts", "utf-8").trim();
            failoverActive = hostsContent.length > 0;
          } catch {}
        }

        return NextResponse.json({
          failoverEnabled,
          failoverActive,
          piLocalUrl,
          runtime: getRuntimeName(),
        });
      }

      case "setPiLocalUrl": {
        const { url: piUrl } = body;
        await db
          .insert(schema.settings)
          .values({ key: "pi_local_url", value: piUrl || "" })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value: piUrl || "" },
          });
        return NextResponse.json({ ok: true, piLocalUrl: piUrl });
      }

      case "resetAndReseed": {
        if (!isPiRuntime()) {
          return NextResponse.json({ error: "resetAndReseed can only run on Pi" }, { status: 400 });
        }
        // Fetch first so a remote outage cannot leave the Pi with cleared tables.
        const cfUrl = process.env.CLOUDFLARE_SITE_URL || "https://www.gokohostel.com";
        const pullRes = await fetch(`${cfUrl}/api/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: process.env.ADMIN_PASSWORD,
            syncSecret: process.env.SYNC_SECRET,
            action: "pull",
            since: "1970-01-01T00:00:00Z",
            limit: 10000,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!pullRes.ok) {
          const err = await pullRes.text();
          return NextResponse.json({ error: `Failed to pull from Cloudflare: ${err}` }, { status: 502 });
        }

        const pullData = await pullRes.json();
        const payloads = pullData.payloads || [];

        const SYNCED_TABLES = [
          "order_modifications", "food_order_items", "food_orders",
          "salary_payments", "daily_income", "daily_ledger",
          "employee_attendance_history", "employee_attendance", "employee_leave_policy", "employee_compensation_history",
          "expenses", "bed_history", "beds", "bookings",
          "menu_items", "menu_categories",
          "accounts", "vendors", "employees",
          "qr_history", "users", "checkins", "dorms",
        ];
        // Clear sync infrastructure
        await db.delete(schema.syncConflicts);
        await db.delete(schema.syncLog);
        await db.delete(schema.syncIdMap);
        // These Pi-local tables reference synced dorms/beds/bookings and cannot
        // survive a reseed. They contain derived or locally configured state.
        for (const t of [
          "bed_blocks", "booking_bed_assignments", "booking_history",
          "bed_type_config", "inventory_overrides", "room_type_mapping",
        ]) {
          await db.run(sql.raw(`DELETE FROM "${t}"`));
        }
        // Clear all synced tables (children first due to FKs)
        for (const t of SYNCED_TABLES) {
          await db.run(sql.raw(`DELETE FROM "${t}"`));
        }
        // Clear syncable settings
        await db.run(sql.raw(`DELETE FROM settings WHERE key NOT IN ('auto_sync_enabled','primary_server','pi_local_url','last_sync_at')`));

        let totalInserted = 0;
        for (const payload of payloads) {
          const result = await applyPullRecords(db, [payload], "pi");
          totalInserted += result.applied;
        }

        // Update last sync timestamp
        await db
          .insert(schema.settings)
          .values({ key: "last_sync_at", value: new Date().toISOString() })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value: new Date().toISOString() },
          });

        // Log it
        await db.insert(schema.syncLog).values({
          direction: "reseed",
          status: "completed",
          recordsPulled: totalInserted,
          recordsPushed: 0,
          conflictsFound: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          details: `Reset and reseeded from Cloudflare. ${payloads.length} tables, ${totalInserted} records.`,
        });

        return NextResponse.json({
          ok: true,
          tablesCleared: SYNCED_TABLES.length,
          recordsImported: totalInserted,
          tablesImported: payloads.length,
        });
      }

      case "shutdownPi":
      case "deployUpdate":
      case "restartCloudflared": {
        if (isPiRuntime()) {
          if (action === "shutdownPi") {
            exec("nohup sudo /sbin/shutdown -h +1 'GokoWeb admin initiated shutdown' &", (err) => {
              if (err) console.error("[sync] Shutdown error:", err.message);
            });
            return NextResponse.json({ ok: true, message: "Raspberry Pi will shut down in 1 minute. Unplug power after the green LED stops flashing." });
          }
          if (action === "restartCloudflared") {
            exec("nohup sudo systemctl restart cloudflared &", (err) => {
              if (err) console.error("[sync] cloudflared restart error:", err.message);
            });
            return NextResponse.json({ ok: true, message: "Restarted cloudflared. Wait ~15s, then refresh Server Sync on the live site." });
          }
          const scriptPath = `${process.cwd()}/scripts/check-and-deploy.sh`;
          exec(`nohup bash -c 'sleep 2 && flock -n /tmp/goko-deploy-manual.lock bash ${scriptPath}' >> /home/goko/deploy.log 2>&1 &`, (err) => {
            if (err) console.error("[sync] Deploy error:", err.message);
          });
          return NextResponse.json({ ok: true, message: "Deploy triggered. The Pi will pull the latest code, rebuild, and restart. This may take 5-10 minutes." });
        }

        const piUrl = process.env.PI_PUBLIC_URL;
        if (!piUrl) {
          return NextResponse.json({ error: "PI_PUBLIC_URL not configured — cannot reach the Pi" }, { status: 400 });
        }
        try {
          const proxyRes = await fetch(`${piUrl}/api/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: process.env.ADMIN_PASSWORD, action }),
            signal: AbortSignal.timeout(15000),
          });
          const proxyData = await proxyRes.json();
          return NextResponse.json(proxyData, { status: proxyRes.status });
        } catch (proxyErr: any) {
          return NextResponse.json(
            { error: `Failed to reach Pi: ${proxyErr.message || "timeout"}` },
            { status: 502 },
          );
        }
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[sync] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal sync error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const db = getDb();
    const data = await getHeartbeatData(db);
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Heartbeat failed" },
      { status: 500 }
    );
  }
}
