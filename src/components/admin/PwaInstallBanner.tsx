"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DownloadIcon, BellIcon, SmartphoneIcon, CheckCircleIcon, CircleAlertIcon, Loader2Icon, SendIcon, BellOffIcon, Volume2Icon, ShareIcon, CopyIcon } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

/** iPhone/iPod + iPad (including iPadOS desktop UA). */
function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ often reports as MacIntel with touch
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** True Safari on iOS (not Chrome/Firefox/Edge wrappers). */
function detectIosSafari(): boolean {
  if (!detectIos()) return false;
  const ua = navigator.userAgent;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(ua);
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** iOS web push needs 16.4+ and a Home Screen app; Safari tabs cannot subscribe. */
function iosPushBlockedReason(isIos: boolean, isStandalone: boolean): string | null {
  if (!isIos) return null;
  if (!isStandalone) {
    return "On iPhone/iPad, install Goko to the Home Screen first (Safari → Share → Add to Home Screen), then open it from the Home Screen icon and tap Enable notifications.";
  }
  if (typeof window !== "undefined" && !("PushManager" in window)) {
    return "This iOS version does not support web push. Update to iOS/iPadOS 16.4 or later, then try again from the Home Screen app.";
  }
  return null;
}

async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Push notifications are not supported by this browser");
  }
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  // iOS often fails subscribe until the worker is active.
  await navigator.serviceWorker.ready;
  registration.update().catch(() => {});
  return registration;
}

