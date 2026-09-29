import { NextRequest, NextResponse } from "next/server";
import { ensureRecurringExpenseOccurrences } from "@/lib/recurringExpenseStore";
import { sendPushToRoles } from "@/lib/pushNotify";
import { todayIST } from "@/lib/utils";
export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await ensureRecurringExpenseOccurrences(todayIST());
  if (result.created) await sendPushToRoles({ notificationType: "reminder.recurring_expense_due", title: "Recurring expenses due", body: `${result.created} recurring expense${result.created === 1 ? " is" : "s are"} ready for review.`, eventId: `recurring-expenses-${todayIST()}`, tag: `recurring-expenses-${todayIST()}`, url: "/admin?section=expenditure&tab=recurringExpenses" }, ["admin"]);
  return NextResponse.json(result);
}
