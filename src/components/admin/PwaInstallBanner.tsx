"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DownloadIcon, BellIcon, SmartphoneIcon, CheckCircleIcon, CircleAlertIcon, Loader2Icon, SendIcon, BellOffIcon, Volume2Icon } from "lucide-react";

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

export function PwaInstallBanner({ password, username }: { password: string; username?: string }) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState("");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [pushAction, setPushAction] = useState<"test" | "disable" | null>(null);
  const [pushError, setPushError] = useState("");
  const [pushMessage, setPushMessage] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [installed, setInstalled] = useState(false);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    fetch("/api/push", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setVapidPublicKey(data.publicKey || ""))
      .catch(() => setPushError("Could not load notification configuration"));
  }, []);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as any).standalone === true;
    setIsStandalone(standalone);

    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIos(ios);
    if (typeof Notification !== "undefined") setNotificationPermission(Notification.permission);

    const handlePrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      promptRef.current = promptEvent;
      setInstallPrompt(promptEvent);
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(async (reg) => {
        reg.update().catch(() => {});
        setSwRegistration(reg);
        if (reg.pushManager) {
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
        }
      }).catch(() => setPushError("Notifications are unavailable in this browser"));
    } else {
      setPushError("Notifications are unavailable in this browser");
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
    };
  }, [password, username, vapidPublicKey]);

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
      if (!("serviceWorker" in navigator) || typeof Notification === "undefined") {
        throw new Error("Push notifications are not supported by this browser");
      }

      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") {
        setPushError("Notifications are blocked in browser settings");
        return;
      }

      const registration = swRegistration || await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      setSwRegistration(registration);
      if (!registration.pushManager) throw new Error("Push notifications are not supported by this browser");
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
  }, [swRegistration, vapidPublicKey, password, username, subscribing]);

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

  const showInstallButton = installPrompt && !isStandalone && !installed;
  const pushUnavailable = !vapidPublicKey;
  const statusLabel = pushSubscribed
    ? "Enabled on this device"
    : notificationPermission === "denied"
      ? "Blocked in browser settings"
      : pushUnavailable
        ? "Configuration unavailable"
        : "Not enabled";

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="relative" aria-label="Notification settings" title={`Notifications: ${statusLabel}`} />}>
        <BellIcon className="h-4 w-4" />
        <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${pushSubscribed ? "bg-emerald-500" : pushError || notificationPermission === "denied" ? "bg-red-500" : "bg-amber-400"}`} />
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
          <div className={`flex items-center gap-3 rounded-xl border p-3 ${pushSubscribed ? "border-emerald-200 bg-emerald-50" : notificationPermission === "denied" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
            {pushSubscribed ? <CheckCircleIcon className="h-5 w-5 text-emerald-600" /> : <CircleAlertIcon className={`h-5 w-5 ${notificationPermission === "denied" ? "text-red-600" : "text-amber-600"}`} />}
            <div>
              <p className="font-medium text-brand-green-dark">{statusLabel}</p>
              <p className="text-xs text-brand-green-dark/60">This setting applies only to this device and browser.</p>
            </div>
          </div>

          {pushError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{pushError}</p>}
          {pushMessage && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{pushMessage}</p>}

          <div className="flex flex-wrap gap-2">
            {!pushSubscribed ? (
              <Button type="button" onClick={handleSubscribePush} disabled={subscribing || pushUnavailable}>
                {subscribing ? <Loader2Icon className="animate-spin" /> : <BellIcon />}
                Enable notifications
              </Button>
            ) : (
              <>
                <Button type="button" disabled={!!pushAction} onClick={handleTestPush}>{pushAction === "test" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Send test</Button>
                <Button type="button" disabled={!!pushAction} variant="outline" onClick={handleUnsubscribePush}>{pushAction === "disable" ? <Loader2Icon className="animate-spin" /> : <BellOffIcon />} Disable</Button>
              </>
            )}
            {showInstallButton && (
              <Button type="button" variant="outline" onClick={handleInstall}><DownloadIcon /> Install app</Button>
            )}
          </div>

          <div className="border-t pt-4">
            <div className="mb-3 flex items-center gap-2">
              <SmartphoneIcon className="h-4 w-4 text-brand-green" />
              <h3 className="font-medium text-brand-green-dark">{isIos ? "iPhone and iPad setup" : "Android setup"}</h3>
            </div>
            {isIos ? (
              <ol className="space-y-2 text-xs leading-relaxed text-brand-green-dark/70">
                {!isStandalone && <li><strong>1.</strong> In Safari, tap Share → Add to Home Screen, then open Goko from the Home Screen. Push requires iOS/iPadOS 16.4 or later.</li>}
                <li><strong>{isStandalone ? "1" : "2"}.</strong> Open this dialog in the installed Goko app and tap Enable notifications.</li>
                <li><strong>{isStandalone ? "2" : "3"}.</strong> If blocked or silent, open Settings → Notifications → Goko and enable Allow Notifications, Sounds, and the preferred alert style.</li>
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
