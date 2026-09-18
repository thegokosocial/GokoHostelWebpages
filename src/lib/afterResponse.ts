/**
 * Run non-critical work after the HTTP response can return.
 * On Workers, registers `waitUntil`; in tests/local without CF context, awaits.
 */
export async function afterResponse(work: Promise<unknown>): Promise<void> {
  const safe = work.catch((error) => {
    console.error("Deferred task failed:", error instanceof Error ? error.message : error);
  });
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    getCloudflareContext().ctx.waitUntil(safe);
  } catch {
    await safe;
  }
}
