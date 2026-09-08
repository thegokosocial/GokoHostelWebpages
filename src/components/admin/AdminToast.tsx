"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { XIcon, CopyIcon, CheckIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon } from "lucide-react";

type ToastType = "error" | "success" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  debugInfo?: string;
}

interface AdminToastContextValue {
  showError: (message: string, debugInfo?: string) => void;
  showSuccess: (message: string) => void;
  showInfo: (message: string) => void;
}

const AdminToastContext = createContext<AdminToastContextValue | null>(null);

export function useAdminToast(): AdminToastContextValue {
  const ctx = useContext(AdminToastContext);
  if (!ctx) {
    return {
      showError: (msg) => alert(msg),
      showSuccess: (msg) => alert(msg),
      showInfo: (msg) => alert(msg),
    };
  }
  return ctx;
}

export function AdminToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const addToast = useCallback((type: ToastType, message: string, debugInfo?: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, type, message, debugInfo }]);
    const timeout = type === "error" ? 10000 : 4000;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, timeout);
  }, []);

  const showError = useCallback((message: string, debugInfo?: string) => {
    const info = buildDebugString(message, debugInfo);
    addToast("error", message, info);
  }, [addToast]);

  const showSuccess = useCallback((message: string) => {
    addToast("success", message);
  }, [addToast]);

  const showInfo = useCallback((message: string) => {
    addToast("info", message);
  }, [addToast]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <AdminToastContext.Provider value={{ showError, showSuccess, showInfo }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </AdminToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!toast.debugInfo) return;
    try {
      await navigator.clipboard.writeText(toast.debugInfo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = toast.debugInfo;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const bgClass = toast.type === "error"
    ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
    : toast.type === "success"
      ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
      : "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800";

  const iconClass = toast.type === "error"
    ? "text-red-500"
    : toast.type === "success"
      ? "text-green-500"
      : "text-blue-500";

  const textClass = toast.type === "error"
    ? "text-red-800"
    : toast.type === "success"
      ? "text-green-800"
      : "text-blue-800";

  const Icon = toast.type === "error"
    ? AlertTriangleIcon
    : toast.type === "success"
      ? CheckCircleIcon
      : InfoIcon;

  return (
    <div className={`pointer-events-auto rounded-xl border p-3 shadow-lg dark:shadow-none ${bgClass} animate-in slide-in-from-right-5`}>
      <div className="flex items-start gap-2.5">
        <Icon className={`h-4.5 w-4.5 mt-0.5 flex-shrink-0 ${iconClass}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${textClass}`}>{toast.message}</p>
          {toast.debugInfo && (
            <button
              type="button"
              onClick={handleCopy}
              className="mt-1.5 flex items-center gap-1.5 rounded-md bg-white/80 dark:bg-white/10 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-white/10 transition hover:bg-white dark:hover:bg-white/20 hover:text-gray-900 dark:hover:text-gray-200"
            >
              {copied ? (
                <>
                  <CheckIcon className="h-3 w-3 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <CopyIcon className="h-3 w-3" />
                  Copy error details
                </>
              )}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="flex-shrink-0 rounded-md p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function buildDebugString(message: string, rawError?: string): string {
  const now = new Date();
  const ist = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" });
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const win = typeof window !== "undefined" ? window : null;
  const connection = nav && "connection" in nav
    ? (nav.connection as { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean })
    : null;
  const lines = [
    `--- Goko Error Report ---`,
    `Report ID: ${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : now.getTime()}`,
    `Time: ${ist}`,
    `UTC: ${now.toISOString()}`,
    `Message: ${message}`,
  ];
  if (rawError) {
    lines.push(`Details: ${rawError}`);
  }
  lines.push(`URL: ${win?.location.href || "unknown"}`);
  lines.push(`Section: ${win ? new URLSearchParams(win.location.search).get("section") || "none" : "unknown"}`);
  lines.push(`Referrer: ${typeof document !== "undefined" ? document.referrer || "direct" : "unknown"}`);
  lines.push(`Build: ${process.env.BUILD_VERSION || "unknown"}`);
  lines.push(`Online: ${nav?.onLine ?? "unknown"}`);
  lines.push(`Network: ${connection ? `${connection.effectiveType || "unknown"}, ${connection.downlink ?? "?"} Mbps, ${connection.rtt ?? "?"} ms RTT, save-data=${connection.saveData ?? false}` : "unavailable"}`);
  lines.push(`Viewport: ${win ? `${win.innerWidth}x${win.innerHeight} @${win.devicePixelRatio}x` : "unknown"}`);
  lines.push(`Screen: ${win ? `${win.screen.width}x${win.screen.height}, ${win.screen.orientation?.type || "unknown"}` : "unknown"}`);
  lines.push(`Visibility: ${typeof document !== "undefined" ? document.visibilityState : "unknown"}`);
  lines.push(`Language: ${nav?.language || "unknown"}`);
  lines.push(`Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown"}`);
  lines.push(`Platform: ${nav?.platform || "unknown"}; touch=${nav?.maxTouchPoints ?? "unknown"}`);
  lines.push(`UA: ${nav?.userAgent || "unknown"}`);
  lines.push(`---`);
  return lines.join("\n");
}
