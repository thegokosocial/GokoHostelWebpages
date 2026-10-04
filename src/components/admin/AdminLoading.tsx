"use client";

export function AdminLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="space-y-6 py-4" role="status" aria-live="polite" aria-label={message}>
      {/* Header shimmer */}
      <div className="space-y-2">
        <div className="h-7 w-36 animate-pulse rounded-lg bg-brand-green/10" />
        <div className="h-4 w-24 animate-pulse rounded-md bg-brand-green/5" />
      </div>

      {/* Quick access card shimmer */}
      <div className="flex items-center gap-3 rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
        <div className="h-10 w-10 animate-pulse rounded-xl bg-brand-sand/60 dark:bg-zinc-700" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-28 animate-pulse rounded-md bg-brand-sand/80 dark:bg-zinc-700" />
          <div className="h-3 w-40 animate-pulse rounded-md bg-brand-sand/50 dark:bg-zinc-800" />
        </div>
      </div>

      {/* Stat cards shimmer — 2x2 grid matching dashboard layout */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-brand-mist bg-white dark:bg-card p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-brand-sand/60 dark:bg-zinc-700" />
              <div className="min-w-0 space-y-1.5">
                <div className="h-5 w-10 animate-pulse rounded-md bg-brand-sand/80 dark:bg-zinc-700" />
                <div className="h-3 w-16 animate-pulse rounded-md bg-brand-sand/50 dark:bg-zinc-800" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Occupancy bar shimmer */}
      <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="h-3 w-24 animate-pulse rounded-md bg-brand-sand/60 dark:bg-zinc-700" />
          <div className="h-3 w-44 animate-pulse rounded-md bg-brand-sand/40 dark:bg-zinc-800" />
        </div>
        <div className="mt-2 h-3 w-full animate-pulse rounded-full bg-brand-sand/40 dark:bg-zinc-800" />
      </div>

      {/* Table rows shimmer */}
      <div className="space-y-2">
        <div className="h-5 w-32 animate-pulse rounded-md bg-brand-green/10" />
        <div className="mt-3 space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-100 dark:border-zinc-800 bg-white dark:bg-card p-3 shadow-sm dark:shadow-none">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div
                    className="h-4 animate-pulse rounded-md bg-brand-sand/70 dark:bg-zinc-700"
                    style={{ width: `${60 + (i % 3) * 12}%` }}
                  />
                  <div
                    className="h-3 animate-pulse rounded-md bg-brand-sand/40 dark:bg-zinc-800"
                    style={{ width: `${40 + (i % 4) * 10}%` }}
                  />
                </div>
                <div className="h-7 w-16 shrink-0 animate-pulse rounded-lg bg-brand-sand/50 dark:bg-zinc-700" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Subtle loading message */}
      <p className="text-center text-xs text-brand-green-dark/40">{message}</p>
    </div>
  );
}
