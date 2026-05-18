"use client";

export function AdminLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <div className="relative">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-green/20 border-t-brand-green" />
        <div className="absolute inset-0 h-12 w-12 animate-ping rounded-full border-4 border-brand-green/10 opacity-30" />
      </div>
      <p className="mt-5 text-sm font-medium text-brand-green-dark/60">{message}</p>
    </div>
  );
}
