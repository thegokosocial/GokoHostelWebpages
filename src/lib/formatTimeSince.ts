/** Compact age label for admin Food Orders cards (earliest order time). */
export function formatTimeSince(isoDate: string, nowMs: number = Date.now()): string {
  const diffMs = nowMs - new Date(isoDate).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "<1m";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) {
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return remainMins === 0 ? `${hrs}h` : `${hrs}h ${remainMins}m`;
  }
  const days = Math.floor(mins / (24 * 60));
  const hrs = Math.floor((mins % (24 * 60)) / 60);
  return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
}
