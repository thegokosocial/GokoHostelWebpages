import { NextRequest, NextResponse } from "next/server";
import {
  getSetting, setSetting,
  getReviewRequestsForAdmin, recordWhatsAppSent, getReviewFeedbackList, getReviewAnalytics,
  createReviewRequest, getReviewRequestByCheckinId,
} from "@/db/queries";
import { getDb } from "@/db";
import { checkins, reviewRequests, reviewFeedback } from "@/db/schema";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";

import { authenticateUser } from "@/lib/auth";
import { actionAllowed, type ActionPerm } from "@/lib/actionPermissions";

function generateToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, username, action, ...rest } = body;

    const auth = await authenticateUser(password, username);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { role, permissions } = auth;
    if (role !== "admin" && !permissions.canViewReviews) {
      return NextResponse.json({ error: "No permission" }, { status: 403 });
    }

    const actionPermissions: Record<string, ActionPerm> = {
      sendWhatsApp: ["canSendReviewRequests", "canViewReviews"],
      updateSettings: ["canManageReviewSettings", "canViewReviews"],
      editReviewRequest: ["canEditReviewRequests", "canViewReviews"],
      resetReviewRequest: ["canEditReviewRequests", "canViewReviews"],
    };
    const actionPermission = actionPermissions[String(action)];
    if (actionPermission && actionAllowed(role, permissions, actionPermission) !== "allowed") {
      return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    }

    if (action === "listAskReview") {
      const { fromDate, toDate } = rest;
      const db = getDb();

      const conditions: any[] = [eq(checkins.status, "checked_out"), sql`${checkins.checkedOutAt} != ''`];
      if (fromDate) conditions.push(gte(checkins.checkedOutAt, fromDate));
      if (toDate) conditions.push(lte(checkins.checkedOutAt, toDate + "T23:59:59"));

      const guests = await db.select().from(checkins).where(and(...conditions)).orderBy(desc(checkins.id));

      const reviewReqs = await db.select().from(reviewRequests).where(sql`${reviewRequests.deletedAt} IS NULL`);
      const reqMap = new Map(reviewReqs.map((r) => [r.checkinId, r]));

      const result = guests.map((g) => {
        const rr = reqMap.get(g.id);
        return {
          checkinId: g.id,
          guestName: g.name,
          guestContact: g.contact,
          checkedOutAt: g.checkedOutAt,
          bookingPlatform: g.bookingPlatform,
          bookingId: g.bookingId,
          reviewRequest: rr ? {
            id: rr.id,
            token: rr.token,
            whatsappSentCount: rr.whatsappSentCount || 0,
            whatsappLastSentAt: rr.whatsappLastSentAt,
            rating: rr.rating,
            ratedAt: rr.ratedAt,
          } : null,
        };
      });

      return NextResponse.json({ guests: result });
    }

    if (action === "sendWhatsApp") {
      const { checkinId, guestName, guestContact, propertyId, bookingId } = rest;
      if (!checkinId || !guestName || !guestContact) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      let existing = await getReviewRequestByCheckinId(checkinId);
      if (!existing) {
        const token = generateToken();
        await createReviewRequest({ token, checkinId, guestName, guestContact, propertyId, bookingId });
        existing = await getReviewRequestByCheckinId(checkinId);
      }
      if (!existing) return NextResponse.json({ error: "Failed to create request" }, { status: 500 });

      await recordWhatsAppSent(existing.id);
      const updated = await getReviewRequestByCheckinId(checkinId);

      return NextResponse.json({
        success: true,
        token: existing.token,
        sentCount: (updated?.whatsappSentCount || 0),
      });
    }

    if (action === "listResponses") {
      const { fromDate, toDate, property, rating, improvementArea } = rest;
      const rows = await getReviewFeedbackList({ fromDate, toDate, property, rating, improvementArea });
      return NextResponse.json({ feedback: rows });
    }

    if (action === "getAnalytics") {
      const { fromDate, toDate, property } = rest;
      const analytics = await getReviewAnalytics({ fromDate, toDate, property });
      return NextResponse.json(analytics);
    }

    if (action === "getSettings") {
      const [googleUrl, sendDelay, whatsappEnabled, messageTemplate] = await Promise.all([
        getSetting("review_google_url"),
        getSetting("review_send_delay"),
        getSetting("review_whatsapp_enabled"),
        getSetting("review_message_template"),
      ]);
      return NextResponse.json({
        review_google_url: googleUrl || "",
        review_send_delay: sendDelay || "immediate",
        review_whatsapp_enabled: whatsappEnabled !== "false",
        review_message_template: messageTemplate || "Thank you for staying with us! ❤️\n\nHow was your experience? Please rate your stay:\n{REVIEW_URL}",
      });
    }

    if (action === "updateSettings") {
      const { settings: settingsData } = rest;
      if (!settingsData || typeof settingsData !== "object") {
        return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
      }
      for (const [key, value] of Object.entries(settingsData)) {
        if (key.startsWith("review_")) {
          await setSetting(key, String(value));
        }
      }
      return NextResponse.json({ success: true });
    }

    if (action === "editReviewRequest") {
      const { reviewRequestId, rating, whatsappSentCount } = rest;
      if (!reviewRequestId) return NextResponse.json({ error: "Missing reviewRequestId" }, { status: 400 });

      const db = getDb();
      const updateData: Record<string, any> = {};
      if (rating !== undefined) {
        updateData.rating = rating === null ? null : Number(rating);
        updateData.ratedAt = rating === null ? null : new Date().toISOString();
        updateData.redirectedToGoogle = rating !== null && rating >= 4 ? 1 : 0;
      }
      if (whatsappSentCount !== undefined) {
        updateData.whatsappSentCount = Number(whatsappSentCount);
      }

      await db.update(reviewRequests).set(updateData).where(eq(reviewRequests.id, reviewRequestId));
      return NextResponse.json({ success: true });
    }

    if (action === "resetReviewRequest") {
      const { checkinId } = rest;
      if (!checkinId) return NextResponse.json({ error: "Missing checkinId" }, { status: 400 });

      const db = getDb();
      // Delete associated feedback
      const existing = await db.select({ id: reviewRequests.id }).from(reviewRequests).where(eq(reviewRequests.checkinId, checkinId));
      if (existing.length > 0) {
        for (const rr of existing) {
          await db.delete(reviewFeedback).where(eq(reviewFeedback.reviewRequestId, rr.id));
        }
        await db.delete(reviewRequests).where(eq(reviewRequests.checkinId, checkinId));
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin reviews API error:", error?.message || error);
    const raw = error?.message || "Internal error";
    const userMessage = raw.includes("Failed query") || raw.includes("D1_ERROR")
      ? "Database temporarily unavailable. Please try again."
      : raw;
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
