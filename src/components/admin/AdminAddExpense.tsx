"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2Icon, ExternalLinkIcon, FileTextIcon, XIcon } from "lucide-react";
import { AdminLoading } from "./AdminLoading";
import type { Role } from "./types";
import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/accountCategories";

const MAIN_CATEGORIES = [
  { id: "stay_expense", label: "Stay Expense" },
  { id: "food_expense", label: "Food Expense" },
];

const ALLOWED_BILL_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BILL_FILES = 5;
const MAX_BILL_FILE_BYTES = 10 * 1024 * 1024;

type Account = { id: number; name: string; nickname: string };
type Vendor = { id: number; name: string; category: string };

const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function AdminAddExpense({
  password,
  username,
  role,
  permissions,
}: {
  password: string;
  username?: string;
  role: Role;
  permissions?: Record<string, boolean>;
}) {
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIST);
  const [mainCategory, setMainCategory] = useState("stay_expense");
  const [subCategory, setSubCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [purpose, setPurpose] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [billFiles, setBillFiles] = useState<File[]>([]);
  const [billPreviews, setBillPreviews] = useState<(string | null)[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState(DEFAULT_EXPENSE_CATEGORIES);
  const [recentExpenses, setRecentExpenses] = useState<any[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const expenseApi = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const settingsApi = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/account-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const loadData = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const [recentRes, vendorRes, accRes, categoryRes] = await Promise.all([
        expenseApi({ action: "getMyExpenses" }),
        settingsApi({ action: "listVendors" }),
        settingsApi({ action: "listAccounts" }),
        expenseApi({ action: "getExpenseCategories" }),
      ]);
      if (recentRes.ok) { const d = await recentRes.json(); setRecentExpenses(d.expenses || []); }
      if (vendorRes.ok) { const d = await vendorRes.json(); setVendors(d.vendors || []); }
      if (accRes.ok) {
        const d = await accRes.json();
        setAccounts(d.accounts || []);
        const defaultAcc = (d.accounts || []).find((a: any) => a.isDefault);
        if (defaultAcc) setAccountId(String(defaultAcc.id));
      }
      if (categoryRes.ok) setCategories((await categoryRes.json()).categories || DEFAULT_EXPENSE_CATEGORIES);
    } finally {
      setLoadingRecent(false);
    }
  }, [expenseApi, settingsApi]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    if (files.some((file) => !ALLOWED_BILL_MIME.has(file.type))) {
      setError("Only JPEG, PNG, WebP, and PDF files are supported");
      return;
    }
    if (files.some((file) => file.size === 0 || file.size > MAX_BILL_FILE_BYTES)) {
      setError("Each bill file must be between 1 byte and 10 MB");
      return;
    }
    if (billFiles.length + files.length > MAX_BILL_FILES) {
      setError(`You can attach up to ${MAX_BILL_FILES} bill files`);
      return;
    }
    const previews = await Promise.all(files.map((file) => {
      if (!file.type.startsWith("image/")) return Promise.resolve(null);
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    }));
    setBillFiles((prev) => [...prev, ...files]);
    setBillPreviews((prev) => [...prev, ...previews]);
    setError("");
  };

  const removeFile = (index: number) => {
    setBillFiles((prev) => prev.filter((_, i) => i !== index));
    setBillPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const clearFiles = () => { setBillFiles([]); setBillPreviews([]); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) { setError("Please enter a valid amount"); return; }
    if (!subCategory) { setError("Please select a category"); return; }
    if (subCategory === "Others" && !customCategory.trim()) { setError("Please enter a description for Others"); return; }
    if (paymentMethod === "online" && !accountId) { setError("Please select an account for online payment"); return; }

    setSubmitting(true);
    try {
      const body: Record<string, any> = {
        action: "addExpense",
        idempotencyKey,
        amount: Math.round(amountNum * 100),
        category: subCategory === "Others" ? customCategory.trim() : subCategory,
        customCategory: subCategory === "Others" ? customCategory.trim() : undefined,
        purpose: purpose.trim() || (subCategory === "Others" ? customCategory.trim() : subCategory),
        mainCategory,
        subCategory,
        vendorId: vendorId ? parseInt(vendorId) : undefined,
        paymentMethod,
        accountId: paymentMethod === "online" && accountId ? parseInt(accountId) : undefined,
        expenseDate,
      };

      if (billFiles.length > 0) {
        const attachments: { data: string; mime: string; name: string }[] = [];
        for (const file of billFiles) {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => { resolve((reader.result as string).split(",")[1]); };
            reader.readAsDataURL(file);
          });
          attachments.push({ data: base64, mime: file.type, name: file.name });
        }
        body.billFiles = attachments;
      }

      const res = await expenseApi(body);
      if (res.ok) {
        setIdempotencyKey(crypto.randomUUID());
        setSuccess("Expense submitted successfully!");
        setAmount("");
        setExpenseDate(todayIST());
        setSubCategory("");
        setCustomCategory("");
        setPurpose("");
        setVendorId("");
        clearFiles();
        loadData();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to submit expense");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 shadow-card dark:shadow-none sm:p-5">
        <h3 className="font-display text-lg font-bold text-brand-green-dark">Add Expense</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Amount */}
          <div>
            <Label className="text-xs">Amount (₹) *</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500"
              className="mt-1"
            />
          </div>

          {/* Expense date */}
          <div>
            <Label className="text-xs">Expense Date *</Label>
            <Input
              type="date"
              value={expenseDate}
              max={todayIST()}
              onChange={(e) => setExpenseDate(e.target.value)}
              className="mt-1"
            />
          </div>

          {/* Main Category */}
          <div>
            <Label className="text-xs">Type</Label>
            <select
              value={mainCategory}
              onChange={(e) => setMainCategory(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {MAIN_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Sub Category */}
          <div>
            <Label className="text-xs">Category *</Label>
            <select
              value={subCategory}
              onChange={(e) => setSubCategory(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select category...</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Vendor */}
          <div>
            <Label className="text-xs">Vendor (optional)</Label>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">No vendor / Other</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}{v.category ? ` (${v.category})` : ""}</option>
              ))}
            </select>
          </div>

          {/* Payment Method */}
          <div>
            <Label className="text-xs">Payment Method</Label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </select>
          </div>

          {/* Account (shown only for online) */}
          {paymentMethod === "online" && (
            <div>
              <Label className="text-xs">Account</Label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select account...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.nickname || a.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Custom category name for Others */}
          {subCategory === "Others" && (
            <div className="sm:col-span-2">
              <Label className="text-xs">Description / Reason *</Label>
              <Input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="Enter expense description"
                className="mt-1"
              />
            </div>
          )}

          {/* Purpose */}
          <div className="sm:col-span-2">
            <Label className="text-xs">Notes (optional)</Label>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Additional notes..."
              rows={2}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Bill attachments */}
          <div className="sm:col-span-2">
            <Label className="text-xs">Bill attachments (optional)</Label>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-brand-sand/50">
                <FileTextIcon className="h-4 w-4 text-brand-green" />
                {billFiles.length > 0 ? "Add files" : "Choose files"}
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" onChange={(event) => void handleFileChange(event)} />
              </label>
              {billFiles.length > 0 && (
                <span className="text-xs text-brand-green-dark/60">{billFiles.length} of {MAX_BILL_FILES} files selected</span>
              )}
            </div>
            <p className="mt-1 text-xs text-brand-green-dark/50">JPEG, PNG, WebP, or PDF · up to 10 MB each</p>
            {billPreviews.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {billPreviews.map((preview, i) => (
                  <div key={i} className="relative">
                    {preview ? (
                      <img src={preview} alt={`Bill ${i + 1}`} className="h-24 w-auto rounded-lg border border-brand-mist object-cover" />
                    ) : (
                      <div className="flex h-24 w-32 flex-col items-center justify-center rounded-lg border border-brand-mist bg-brand-sand/50 px-2 text-center text-xs text-brand-green-dark/70">
                        <FileTextIcon className="mb-1 h-5 w-5" />
                        <span className="line-clamp-2 break-all">{billFiles[i]?.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white shadow-sm hover:bg-red-600"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        {success && <p className="mt-3 text-sm text-green-600">{success}</p>}

        <div className="mt-4">
          <Button type="submit" variant="cta" disabled={submitting}>
            {submitting ? (
              <><Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> Submitting...</>
            ) : (
              "Submit Expense"
            )}
          </Button>
        </div>
      </form>

      {/* Recent Submissions */}
      <div className="mt-8">
        <h3 className="font-display text-lg font-bold text-brand-green-dark">
          Your Recent Submissions (Last 7 Days)
        </h3>
        {loadingRecent ? (
          <AdminLoading message="Loading recent expenses..." />
        ) : recentExpenses.length === 0 ? (
          <p className="mt-4 text-center text-sm text-brand-green-dark/50">No submissions in the last 7 days</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-brand-mist bg-white dark:bg-card shadow-card dark:shadow-none">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-brand-mist bg-brand-sand/50">
                  <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Date</th>
                  <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Category</th>
                  <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Amount</th>
                  <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Method</th>
                  <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Purpose</th>
                  <th className="whitespace-nowrap px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Bill</th>
                </tr>
              </thead>
              <tbody>
                {recentExpenses.map((exp: any, i: number) => (
                  <tr key={exp.id || i} className="border-b border-brand-mist/60 last:border-b-0 hover:bg-brand-sand/30">
                    <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/90">
                      {exp.expenseDate || (exp.createdAt ? new Date(exp.createdAt).toLocaleDateString() : "—")}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/90">{exp.subCategory || exp.category || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-brand-green-dark">₹{(exp.amount / 100).toFixed(0)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/70">{exp.paymentMethod || "cash"}</td>
                    <td className="max-w-[200px] truncate px-3 py-3 text-brand-green-dark/70">{exp.purpose || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {exp.billImageLink ? (
                        <span className="inline-flex flex-wrap gap-1">
                          {exp.billImageLink.split(",").map((link: string, li: number) => (
                            <a key={li} href={link.trim()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-brand-green/[0.06] px-2 py-1 text-xs font-medium text-brand-green hover:bg-brand-green/[0.12]">
                              {exp.billImageLink.includes(",") ? `#${li + 1}` : "View"} <ExternalLinkIcon className="h-3 w-3" />
                            </a>
                          ))}
                        </span>
                      ) : (
                        <span className="text-brand-green-dark/40">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
