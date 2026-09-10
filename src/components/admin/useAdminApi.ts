import { useCallback } from "react";

export type FetchRetryOptions = {
  retries?: number;
  /**
   * Retry JSON 500 after the Worker likely ran the handler.
   * Off by default so a succeeded INSERT + 500 response is not duplicated
   * (check-in add, createBooking). Bookings assign/read paths opt in.
   */
  retryServerError?: boolean;
};

const GATEWAY_STATUSES = new Set([429, 502, 503]);

export function isRetryableAdminResponse(res: Response, retryServerError = false): boolean {
  if (GATEWAY_STATUSES.has(res.status)) return true;
  if (res.status === 500 && retryServerError) return true;
  const ct = res.headers.get("content-type") || "";
  return res.status >= 500 && !ct.includes("json");
}

function parseRetryArg(retriesOrOpts?: number | FetchRetryOptions): Required<FetchRetryOptions> {
  if (typeof retriesOrOpts === "number") {
    return { retries: retriesOrOpts, retryServerError: false };
  }
  return {
    retries: retriesOrOpts?.retries ?? 2,
    retryServerError: retriesOrOpts?.retryServerError ?? false,
  };
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retriesOrOpts: number | FetchRetryOptions = 2,
): Promise<Response> {
  const { retries, retryServerError } = parseRetryArg(retriesOrOpts);
  let last: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      last = res;
      if (isRetryableAdminResponse(res, retryServerError) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  return last ?? fetch(url, init);
}

export function useAdminApi(password: string, username?: string) {
  const apiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    const res = await fetchWithRetry("/api/admin/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res;
  }, [password, username]);

  return { apiCall };
}
