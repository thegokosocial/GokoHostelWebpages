export function remoteSyncCredentials() {
  const syncSecret = process.env.SYNC_SECRET;
  return syncSecret ? { syncSecret } : { password: process.env.ADMIN_PASSWORD };
}
