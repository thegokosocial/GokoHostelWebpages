"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { LockIcon } from "lucide-react";

const KitchenDashboard = dynamic(
  () => import("@/components/kitchen/KitchenDashboard").then((m) => m.KitchenDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    ),
  },
);

export default function KitchenPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [inputPassword, setInputPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/session?scope=kitchen")
      .then((res) => { if (res.ok) setAuthenticated(true); })
      .catch(() => {});
  }, []);

  // Kitchen access uses its own server-side session and remains separate from
  // admin-panel permissions.
  const login = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: inputPassword, scope: "kitchen" }),
      });
      if (res.status === 401) {
        setError("Incorrect password");
        return;
      }
      if (!res.ok) throw new Error("Failed");
      setAuthenticated(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    void fetch("/api/auth/logout?scope=kitchen", { method: "POST" });
    setAuthenticated(false);
    setInputPassword("");
  };

  if (!authenticated) {
    return (
      <section className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-background">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 dark:border-border bg-white dark:bg-card p-8 shadow-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-500/10">
            <LockIcon className="h-6 w-6 text-amber-500" />
          </div>
          <h1 className="mt-5 text-center text-xl font-bold text-gray-900 dark:text-foreground">
            Kitchen Dashboard
          </h1>
          <p className="mt-1 text-center text-sm text-gray-500 dark:text-muted-foreground">
            Enter staff password to access
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              login();
            }}
            className="mt-6 space-y-4"
          >
            <input
              type="password"
              value={inputPassword}
              onChange={(e) => setInputPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              className="w-full rounded-xl border border-gray-300 dark:border-border bg-white dark:bg-muted px-4 py-3 text-gray-900 dark:text-foreground placeholder-gray-400 dark:placeholder-muted-foreground outline-none transition-all duration-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 dark:focus:ring-amber-500/30 focus:shadow-sm"
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={loading || !inputPassword}
              className="w-full rounded-xl bg-amber-500 px-4 py-3 font-semibold text-white transition-all duration-200 hover:bg-amber-400 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {loading ? "Verifying..." : "Enter Kitchen"}
            </button>
          </form>
        </div>
      </section>
    );
  }

  return <KitchenDashboard password="" onLogout={logout} />;
}
