"use client";

import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { DEFAULT_INCOME_CATEGORIES, type IncomeCategory } from "@/lib/accountCategories";

export type IncomeAccount = { id: number; name: string; nickname: string; isDefault?: number };

export function incomeSourceLabel(source: string, sourceDetail?: string | null, categories: IncomeCategory[] = DEFAULT_INCOME_CATEGORIES) {
  const label = categories.find((item) => item.id === source)?.name || DEFAULT_INCOME_CATEGORIES.find((item) => item.id === source)?.name || source;
  return source === "other" && sourceDetail ? `${label} · ${sourceDetail}` : label;
}

export function IncomeForm({
  date,
  accounts,
  apiCall,
  onSaved,
  onCancel,
  showDate = false,
  compact = false,
}: {
  date: string;
  accounts: IncomeAccount[];
  apiCall: (body: Record<string, unknown>) => Promise<Response>;
  onSaved?: () => void | Promise<void>;
  onCancel?: () => void;
  showDate?: boolean;
  compact?: boolean;
}) {
  const [entryDate, setEntryDate] = useState(date);
  const [accountId, setAccountId] = useState("");
  const [type, setType] = useState<"cash" | "online">("cash");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("stay");
  const [sources, setSources] = useState<IncomeCategory[]>(DEFAULT_INCOME_CATEGORIES);
  const [sourceDetail, setSourceDetail] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => { setEntryDate(date); }, [date]);
  useEffect(() => {
    apiCall({ action: "getIncomeCategories" }).then(async (response) => {
      if (response.ok) setSources((await response.json()).categories || DEFAULT_INCOME_CATEGORIES);
    });
  }, [apiCall]);

  useEffect(() => {
    if (!sources.some((item) => item.id === source)) setSource(sources[0]?.id || "");
  }, [source, sources]);

  const selectAccount = (value: string) => {
    setAccountId(value);
    setType(value ? "online" : "cash");
    setError("");
  };

  const selectType = (value: "cash" | "online") => {
    setError("");
    setType(value);
    if (value === "cash") {
      setAccountId("");
    } else {
      const preferred = accounts.find((account) => account.isDefault) || accounts[0];
      setAccountId(preferred ? String(preferred.id) : "");
      if (!preferred) setError("No active online account exists. Add one in Management → Account Settings.");
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return setError("Enter a valid amount greater than zero.");
    if (source === "other" && !sourceDetail.trim()) return setError("Specify the other income source.");
    if (type === "online" && !accountId) return setError("Select an account for online income.");

    setSaving(true);
    try {
      const response = await apiCall({
        action: "addDailyIncome",
        idempotencyKey,
        date: entryDate,
        accountId: accountId ? Number(accountId) : null,
        type,
        amount: Math.round(amountNumber * 100),
        source,
        sourceDetail: source === "other" ? sourceDetail.trim() : "",
        description: description.trim(),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || "Failed to save income.");
        return;
      }
      setIdempotencyKey(crypto.randomUUID());
      setAmount("");
      setSourceDetail("");
      setDescription("");
      setSuccess("Income saved successfully.");
      await onSaved?.();
    } catch {
      setError("Something went wrong while saving income.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={cn(!compact && "rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 shadow-card dark:shadow-none sm:p-5")}>
      {!compact && <h3 className="font-display text-lg font-bold text-brand-green-dark">Add Income</h3>}
      <div className={cn("grid gap-3", !compact && "mt-4", showDate ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4")}>
        {showDate && <div><Label className="text-xs">Date *</Label><Input type="date" value={entryDate} max={new Date().toLocaleDateString("en-CA")} onChange={(event) => setEntryDate(event.target.value)} className="mt-1" required /></div>}
        <div>
          <Label className="text-xs">Account *</Label>
          <select value={accountId} onChange={(event) => selectAccount(event.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">Cash</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.nickname || account.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Type *</Label>
          <select value={type} onChange={(event) => selectType(event.target.value as "cash" | "online")} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="cash">Cash</option><option value="online">Online</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Source *</Label>
          <select value={source} onChange={(event) => { setSource(event.target.value); if (event.target.value !== "other") setSourceDetail(""); }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            {sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div><Label className="text-xs">Amount (₹) *</Label><Input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" className="mt-1" /></div>
        {source === "other" && <div><Label className="text-xs">Specify source *</Label><Input value={sourceDetail} maxLength={100} onChange={(event) => setSourceDetail(event.target.value)} placeholder="e.g. Scrap sale" className="mt-1" /></div>}
        <div className={cn(source === "other" ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-2")}><Label className="text-xs">Description (optional)</Label><Input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="Notes..." className="mt-1" /></div>
      </div>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {success && <p className="mt-3 text-xs text-emerald-700">{success}</p>}
      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : "Save Income"}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
