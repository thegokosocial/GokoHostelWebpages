"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { useTabWithHistory } from "@/hooks/useTabWithHistory";
import type { Role } from "./types";

const tabLoader = () => <div className="flex items-center justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-green-dark border-t-transparent" /></div>;
const ReviewAskTab = dynamic(() => import("./ReviewAskTab").then((m) => m.ReviewAskTab), { loading: tabLoader, ssr: false });
const ReviewResponsesTab = dynamic(() => import("./ReviewResponsesTab").then((m) => m.ReviewResponsesTab), { loading: tabLoader, ssr: false });
const ReviewAnalyticsTab = dynamic(() => import("./ReviewAnalyticsTab").then((m) => m.ReviewAnalyticsTab), { loading: tabLoader, ssr: false });

type ReviewTab = "askReview" | "responses" | "analytics";

interface Props {
  password: string;
  username: string;
  role: Role;
  permissions: Record<string, boolean>;
}

const TABS: { id: ReviewTab; label: string }[] = [
  { id: "askReview", label: "Ask Review" },
  { id: "responses", label: "Responses" },
  { id: "analytics", label: "Analytics" },
];

export function AdminReviews({ password, username, role, permissions }: Props) {
  const [tab, setTab] = useTabWithHistory<ReviewTab>("tab", "askReview");

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-brand-mist bg-white dark:bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id ? "text-brand-green" : "text-brand-green-dark/60 hover:bg-brand-sand/50"
            )}
          >
            {tab === t.id && (
              <motion.span
                layoutId="reviews-tab-pill"
                className="absolute inset-0 rounded-lg bg-brand-green/10"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{t.label}</span>
          </button>
        ))}
      </div>

      {tab === "askReview" && <ReviewAskTab password={password} username={username} />}
      {tab === "responses" && <ReviewResponsesTab password={password} username={username} />}
      {tab === "analytics" && <ReviewAnalyticsTab password={password} username={username} onNavigateToResponses={() => setTab("responses")} />}
    </div>
  );
}
