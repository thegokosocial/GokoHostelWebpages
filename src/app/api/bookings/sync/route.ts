import { NextRequest, NextResponse } from "next/server";
import { gmailListMessages, gmailGetMessage } from "@/lib/googleApiFetch";
import { isBookingEmail, parseBookingEmail, getOtaSearchQuery } from "@/lib/otaEmailParser";
import { addBooking, getAllBookings, setSetting, getSetting, addAuditEntry, addSystemLog } from "@/db/queries";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = body;

    if (!password || (password !== process.env.ADMIN_PASSWORD && password !== process.env.MANAGER_PASSWORD)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const query = getOtaSearchQuery();
    const messages = await gmailListMessages(query, 30);

    if (messages.length === 0) {
      return NextResponse.json({ synced: 0, message: "No new OTA booking emails found" });
    }

    const existingBookings = await getAllBookings();
    const existingRefs = new Set(existingBookings.filter((b) => b.bookingRef).map((b) => b.bookingRef));

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const msg of messages) {
      try {
        const fullMessage = await gmailGetMessage(msg.id);
        if (!fullMessage) continue;

        if (!isBookingEmail(fullMessage)) { skipped++; continue; }

        const parsed = parseBookingEmail(fullMessage);
        if (!parsed) { skipped++; continue; }

        if (parsed.bookingRef && existingRefs.has(parsed.bookingRef)) { skipped++; continue; }

        await addBooking({
          ...parsed,
          source: "email",
          rawData: JSON.stringify({ subject: fullMessage.subject, from: fullMessage.from, date: fullMessage.date, snippet: fullMessage.snippet }),
        });

        if (parsed.bookingRef) existingRefs.add(parsed.bookingRef);
        synced++;
      } catch (err: any) {
        errors.push(err?.message || "Unknown error");
      }
    }

    await setSetting("last_email_sync", new Date().toISOString());
    addAuditEntry({ username: "system", action: "email_sync", target: `${synced} new, ${skipped} skipped` }).catch(() => {});

    return NextResponse.json({
      synced,
      skipped,
      total: messages.length,
      errors: errors.length > 0 ? errors.slice(0, 3) : undefined,
      message: `Synced ${synced} new booking(s) from email`,
    });
  } catch (error: any) {
    console.error("Email sync error:", error?.message);
    addSystemLog({ level: "error", source: "email-sync", message: error?.message || "Unknown" }).catch(() => {});
    return NextResponse.json({ error: "Sync failed: " + (error?.message || "Unknown error") }, { status: 500 });
  }
}
