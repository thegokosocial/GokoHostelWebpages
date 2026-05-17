"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Container } from "@/components/ui/Container";
import { LockIcon, LogOutIcon, ExternalLinkIcon } from "lucide-react";

const COLUMNS = [
  "Submitted At",
  "Arrival Date",
  "Arrival Time",
  "Name",
  "Persons",
  "Contact",
  "Days",
  "Coming From",
  "Nationality",
  "Emergency Contact",
  "Emergency Phone",
  "ID Card",
  "Visa",
];

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const login = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.status === 401) {
        setError("Incorrect password");
        return;
      }

      if (!res.ok) throw new Error("Failed to fetch");

      const data = await res.json();
      setRows(data.rows || []);
      setAuthenticated(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) {
    return (
      <section className="flex min-h-screen items-center justify-center bg-brand-sand">
        <div className="w-full max-w-sm rounded-3xl border border-brand-mist bg-white p-8 shadow-card">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-green/[0.07]">
            <LockIcon className="h-6 w-6 text-brand-green" />
          </div>
          <h1 className="mt-5 text-center font-display text-xl font-bold text-brand-green">
            Admin Access
          </h1>
          <p className="mt-2 text-center text-sm text-brand-green-dark/70">
            Enter the admin password to view check-in records
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              login();
            }}
            className="mt-6 space-y-4"
          >
            <div>
              <Label htmlFor="admin-pw">Password</Label>
              <Input
                id="admin-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button
              type="submit"
              variant="cta"
              className="w-full"
              disabled={loading || !password}
            >
              {loading ? "Verifying..." : "Login"}
            </Button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-brand-sand py-8">
      <Container>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-brand-green">
            Check-in Records
          </h1>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ctaOutline"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                setAuthenticated(false);
                setPassword("");
                setRows([]);
              }}
            >
              <LogOutIcon className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <p className="mt-2 text-sm text-brand-green-dark/70">
          {rows.length} record{rows.length !== 1 ? "s" : ""} found
        </p>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-brand-mist bg-white shadow-card">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-brand-mist bg-brand-sand/50">
                {COLUMNS.map((col) => (
                  <th
                    key={col}
                    className="whitespace-nowrap px-4 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMNS.length}
                    className="px-4 py-12 text-center text-brand-green-dark/50"
                  >
                    No check-in records yet
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-brand-mist/60 last:border-b-0 hover:bg-brand-sand/30"
                  >
                    {COLUMNS.map((_, ci) => {
                      const cell = row[ci] || "";
                      const isLink =
                        cell.startsWith("http") ||
                        cell.startsWith("/uploads/");
                      return (
                        <td key={ci} className="whitespace-nowrap px-4 py-3">
                          {isLink ? (
                            <a
                              href={cell}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-brand-red hover:underline"
                            >
                              View
                              <ExternalLinkIcon className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <span className="text-brand-green-dark/90">
                              {cell}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Container>
    </section>
  );
}
