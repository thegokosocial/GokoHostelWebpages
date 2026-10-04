"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { StarIcon, Loader2Icon, CheckCircleIcon, HeartIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type View = "loading" | "rating" | "thankyou" | "feedback" | "submitted" | "error";

const IMPROVEMENT_OPTIONS = [
  { id: "Dorms", label: "Dorms", emoji: "🛏️" },
  { id: "Washrooms", label: "Washrooms", emoji: "🚿" },
  { id: "Comfort", label: "Comfort", emoji: "😴" },
  { id: "Vibe", label: "Vibe", emoji: "✨" },
  { id: "Common Area", label: "Common Area", emoji: "🏠" },
  { id: "Cafe Food", label: "Cafe Food", emoji: "☕" },
];

export default function ReviewPage() {
  const params = useParams();
  const token = params.token as string;

  const [view, setView] = useState<View>("loading");
  const [guestName, setGuestName] = useState("");
  const [googleReviewUrl, setGoogleReviewUrl] = useState("");
  const [selectedRating, setSelectedRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const viewRef = useRef<View>("loading");

  useEffect(() => {
    if (view !== viewRef.current) {
      viewRef.current = view;
      if (view !== "loading") {
        history.pushState({ reviewView: view }, "");
      }
    }
  }, [view]);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const state = e.state as { reviewView?: View } | null;
      const target = state?.reviewView;
      // Don't allow navigating back to rating if already submitted
      if (target === "rating" && (viewRef.current === "thankyou" || viewRef.current === "submitted")) {
        history.forward();
        return;
      }
      if (target && target !== "loading" && target !== "error") {
        setView(target);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const loadReviewRequest = useCallback(async () => {
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getReviewRequest", token }),
      });
      if (!res.ok) {
        setError("This review link is invalid or has expired.");
        setView("error");
        return;
      }
      const data = await res.json();
      setGuestName(data.guestName || "");
      setGoogleReviewUrl(data.googleReviewUrl || "");
      if (data.alreadyRated) {
        if (data.rating >= 4) {
          setSelectedRating(data.rating);
          setView("thankyou");
        } else {
          setView("submitted");
        }
      } else {
        setView("rating");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setView("error");
    }
  }, [token]);

  useEffect(() => { loadReviewRequest(); }, [loadReviewRequest]);

  const handleRatingSubmit = async () => {
    if (selectedRating === 0 || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submitRating", token, rating: selectedRating }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to submit rating");
        setView("error");
        return;
      }
      const data = await res.json();
      if (data.redirectToGoogle) {
        const url = data.googleReviewUrl || googleReviewUrl;
        setGoogleReviewUrl(url);
        if (url) {
          window.location.href = url;
        } else {
          setView("thankyou");
        }
      } else {
        setView("feedback");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setView("error");
    }
    setSubmitting(false);
  };

  const handleFeedbackSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submitFeedback",
          token,
          rating: selectedRating,
          improvementAreas: selectedAreas,
          comments: comments.trim(),
        }),
      });
      if (!res.ok) {
        setError("Failed to submit feedback. Please try again.");
        setView("error");
        return;
      }
      setView("submitted");
    } catch {
      setError("Something went wrong. Please try again.");
      setView("error");
    }
    setSubmitting(false);
  };

  const toggleArea = (id: string) => {
    setSelectedAreas((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  if (view === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-brand-sand" role="status" aria-live="polite" aria-label="Loading review request">
        <Loader2Icon className="h-6 w-6 animate-spin text-brand-green" />
      </div>
    );
  }

  if (view === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-red-50 to-white p-6">
        <div className="w-full max-w-sm text-center" role="alert">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <span className="text-2xl">😕</span>
          </div>
          <p className="mt-4 text-sm text-gray-600">{error}</p>
          <button
            type="button"
            onClick={() => { setError(""); loadReviewRequest(); }}
            className="mt-6 rounded-xl bg-gray-800 px-6 py-3 text-sm font-medium text-white hover:bg-gray-900"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (view === "rating") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand-sand p-6">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10">
            <HeartIcon className="h-8 w-8 text-brand-green" />
          </div>
          <h1 className="mt-5 text-xl font-bold text-gray-900">
            Thank you for staying with us!
          </h1>
          {guestName && (
            <p className="mt-1 text-sm text-gray-500">Hi {guestName.split(" ")[0]}, how was your experience?</p>
          )}
          <p className="mt-4 text-sm text-gray-600">Please rate your stay below</p>

          {/* Star rating */}
          <div className="mt-6 flex items-center justify-center gap-2" role="group" aria-label="Choose a rating from 1 to 5 stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setSelectedRating(star)}
                aria-label={`${star} out of 5 stars`}
                aria-pressed={selectedRating === star}
                className="rounded-lg p-1 transition-transform hover:scale-110 active:scale-95 focus-visible:goko-focus"
              >
                <StarIcon
                  className={cn(
                    "h-10 w-10 transition-colors sm:h-12 sm:w-12",
                    (hoverRating || selectedRating) >= star
                      ? "fill-amber-400 text-amber-400"
                      : "text-gray-300"
                  )}
                />
              </button>
            ))}
          </div>

          {selectedRating > 0 && (
            <p className="mt-2 text-sm text-gray-500">
              {selectedRating === 5 && "Excellent!"}
              {selectedRating === 4 && "Great!"}
              {selectedRating === 3 && "It was okay"}
              {selectedRating === 2 && "Could be better"}
              {selectedRating === 1 && "Needs improvement"}
            </p>
          )}

          <button
            type="button"
            onClick={handleRatingSubmit}
            disabled={selectedRating === 0 || submitting}
            className="goko-gradient-cta mt-8 w-full rounded-xl px-6 py-3.5 text-sm font-semibold text-white shadow-lg transition-all disabled:opacity-40 disabled:shadow-none"
          >
            {submitting ? "Submitting..." : "Submit Rating"}
          </button>
        </div>
      </div>
    );
  }

  if (view === "thankyou") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand-sand p-6">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10">
            <CheckCircleIcon className="h-8 w-8 text-brand-green" />
          </div>
          <h1 className="mt-5 text-xl font-bold text-gray-900">
            Thank you for your feedback!
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            We&apos;re glad you enjoyed your stay. Your support means a lot to us.
          </p>

          {googleReviewUrl && (
            <>
              <p className="mt-6 text-xs text-gray-500">
                Would you mind sharing your experience on Google? It helps other travelers find us.
              </p>
              <a
                href={googleReviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Leave a Google Review
              </a>
            </>
          )}
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-4 w-full rounded-xl border-2 border-gray-200 px-6 py-3.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (view === "feedback") {
    return (
      <div className="flex min-h-screen flex-col bg-brand-sand p-6">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-lg font-bold text-gray-900">
            We&apos;re sorry your experience wasn&apos;t perfect.
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Please tell us what we can improve.
          </p>

          {/* Improvement areas */}
          <div className="mt-6">
            <p id="improvement-areas-label" className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">What could be better?</p>
            <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="improvement-areas-label">
              {IMPROVEMENT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggleArea(opt.id)}
                  aria-pressed={selectedAreas.includes(opt.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 text-left text-sm font-medium transition-all",
                    selectedAreas.includes(opt.id)
                      ? "border-brand-red bg-brand-sand text-brand-red"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                  )}
                >
                  <span>{opt.emoji}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Comments */}
          <div className="mt-6">
            <label htmlFor="review-comments" className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Additional feedback (optional)</label>
            <textarea
              id="review-comments"
              value={comments}
              onChange={(e) => setComments(e.target.value.slice(0, 1000))}
              placeholder="Please tell us more about your experience..."
              rows={4}
              className="w-full rounded-xl border-2 border-gray-200 px-3 py-2.5 text-sm transition-colors focus:border-brand-green focus-visible:goko-focus"
            />
            <p className="mt-1 text-right text-xs text-gray-400">{comments.length}/1000</p>
          </div>

          {selectedAreas.length === 0 && (
            <p className="mt-4 text-xs text-brand-red" role="status">Please select at least one area to continue.</p>
          )}
          <button
            type="button"
            onClick={handleFeedbackSubmit}
            disabled={submitting || selectedAreas.length === 0}
            className="goko-gradient-cta mt-4 w-full rounded-xl px-6 py-3.5 text-sm font-semibold text-white shadow-lg transition-all disabled:opacity-40 disabled:shadow-none"
          >
            {submitting ? "Sending..." : "Send Feedback"}
          </button>
        </div>
      </div>
    );
  }

  if (view === "submitted") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand-sand p-6">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/10">
            <CheckCircleIcon className="h-8 w-8 text-brand-green" />
          </div>
          <h1 className="mt-5 text-xl font-bold text-gray-900">
            Thank you for helping us improve!
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Your feedback has been shared with our team. We&apos;ll work on making your next stay better.
          </p>
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-8 w-full rounded-xl border-2 border-gray-200 px-6 py-3.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return null;
}
