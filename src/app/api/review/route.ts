import { NextRequest, NextResponse } from "next/server";
import { getReviewRequestByToken, submitReviewRating, submitReviewFeedback, getSetting } from "@/db/queries";
import { getDb } from "@/db";
import { reviewFeedback } from "@/db/schema";
import { eq } from "drizzle-orm";
import { assertGuestOrigin, guestBookingRateLimit } from "@/lib/guestBookingRateLimit";

const VALID_IMPROVEMENT_AREAS = ["Dorms", "Washrooms", "Comfort", "Vibe", "Common Area", "Cafe Food"];

export async function POST(req: NextRequest) {
  try {
    assertGuestOrigin(req);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
    if (!guestBookingRateLimit(`review:${ip}`, 20, 10 * 60_000)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const body = await req.json();
    const { action, token, ...rest } = body;

    if (action === "getReviewRequest") {
      if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });
      const request = await getReviewRequestByToken(token);
      if (!request) return NextResponse.json({ error: "Invalid or expired review link" }, { status: 404 });

      const googleUrl = await getSetting("review_google_url");

      return NextResponse.json({
        guestName: request.guestName,
        propertyId: request.propertyId,
        alreadyRated: !!request.ratedAt,
        rating: request.rating,
        googleReviewUrl: googleUrl || "",
      });
    }

    if (action === "submitRating") {
      if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });
      const { rating } = rest;
      if (!rating || rating < 1 || rating > 5) return NextResponse.json({ error: "Invalid rating" }, { status: 400 });

      const request = await getReviewRequestByToken(token);
      if (!request) return NextResponse.json({ error: "Invalid review link" }, { status: 404 });
      if (request.ratedAt) return NextResponse.json({ error: "Already rated" }, { status: 400 });

      await submitReviewRating(token, rating);
      const googleUrl = await getSetting("review_google_url");

      return NextResponse.json({
        success: true,
        rating,
        redirectToGoogle: rating >= 4,
        googleReviewUrl: googleUrl || "",
      });
    }

    if (action === "submitFeedback") {
      if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });
      const { rating, improvementAreas, comments } = rest;

      const request = await getReviewRequestByToken(token);
      if (!request) return NextResponse.json({ error: "Invalid review link" }, { status: 404 });

      if (!rating || rating < 1 || rating > 5 || !Array.isArray(improvementAreas)) {
        return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
      }

      // Prevent duplicate feedback
      const db = getDb();
      const existingFeedback = await db.select({ id: reviewFeedback.id }).from(reviewFeedback).where(eq(reviewFeedback.reviewRequestId, request.id)).limit(1);
      if (existingFeedback.length > 0) {
        return NextResponse.json({ error: "Feedback already submitted" }, { status: 400 });
      }

      // Validate improvement areas against allowlist
      const validAreas = improvementAreas.filter((a: string) => VALID_IMPROVEMENT_AREAS.includes(a));
      const trimmedComments = (comments || "").slice(0, 1000);

      await submitReviewFeedback({
        reviewRequestId: request.id,
        rating,
        improvementAreas: validAreas,
        comments: trimmedComments,
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Review API error:", error?.message || error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
