import { NextRequest, NextResponse } from "next/server";
import { addCalendarDays } from "@/lib/inventoryAvailability";
import { getReconciliationStatus } from "@/lib/reconciliation";
import { notificationReconciliationBody, sendPushToRoles } from "@/lib/pushNotify";
import { todayIST } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = addCalendarDays(todayIST(), -1);
  const status = await getReconciliationStatus(date);
  if (status.isReconciled) return NextResponse.json({ sent: false, status });

  const delivery = await sendPushToRoles({
    title: "Reconciliation pending",
    body: notificationReconciliationBody(date, status.missingAccountNames.length),
    category: "operations",
    eventId: `reconciliation-${date}`,
    tag: `reconciliation-${date}`,
    renotify: true,
    url: `/admin?section=expenditure&tab=reconcile&date=${date}`,
  }, ["admin", "manager"]);

  return NextResponse.json({ sent: true, status, delivery });
}
