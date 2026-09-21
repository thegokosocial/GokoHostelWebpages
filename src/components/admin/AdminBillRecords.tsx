"use client";

import { useState, useEffect, useCallback } from "react";
import { useAdminToast } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLinkIcon, PencilIcon, Trash2Icon, XIcon, Loader2Icon, LayoutListIcon, TableIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminLoading } from "./AdminLoading";
import type { Role } from "./types";
import { hasPermission } from "./types";
import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/accountCategories";

export function AdminBillRecords({
  password,
  username,
  role,
  permissions = {},
}: {
  password: string;
  username?: string;
  role: Role;
  permissions?: Record<string, boolean>;
}) {
  const { showError } = useAdminToast();

  const expenseApi = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState(DEFAULT_EXPENSE_CATEGORIES);
  const [months, setMonths] = useState<string[]>([]);
  const [currentMonth, setCurrentMonth] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"card" | "table">(() => typeof window !== "undefined" && window.innerWidth < 1024 ? "card" : "table");
  const [expandedCard, setExpandedCard] = useState<number | null>(null);

  const [editModal, setEditModal] = useState<any | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPurpose, setEditPurpose] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const loadExpenses = useCallback(async (month?: string) => {
    setLoading(true);
    try {
      const res = await expenseApi({ action: "listExpenses", month });
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.expenses || []);
        if (data.months) setMonths(data.months);
        if (data.currentMonth) setCurrentMonth(data.currentMonth);
        setCategories(data.expenseCategories || DEFAULT_EXPENSE_CATEGORIES);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [expenseApi]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const filteredExpenses = searchQuery.trim()
    ? expenses.filter((exp) => {
        const q = searchQuery.toLowerCase();
        return (
          (exp.category || "").toLowerCase().includes(q) ||
          (exp.purpose || "").toLowerCase().includes(q) ||
          (exp.createdBy || "").toLowerCase().includes(q)
        );
      })
    : expenses;

  const totalPaise = filteredExpenses.reduce((sum: number, exp: any) => sum + (exp.amount || 0), 0);

  const openEdit = (exp: any) => {
    setEditModal(exp);
    setEditAmount(((exp.amount || 0) / 100).toString());
    setEditCategory(exp.category || "");
    setEditPurpose(exp.purpose || "");
  };

  const saveEdit = async () => {
    if (!editModal) return;
    const amountNum = parseFloat(editAmount);
    if (!amountNum || amountNum <= 0) return;
    setEditSaving(true);
    try {
      const res = await expenseApi({
        action: "updateExpense",
        id: editModal.id,
        amount: Math.round(amountNum * 100),
        category: editCategory,
        purpose: editPurpose.trim(),
      });
      if (res.ok) {
        setEditModal(null);
        loadExpenses(currentMonth);
      } else {
        const data = await res.json().catch(() => ({}));
        showError("Failed to update", data.error);
      }
    } finally {
      setEditSaving(false);
    }
  };

  const deleteExpense = async (id: number, billImageLink?: string) => {
    if (!confirm("Delete this expense record?")) return;
    try {
      const res = await expenseApi({ action: "deleteExpense", id, billImageLink });
      if (res.ok) {
        loadExpenses(currentMonth);
      } else {
        const data = await res.json().catch(() => ({}));
        showError("Failed to delete", data.error);
      }
    } catch {
      showError("Something went wrong");
    }
  };

  if (loading && expenses.length === 0) {
    return <AdminLoading message="Loading bill records..." />;
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-display text-lg font-bold text-brand-green-dark">Bill Records</h3>
        <Button type="button" variant="ctaOutline" onClick={() => loadExpenses(currentMonth)} disabled={loading}>
          {loading ? "..." : "Refresh"}
        </Button>
      </div>

      {months.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {months.map((month) => (
            <button
              key={month}
              type="button"
              onClick={() => loadExpenses(month)}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                month === currentMonth
                  ? "bg-brand-green text-white"
                  : "bg-white dark:bg-card text-brand-green-dark/70 hover:bg-brand-green/[0.06]"
              )}
            >
              {month}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search category, purpose, submitted by..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:max-w-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="rounded-md bg-brand-red/10 px-3 py-2 text-xs font-medium text-brand-red hover:bg-brand-red/20"
          >
            Clear
          </button>
        )}
        <p className="sm:ml-auto text-sm text-brand-green-dark/70">
          {filteredExpenses.length}{filteredExpenses.length !== expenses.length ? ` of ${expenses.length}` : ""} records
        </p>
        <div className="flex rounded-lg border border-brand-mist bg-white dark:bg-card p-0.5">
          <button type="button" onClick={() => setViewMode("card")} className={cn("rounded-md p-1.5 transition-colors", viewMode === "card" ? "bg-brand-green text-white" : "text-brand-green-dark/50 hover:bg-brand-sand")} title="Card view">
            <LayoutListIcon className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setViewMode("table")} className={cn("rounded-md p-1.5 transition-colors", viewMode === "table" ? "bg-brand-green text-white" : "text-brand-green-dark/50 hover:bg-brand-sand")} title="Table view">
            <TableIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Card View */}
      {viewMode === "card" && (
        <div className="mt-4 space-y-2">
          {filteredExpenses.length === 0 ? (
            <p className="py-12 text-center text-brand-green-dark/50">{expenses.length === 0 ? "No expense records" : "No matches"}</p>
          ) : (
            filteredExpenses.map((exp: any, i: number) => {
              const isExpanded = expandedCard === i;
              return (
                <div key={exp.id || i} className="rounded-xl border border-brand-mist bg-white dark:bg-card shadow-sm dark:shadow-none">
                  <button
                    type="button"
                    onClick={() => setExpandedCard(isExpanded ? null : i)}
                    className="flex w-full items-start justify-between gap-2 p-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-brand-green-dark">{exp.category || "Uncategorized"}</span>
                        <span className="rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-bold text-brand-green-dark">₹{((exp.amount || 0) / 100).toFixed(0)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-green-dark/60">
                        <span>{exp.expenseDate || (exp.createdAt ? new Date(exp.createdAt).toLocaleDateString() : "—")}</span>
                        {exp.purpose && <span className="truncate max-w-[180px]">{exp.purpose}</span>}
                      </div>
                    </div>
                    <ChevronDownIcon className={cn("h-4 w-4 shrink-0 text-brand-green-dark/40 transition-transform mt-1", isExpanded && "rotate-180")} />
                  </button>

                  {isExpanded && (
                    <div className="border-t border-brand-mist px-3 pb-3 pt-2">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                        <div><span className="text-brand-green-dark/50">Date:</span> <span className="text-brand-green-dark">{exp.expenseDate || (exp.createdAt ? new Date(exp.createdAt).toLocaleDateString() : "—")}</span></div>
                        <div><span className="text-brand-green-dark/50">Category:</span> <span className="text-brand-green-dark">{exp.category || "—"}</span></div>
                        <div className="col-span-2"><span className="text-brand-green-dark/50">Purpose:</span> <span className="text-brand-green-dark">{exp.purpose || "—"}</span></div>
                        <div><span className="text-brand-green-dark/50">Amount:</span> <span className="font-medium text-brand-green-dark">₹{((exp.amount || 0) / 100).toFixed(0)}</span></div>
                        <div><span className="text-brand-green-dark/50">By:</span> <span className="text-brand-green-dark">{exp.createdBy || "—"}</span></div>
                      </div>

                      {exp.billImageLink && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {exp.billImageLink.split(",").map((link: string, li: number) => (
                            <a
                              key={li}
                              href={link.trim()}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md bg-brand-green/[0.06] px-2 py-1 text-[10px] font-medium text-brand-green hover:bg-brand-green/[0.12]"
                            >
                              Bill {exp.billImageLink.includes(",") ? `#${li + 1}` : ""} <ExternalLinkIcon className="h-2.5 w-2.5" />
                            </a>
                          ))}
                        </div>
                      )}

                      {(hasPermission(role, permissions, "canEditExpense") || hasPermission(role, permissions, "canDeleteExpense")) && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-brand-mist pt-2">
                          {hasPermission(role, permissions, "canEditExpense") && (
                            <button type="button" onClick={() => openEdit(exp)} className="flex items-center gap-1 rounded-lg bg-brand-sand px-2 py-1 text-[10px] font-medium text-brand-green-dark/70 hover:bg-brand-green/10">
                              <PencilIcon className="h-3 w-3" /> Edit
                            </button>
                          )}
                          {hasPermission(role, permissions, "canDeleteExpense") && (
                            <button type="button" onClick={() => deleteExpense(exp.id, exp.billImageLink)} className="flex items-center gap-1 rounded-lg bg-red-50 dark:bg-red-950 px-2 py-1 text-[10px] font-medium text-red-600 hover:bg-red-100 dark:hover:bg-red-900/50">
                              <Trash2Icon className="h-3 w-3" /> Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
          {filteredExpenses.length > 0 && (
            <div className="rounded-xl border border-brand-mist bg-brand-sand/30 px-4 py-3 text-right">
              <span className="font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Total: </span>
              <span className="font-display text-sm font-bold text-brand-green-dark">₹{(totalPaise / 100).toFixed(0)}</span>
            </div>
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && <div className="isolate mt-4 min-w-0 max-w-full overflow-x-auto overflow-y-visible overscroll-x-contain rounded-2xl border border-brand-mist bg-white [touch-action:pan-x_pan-y] dark:bg-card shadow-card dark:shadow-none">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-brand-sand/95">
            <tr className="border-b border-brand-mist bg-brand-sand/50">
              <th className="whitespace-nowrap bg-brand-sand px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Date</th>
              <th className="whitespace-nowrap bg-brand-sand px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Category</th>
              <th className="whitespace-nowrap bg-brand-sand px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Purpose</th>
              <th className="whitespace-nowrap bg-brand-sand px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Amount (₹)</th>
              <th className="whitespace-nowrap bg-brand-sand px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Bill</th>
              <th className="whitespace-nowrap bg-brand-sand px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Submitted By</th>
              {(hasPermission(role, permissions, "canEditExpense") || hasPermission(role, permissions, "canDeleteExpense")) && (
                <th className="whitespace-nowrap bg-brand-sand px-3 py-3 font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan={(hasPermission(role, permissions, "canEditExpense") || hasPermission(role, permissions, "canDeleteExpense")) ? 7 : 6} className="px-4 py-12 text-center text-brand-green-dark/50">
                  {expenses.length === 0 ? "No expense records" : "No matches"}
                </td>
              </tr>
            ) : (
              filteredExpenses.map((exp: any, i: number) => (
                <tr key={exp.id || i} className="border-b border-brand-mist/60 last:border-b-0 hover:bg-brand-sand/30">
                  <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/90">
                    {exp.expenseDate || (exp.createdAt ? new Date(exp.createdAt).toLocaleDateString() : "—")}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/90">{exp.category || "—"}</td>
                  <td className="max-w-[200px] truncate px-3 py-3 text-brand-green-dark/70">{exp.purpose || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-medium text-brand-green-dark">
                    ₹{((exp.amount || 0) / 100).toFixed(0)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {exp.billImageLink ? (
                      <span className="inline-flex flex-wrap gap-1">
                        {exp.billImageLink.split(",").map((link: string, li: number) => (
                          <a
                            key={li}
                            href={link.trim()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-brand-green/[0.06] px-2 py-1 text-xs font-medium text-brand-green hover:bg-brand-green/[0.12]"
                          >
                            {exp.billImageLink.includes(",") ? `#${li + 1}` : "View"} <ExternalLinkIcon className="h-3 w-3" />
                          </a>
                        ))}
                      </span>
                    ) : (
                      <span className="text-brand-green-dark/40">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-brand-green-dark/70">{exp.createdBy || "—"}</td>
                  {(hasPermission(role, permissions, "canEditExpense") || hasPermission(role, permissions, "canDeleteExpense")) && (
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {hasPermission(role, permissions, "canEditExpense") && (
                          <button
                            type="button"
                            onClick={() => openEdit(exp)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-brand-green/70 hover:bg-brand-green/[0.06]"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                        )}
                        {hasPermission(role, permissions, "canDeleteExpense") && (
                          <button
                            type="button"
                            onClick={() => deleteExpense(exp.id, exp.billImageLink)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                          >
                            <Trash2Icon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {filteredExpenses.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-brand-mist bg-brand-sand/30">
                <td colSpan={3} className="px-3 py-3 text-right font-display text-xs font-bold uppercase tracking-wide text-brand-green-dark/70">
                  Total
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-display text-sm font-bold text-brand-green-dark">
                  ₹{(totalPaise / 100).toFixed(0)}
                </td>
                <td colSpan={(hasPermission(role, permissions, "canEditExpense") || hasPermission(role, permissions, "canDeleteExpense")) ? 3 : 2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>}

      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={() => setEditModal(null)}>
          <div className="w-full max-w-md rounded-2xl border border-brand-mist bg-white dark:bg-card p-6 shadow-xl dark:shadow-none" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-brand-green-dark">Edit Expense</h3>
              <button type="button" onClick={() => setEditModal(null)} className="rounded-md p-1 text-brand-green-dark/40 hover:text-brand-green-dark">
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <Label className="text-xs">Amount (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select...</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  {!categories.includes(editCategory) && editCategory && (
                    <option value={editCategory}>{editCategory}</option>
                  )}
                </select>
              </div>
              <div>
                <Label className="text-xs">Purpose</Label>
                <textarea
                  value={editPurpose}
                  onChange={(e) => setEditPurpose(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="button" onClick={saveEdit} disabled={editSaving}>
                {editSaving ? <><Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditModal(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
