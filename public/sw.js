const CACHE_NAME = "goko-admin-v4";
const OFFLINE_URL = "/admin";

// --- Failover State ---
let failoverConfig = { failoverEnabled: false, piLocalUrl: null, runtime: "cloudflare" };
let lastConfigFetch = 0;
let configPollTimer = null;
const CONFIG_POLL_INTERVAL = 60000; // 1 minute
const CONFIG_POLL_DISABLED_INTERVAL = 300000; // 5 minutes when disabled (light check)

async function refreshFailoverConfig() {
  const now = Date.now();
  if (now - lastConfigFetch < 10000) return; // debounce: at most once per 10s
  lastConfigFetch = now;

  try {
    const res = await fetch("/api/failover-config", { cache: "no-store" });
    if (res.ok) {
      const prev = failoverConfig.failoverEnabled;
      failoverConfig = await res.json();
      scheduleConfigPoll();
    }
  } catch {
    if (failoverConfig.piLocalUrl) {
      try {
        const piRes = await fetch(`${failoverConfig.piLocalUrl}/api/failover-config`, { cache: "no-store" });
        if (piRes.ok) {
          failoverConfig = await piRes.json();
        }
      } catch {}
    }
  }
}

function scheduleConfigPoll() {
  if (configPollTimer) clearInterval(configPollTimer);
  const interval = failoverConfig.failoverEnabled
    ? CONFIG_POLL_INTERVAL         // ON: poll every 60s
    : CONFIG_POLL_DISABLED_INTERVAL; // OFF: light check every 5 min
  configPollTimer = setInterval(refreshFailoverConfig, interval);
}

// --- Install & Activate ---

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    clients.claim().then(() => refreshFailoverConfig().then(scheduleConfigPoll))
  );
});

// --- Fetch Interception (Failover) ---

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only intercept API calls and page navigations to our own origin
  if (url.origin !== self.location.origin) return;

  // Skip non-GET/POST, skip static assets
  const method = event.request.method;
  if (method !== "GET" && method !== "POST") return;

  // Skip static files (images, CSS, JS chunks, fonts)
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|webp|avif)$/i.test(url.pathname)) return;
  if (url.pathname.startsWith("/_next/")) return;

  // Only intercept if failover is enabled and we have a Pi URL
  if (!failoverConfig.failoverEnabled || !failoverConfig.piLocalUrl) return;

  event.respondWith(handleWithFailover(event.request));
});

async function handleWithFailover(request) {
  try {
    // Try the primary server first (current origin)
    const response = await fetchWithTimeout(request.clone(), 8000);
    if (response.ok || response.status < 500) {
      return response;
    }
    // 5xx error -- fall through to failover
  } catch {
    // Network error / timeout -- fall through to failover
  }

  // Primary failed -- try the Pi
  const piUrl = failoverConfig.piLocalUrl;
  if (!piUrl) return fetch(request);

  try {
    const originalUrl = new URL(request.url);
    const piRequestUrl = `${piUrl}${originalUrl.pathname}${originalUrl.search}`;

    const piRequest = new Request(piRequestUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method === "POST" ? await request.clone().text() : undefined,
      mode: "cors",
      credentials: "omit",
    });

    const piResponse = await fetchWithTimeout(piRequest, 10000);

    // Notify clients that we're in failover mode
    notifyClients({ type: "FAILOVER_ACTIVE", piUrl });

    return piResponse;
  } catch {
    // Both primary and Pi failed
    return new Response(
      JSON.stringify({ error: "Both primary server and local Pi are unreachable" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
}

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    fetch(request, { signal: controller.signal })
      .then((res) => { clearTimeout(timer); resolve(res); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

function notifyClients(message) {
  self.clients.matchAll({ type: "window" }).then((clients) => {
    for (const client of clients) {
      client.postMessage(message);
    }
  });
}

// --- Message Handler (config updates from admin UI) ---

self.addEventListener("message", (event) => {
  if (event.data?.type === "UPDATE_FAILOVER_CONFIG") {
    failoverConfig = { ...failoverConfig, ...event.data.config };
    lastConfigFetch = Date.now();
    scheduleConfigPoll();
  }
  if (event.data?.type === "REFRESH_CONFIG") {
    lastConfigFetch = 0;
    refreshFailoverConfig();
  }
});

// --- Push Notifications ---

function notificationText(value, fallback, max) {
  return (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "") || fallback;
}

function notificationUrl(value) {
  try {
    if (typeof value !== "string" || /[\u0000-\u0020\\]/.test(value)) return "/admin";
    const parsed = new URL(value, self.location.origin);
    return parsed.origin === self.location.origin && parsed.pathname === "/admin"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/admin";
  } catch { return "/admin"; }
}

self.addEventListener("push", (event) => {
  const showNotif = async () => {
    let title = "Goko";
    let body = "You have a new update";
    let icon = "/icons/icon-192.png";
    let url = "/admin";
    let tag = `goko-${crypto.randomUUID()}`;
    let badge = "/icons/notification-badge.png";
    let renotify = true;
    let timestamp = Date.now();

    try {
      if (event.data) {
        let data = null;
        try {
          data = event.data.json();
        } catch {
          // payload wasn't valid JSON — try plain text
        }

        if (data && typeof data === "object" && !Array.isArray(data)) {
          title = notificationText(data.title, title, 80);
          body = notificationText(data.body, body, 1000);
          url = notificationUrl(data.url);
          tag = notificationText(data.tag, notificationText(data.eventId, tag, 120), 120);
          if (typeof data.renotify === "boolean") renotify = data.renotify;
          if (Number.isFinite(data.timestamp) && data.timestamp > 0 && data.timestamp <= 8640000000000000) timestamp = data.timestamp;
        } else if (!data) {
          const text = event.data.text();
          if (text && text.length > 0 && text.length < 500) {
            body = notificationText(text, body, 1000);
          }
        }
      }
    } catch {
      // Parsing failed entirely — fall through with defaults
    }

    const notificationOptions = [
      { body, icon, badge, data: { url }, vibrate: [200, 100, 200], tag, renotify, timestamp },
      // Retain branding and vibration if only renotify/timestamp are unsupported.
      { body, icon, badge, data: { url }, vibrate: [200, 100, 200], tag },
      // Vibration is best-effort; keep the branded notification if it is unsupported.
      { body, icon, badge, tag, data: { url } },
      // Keep the main Goko icon if a platform rejects the monochrome badge.
      { body, icon, tag, data: { url } },
      { body, data: { url } },
    ];

    for (const options of notificationOptions) {
      try {
        await self.registration.showNotification(title, options);
        return;
      } catch {
        // Retry with fewer optional features while preserving content and branding.
      }
    }
    console.error("Goko notification display failed");
  };

  event.waitUntil(showNotif());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = notificationUrl(event.notification.data?.url);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin && clientUrl.pathname === "/admin" && "focus" in client) {
          if ("navigate" in client) await client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
