import { NextRequest, NextResponse } from "next/server";
import { retryDirtyInventory } from "@/lib/aiosellSync";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sync = await retryDirtyInventory();
    return NextResponse.json({ success: true, sync });
  } catch (error: any) {
    console.error("Scheduled Aiosell inventory retry failed:", error?.message);
    return NextResponse.json({ success: false, error: "Inventory retry failed" }, { status: 500 });
  }
}