export function PwaInstallBanner({ password, username }: { password: string; username?: string }) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState("");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [pushAction, setPushAction] = useState<"test" | "disable" | null>(null);
  const [pushError, setPushError] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [installed, setInstalled] = useState(false);
  const [adminUrlCopied, setAdminUrlCopied] = useState(false);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    fetch("/api/push", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setVapidPublicKey(data.publicKey || ""))
      .catch(() => setPushError("Could not load notification configuration"));
  }, []);

  useEffect(() => {
    const standalone = detectStandalone();
    const ios = detectIos();
    setIsStandalone(standalone);
    setIsIos(ios);
    setIsIosSafari(detectIosSafari());
    if (typeof Notification !== "undefined") setNotificationPermission(Notification.permission);

    const handlePrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      promptRef.current = promptEvent;
      setInstallPrompt(promptEvent);
    };
    window.addEventListener("beforeinstallprompt", handlePrompt);

    // Always register the SW on admin (including iOS Safari tabs) so Add to Home Screen
    // can pick up a real app + worker. Only skip auto-subscribe when push is blocked.
    const pushBlocked = Boolean(iosPushBlockedReason(ios, standalone));

    if ("serviceWorker" in navigator) {
      ensureServiceWorker().then(async (reg) => {
        setSwRegistration(reg);
        if (pushBlocked || !reg.pushManager) return;
        let sub = await reg.pushManager.getSubscription();
        if (!sub && typeof Notification !== "undefined" && Notification.permission === "granted" && vapidPublicKey) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          });
        }
        if (sub) {
          fetch("/api/push", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "subscribe", password, username,
              subscription: sub.toJSON(), userLabel: username || "admin",
            }),
          }).then(async (res) => {
            if (res.ok) {
              setPushSubscribed(true);
            } else {
              setPushSubscribed(false);
              setPushError((await res.json()).error || "Notification subscription needs attention");
            }
          }).catch(() => { setPushSubscribed(false); setPushError("Notification subscription needs attention"); });
        }
      }).catch(() => {
        if (!ios) setPushError("Notifications are unavailable in this browser");
      });
    } else if (!ios) {
      setPushError("Notifications are unavailable in this browser");
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
    };
  }, [password, username, vapidPublicKey]);

  const copyAdminUrl = useCallback(async () => {
    const url = typeof window !== "undefined" ? `${window.location.origin}/admin` : "https://www.gokohostel.com/admin";
    try {
      await navigator.clipboard.writeText(url);
      setAdminUrlCopied(true);
      setTimeout(() => setAdminUrlCopied(false), 2500);
    } catch {
      setPushError(`Copy this link into Safari: ${url}`);
    }
  }, []);

  const handleInstall = useCallback(async () => {
    const prompt = promptRef.current;
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      setInstalled(true);
      setInstallPrompt(null);
      promptRef.current = null;
    }
  }, []);

  const handleSubscribePush = useCallback(async () => {
    if (!vapidPublicKey || subscribing) return;
    setSubscribing(true);
    setPushError("");
    setPushMessage("");
    try {
      if (isIos && !isStandalone) {
        setPushError("On iPhone/iPad, install Goko from Safari (Share → Add to Home Screen), open the Home Screen icon, then tap Enable notifications.");
        return;
      }
      if (isIos && typeof window !== "undefined" && !("PushManager" in window)) {
        setPushError("This iOS version does not support web push. Update to iOS/iPadOS 16.4 or later, then try again from the Home Screen app.");
        return;
      }

      if (!("serviceWorker" in navigator) || typeof Notification === "undefined") {
        throw new Error("Push notifications are not supported by this browser");
      }

      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") {
        setPushError(isIos
          ? "Notifications were not allowed. Open Settings → Notifications → Goko and enable Allow Notifications, then try again."
          : "Notifications are blocked in browser settings");
        return;
      }

      const registration = swRegistration || await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      // iOS often fails subscribe until the worker is active.
      await navigator.serviceWorker.ready;
      setSwRegistration(registration);
      if (!registration.pushManager) {
        throw new Error(isIos
          ? "Push is unavailable in this app session. Close Goko fully, reopen it from the Home Screen, then try Enable again."
          : "Push notifications are not supported by this browser");
      }

      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });

      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          password,
          username,
          subscription: subscription.toJSON(),
          userLabel: username || "admin",
        }),
      });

      if (res.ok) {
        setPushSubscribed(true);
        setPushMessage("Notifications are enabled on this device.");
      } else {
        setPushError((await res.json()).error || "Could not enable notifications");
      }
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "Could not enable notifications");
    } finally {
      setSubscribing(false);
    }
  }, [swRegistration, vapidPublicKey, password, username, subscribing, isIos, isStandalone]);

  const handleTestPush = useCallback(async () => {
    if (pushAction) return;
    setPushAction("test");
    setPushError("");
    setPushMessage("");
    try {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", password, username }),
      });
      const data = await res.json();
      if (!res.ok || !(data.delivery?.delivered > 0)) {
        setPushError(data.error || "No subscribed device accepted the test");
      } else {
        setPushMessage(`Push service accepted the test for ${data.delivery.delivered} device(s). Check your phone to confirm display.`);
      }
    } catch {
      setPushError("Could not send the test notification. Please try again.");
    } finally { setPushAction(null); }
  }, [password, username, pushAction]);

  const handleUnsubscribePush = useCallback(async () => {
    if (!swRegistration || pushAction) return;
    setPushAction("disable");
    setPushError("");
    setPushMessage("");
    try {
      const subscription = await swRegistration.pushManager.getSubscription();
      if (!subscription) return setPushSubscribed(false);
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe", password, username, endpoint: subscription.endpoint }),
      });
      if (!res.ok) return setPushError((await res.json()).error || "Could not disable notifications");
      if (!await subscription.unsubscribe()) throw new Error("Could not disable the browser subscription. Please try again.");
      setPushSubscribed(false);
      setPushMessage("Notifications are disabled on this device.");
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "Could not disable notifications. Please try again.");
    } finally { setPushAction(null); }
  }, [swRegistration, password, username, pushAction]);

  const canNativeInstall = Boolean(installPrompt);
  const iosNeedsHomeScreen = isIos && !isStandalone;
  const pushUnavailable = !vapidPublicKey;
  const enableDisabled = subscribing || pushUnavailable || iosNeedsHomeScreen;
  const alreadyInstalled = isStandalone || installed;
  const statusLabel = pushSubscribed
    ? "Enabled on this device"
    : iosNeedsHomeScreen
      ? "Install to Home Screen first"
      : notificationPermission === "denied"
        ? "Blocked in browser settings"
        : pushUnavailable
          ? "Configuration unavailable"
          : "Not enabled";

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="relative" aria-label="Notification settings" title={`Notifications: ${statusLabel}`} />}>
        <BellIcon className="h-4 w-4" />
        <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${pushSubscribed ? "bg-emerald-500" : pushError || notificationPermission === "denied" || iosNeedsHomeScreen ? "bg-red-500" : "bg-amber-400"}`} />
      </DialogTrigger>

      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-brand-green-dark">
            <BellIcon className="h-5 w-5" /> Notification settings
          </DialogTitle>
          <DialogDescription>
            Receive alerts for bookings, changes, cancellations, food orders, and check-ins.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className={`flex items-center gap-3 rounded-xl border p-3 ${pushSubscribed ? "border-emerald-200 bg-emerald-50" : notificationPermission === "denied" || iosNeedsHomeScreen ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
            {pushSubscribed ? <CheckCircleIcon className="h-5 w-5 text-emerald-600" /> : <CircleAlertIcon className={`h-5 w-5 ${notificationPermission === "denied" || iosNeedsHomeScreen ? "text-red-600" : "text-amber-600"}`} />}
            <div>
              <p className="font-medium text-brand-green-dark">{statusLabel}</p>
              <p className="text-xs text-brand-green-dark/60">This setting applies only to this device and browser.</p>
            </div>
          </div>

          {pushError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{pushError}</p>}
          {pushMessage && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{pushMessage}</p>}

          {/* Install only lives here (admin bell dialog) — not on the public website.
              iOS has no install API; Safari Share → Add to Home Screen is the only path. */}
          <div className="rounded-xl border border-brand-mist bg-brand-sand/40 p-3 dark:bg-card">
            <div className="mb-2 flex items-center gap-2">
              <DownloadIcon className="h-4 w-4 text-brand-green" />
              <h3 className="text-sm font-medium text-brand-green-dark">Install app</h3>
            </div>
            {alreadyInstalled ? (
              <p className="text-xs leading-relaxed text-brand-green-dark/70">
                Goko is installed on this device. Open it from the Home Screen / app icon for the most reliable alerts.
              </p>
            ) : isIos ? (
              <div className="space-y-3">
                {!isIosSafari && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                    You are not in Safari. On iPhone, open <strong>Safari</strong>, go to Admin, then use Share → Add to Home Screen. Chrome/Firefox on iOS often cannot install a working Goko app for notifications.
                  </p>
                )}
                <ol className="space-y-2 text-xs leading-relaxed text-brand-green-dark/70">
                  <li className="flex gap-2">
                    <ShareIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-green" />
                    <span><strong>1.</strong> In <strong>Safari</strong> on this Admin page, tap the <strong>Share</strong> button (square with ↑).</span>
                  </li>
                  <li><strong>2.</strong> Scroll and tap <strong>Add to Home Screen</strong>, then Add. The icon should be named <strong>Goko</strong>.</li>
                  <li><strong>3.</strong> Leave Safari and open <strong>Goko</strong> from the Home Screen (not from Safari tabs).</li>
                  <li><strong>4.</strong> Open this bell again and tap <strong>Enable notifications</strong>. Needs iOS/iPadOS 16.4+.</li>
                </ol>
                {!isIosSafari && (
                  <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => void copyAdminUrl()}>
                    <CopyIcon /> {adminUrlCopied ? "Link copied" : "Copy Admin link for Safari"}
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {canNativeInstall ? (
                  <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={handleInstall}>
                    <DownloadIcon /> Install app
                  </Button>
                ) : (
                  <p className="text-xs leading-relaxed text-brand-green-dark/70">
                    In Chrome, open the browser menu (⋮) and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. After installing, open Goko from the app icon for the most reliable alerts.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {!pushSubscribed ? (
              <Button type="button" onClick={handleSubscribePush} disabled={enableDisabled}>
                {subscribing ? <Loader2Icon className="animate-spin" /> : <BellIcon />}
                Enable notifications
              </Button>
            ) : (
              <>
                <Button type="button" disabled={!!pushAction} onClick={handleTestPush}>{pushAction === "test" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Send test</Button>
                <Button type="button" disabled={!!pushAction} variant="outline" onClick={handleUnsubscribePush}>{pushAction === "disable" ? <Loader2Icon className="animate-spin" /> : <BellOffIcon />} Disable</Button>
              </>
            )}
          </div>
          {iosNeedsHomeScreen && (
            <p className="text-xs text-brand-green-dark/60">Enable is available after you open the installed Home Screen app.</p>
          )}

          <div className="border-t pt-4">
            <div className="mb-3 flex items-center gap-2">
              <SmartphoneIcon className="h-4 w-4 text-brand-green" />
              <h3 className="font-medium text-brand-green-dark">{isIos ? "iPhone and iPad tips" : "Android tips"}</h3>
            </div>
            {isIos ? (
              <ol className="space-y-2 text-xs leading-relaxed text-brand-green-dark/70">
                {isStandalone ? (
                  <>
                    <li><strong>1.</strong> Tap Enable notifications and choose Allow.</li>
                    <li><strong>2.</strong> If blocked or silent, open Settings → Notifications → Goko and enable Allow Notifications, Sounds, and the preferred alert style.</li>
                  </>
                ) : (
                  <li>Use the Install app steps above first. Push does not work from a normal Safari tab.</li>
                )}
              </ol>
            ) : (
              <ol className="space-y-2 text-xs leading-relaxed text-brand-green-dark/70">
                <li><strong>1.</strong> Tap Enable notifications and choose Allow when Chrome asks.</li>
                <li><strong>2.</strong> If blocked, open Chrome → Settings → Site settings → Notifications → gokohostel.com and choose Allow.</li>
                <li className="flex gap-2"><Volume2Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>For sound, open Android Settings → Apps → Chrome → Notifications → Goko/site notifications, then enable Sound and vibration.</span></li>
              </ol>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
