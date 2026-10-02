"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminToast } from "./AdminToast";
import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/accountCategories";
import type { Role } from "./types";
import { hasPermission } from "./types";

const todayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
type Bill = any;

async function filesPayload(files: FileList | null) {
  return Promise.all(
    Array.from(files || []).map(async (file) => ({
      name: file.name,
      mime: file.type,
      data: await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(String(reader.result).split(",")[1] || "");
        reader.readAsDataURL(file);
      }),
    })),
  );
}

export function AdminPayableBills({
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
  const { showError, showSuccess } = useAdminToast();
  const canView = hasPermission(role, permissions, "canViewExpenses");
  const canAdd = hasPermission(role, permissions, "canAddExpense");
  const canEdit = hasPermission(role, permissions, "canEditExpense");
  const canDelete = hasPermission(role, permissions, "canDeleteExpense");
  const [bills, setBills] = useState<Bill[]>([]);
  const [showPaid, setShowPaid] = useState(false);
  const [selected, setSelected] = useState<Bill | null>(null);
  const [form, setForm] = useState<any>({
    title: "",
    originalAmount: "",
    category: "",
    mainCategory: "stay_expense",
    vendorId: "",
    description: "",
    billDate: todayIST(),
    dueDate: "",
  });
  const [payment, setPayment] = useState<any>({
    amount: "",
    expenseDate: todayIST(),
    paymentMethod: "cash",
    accountId: "",
    note: "",
    key: crypto.randomUUID(),
  });
  const [accounts, setAccounts] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [formFiles, setFormFiles] = useState<FileList | null>(null);
  const [paymentFiles, setPaymentFiles] = useState<FileList | null>(null);
  const [editFiles, setEditFiles] = useState<FileList | null>(null);
  const [noteText, setNoteText] = useState("");
  const [newTotal, setNewTotal] = useState("");
  const [increaseReason, setIncreaseReason] = useState("");
  const [dialog, setDialog] = useState<"" | "note" | "total">("");
  const api = useCallback(
    (body: Record<string, unknown>) =>
      fetch("/api/admin/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, username, ...body }),
      }),
    [password, username],
  );
  const load = useCallback(async () => {
    if (!canView) return;
    const res = await api({ action: "listPayableBills" });
    if (res.ok) setBills((await res.json()).bills || []);
  }, [api, canView]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (canAdd)
      api({ action: "getExpenseEditOptions" }).then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setAccounts(data.accounts || []);
          setVendors(data.vendors || []);
        }
      });
  }, [api, canAdd]);
  const refresh = async (id?: number) => {
    await load();
    if (id && canView) {
      const res = await api({ action: "getPayableBill", id });
      if (res.ok) setSelected((await res.json()).bill);
    }
  };
  const create = async () => {
    const amount = Math.round(Number(form.originalAmount) * 100);
    if (!form.title.trim() || !amount || !form.category)
      return showError("Title, total, and category are required");
    setBusy(true);
    try {
      const res = await api({
        action: "createPayableBill",
        ...form,
        title: form.title.trim(),
        originalAmount: amount,
        billFiles: await filesPayload(formFiles),
      });
      if (!res.ok)
        return showError("Could not create bill", (await res.json()).error);
      showSuccess("Payable bill created");
      setForm({
        title: "",
        originalAmount: "",
        category: "",
        mainCategory: "stay_expense",
        vendorId: "",
        description: "",
        billDate: todayIST(),
        dueDate: "",
      });
      setFormFiles(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const pay = async () => {
    if (!selected) return;
    const amount = Math.round(Number(payment.amount) * 100);
    if (
      !amount ||
      amount > selected.remaining ||
      !payment.note.trim() ||
      (payment.paymentMethod === "online" && !payment.accountId)
    )
      return showError("Enter a valid payment, note, and account when paying online");
    setBusy(true);
    try {
      const res = await api({
        action: "recordPayableBillPayment",
        id: selected.id,
        amount,
        expenseDate: payment.expenseDate,
        paymentMethod: payment.paymentMethod,
        paymentNote: payment.note.trim(),
        accountId:
          payment.paymentMethod === "online" ? Number(payment.accountId) : null,
        idempotencyKey: payment.key,
        billFiles: await filesPayload(paymentFiles),
      });
      if (!res.ok)
        return showError("Could not record payment", (await res.json()).error);
      showSuccess("Payment recorded");
      setPayment({
        amount: "",
        expenseDate: todayIST(),
        paymentMethod: "cash",
        accountId: "",
        note: "",
        key: crypto.randomUUID(),
      });
      setPaymentFiles(null);
      await refresh(selected.id);
    } finally {
      setBusy(false);
    }
  };
  const appendInvoices = async () => {
    if (!selected || !editFiles?.length) return;
    setBusy(true);
    try {
      const res = await api({ action: "updatePayableBill", id: selected.id, billFiles: await filesPayload(editFiles) });
      if (!res.ok) return showError("Could not add invoices", (await res.json()).error);
      setEditFiles(null);
      showSuccess("Invoice files added");
      await refresh(selected.id);
    } finally {
      setBusy(false);
    }
  };
  const addNote = async () => {
    if (!selected) return;
    const body = noteText.trim();
    if (!body) return;
    setBusy(true);
    try {
    const res = await api({
      action: "addPayableBillNote",
      id: selected.id,
      body,
    });
    if (!res.ok)
      return showError("Could not add note", (await res.json()).error);
    setNoteText(""); setDialog(""); showSuccess("Note added");
    await refresh(selected.id);
    } catch { showError("Could not add note", "Check your connection and try again"); }
    finally { setBusy(false); }
  };
  const increase = async () => {
    if (!selected) return;
    const total = Math.round(Number(newTotal) * 100);
    const amount = total - selected.total;
    const reason = increaseReason.trim();
    if (!amount || amount < 0 || !reason) return showError("Enter a higher new total and a reason");
    setBusy(true);
    try {
    const res = await api({
      action: "increasePayableBillTotal",
      id: selected.id,
      newTotal: total,
      reason,
    });
    if (!res.ok)
      return showError("Could not increase total", (await res.json()).error);
    setNewTotal(""); setIncreaseReason(""); setDialog(""); showSuccess("Total updated");
    await refresh(selected.id);
    } catch { showError("Could not update total", "Check your connection and try again"); }
    finally { setBusy(false); }
  };
  if (!canView && !canAdd) return null;
  const visible = bills.filter((bill) => showPaid || bill.status !== "paid");
  return (
    <div>
      {canAdd && (
        <section className="rounded-2xl border border-brand-mist bg-white p-4 shadow-card dark:bg-card dark:shadow-none">
          <h3 className="font-display text-lg font-bold text-brand-green-dark">
            Add unpaid bill
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs">
              Expense name *
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="text-xs">
              Total (₹) *
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.originalAmount}
                onChange={(e) =>
                  setForm({ ...form, originalAmount: e.target.value })
                }
              />
            </label>
            <label className="text-xs">
              Category *
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                <option value="">Select category</option>
                {DEFAULT_EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Type
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                value={form.mainCategory}
                onChange={(e) =>
                  setForm({ ...form, mainCategory: e.target.value })
                }
              >
                <option value="stay_expense">Stay Expense</option>
                <option value="food_expense">Food Expense</option>
                <option value="goko_expense">Goko Expense</option>
              </select>
            </label>
            <label className="text-xs">
              Vendor (optional)
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                value={form.vendorId}
                onChange={(e) => setForm({ ...form, vendorId: e.target.value })}
              >
                <option value="">No vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Bill date
              <Input
                type="date"
                max={todayIST()}
                value={form.billDate}
                onChange={(e) => setForm({ ...form, billDate: e.target.value })}
              />
            </label>
            <label className="text-xs">
              Due date (optional)
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </label>
            <label className="text-xs">
              Original invoice (optional)
              <Input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => setFormFiles(e.target.files)}
              />
              <span className={formFiles?.length ? "text-muted-foreground" : "text-red-600"}>{formFiles?.length ? `${formFiles.length} file(s) selected` : "No files selected"} · Images or PDF</span>
            </label>
            <label className="text-xs sm:col-span-2">
              Description / notes
              <textarea
                className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
          </div>
          <Button
            className="mt-4"
            onClick={() => void create()}
            disabled={busy}
          >
            {busy ? "Creating bill…" : "Create unpaid bill"}
          </Button>
        </section>
      )}
      {canView && (
        <section className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-bold text-brand-green-dark">
              Bills Payable
            </h3>
            <label className="text-xs">
              <input
                type="checkbox"
                checked={showPaid}
                onChange={(e) => setShowPaid(e.target.checked)}
              />{" "}
              Show paid
            </label>
          </div>
          <div className="mt-3 space-y-3">
            {visible.map((bill) => (
              <button
                type="button"
                key={bill.id}
                onClick={() => setSelected(bill)}
                className="w-full rounded-xl border border-brand-mist bg-white p-4 text-left shadow-sm dark:bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-brand-green-dark">
                      {bill.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {bill.category}
                      {bill.dueDate ? ` · due ${bill.dueDate}` : ""}
                    </p>
                  </div>
                  <span
                    className={
                      bill.status === "paid"
                        ? "rounded bg-green-100 px-2 py-1 text-xs font-semibold text-green-700"
                        : "rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700"
                    }
                  >
                    {bill.status === "paid"
                      ? "Paid"
                      : `₹${(bill.remaining / 100).toFixed(0)} left`}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded bg-brand-sand">
                  <div
                    className="h-full bg-brand-green"
                    style={{
                      width: `${Math.min(100, bill.total ? (bill.paid / bill.total) * 100 : 0)}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  ₹{(bill.paid / 100).toFixed(0)} paid of ₹
                  {(bill.total / 100).toFixed(0)}
                </p>
              </button>
            ))}
            {!visible.length && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No payable bills.
              </p>
            )}
          </div>
        </section>
      )}
      {selected && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 sm:flex sm:items-center sm:justify-center"
          onClick={() => setSelected(null)}
        >
          <div
            className="mx-auto w-full max-w-lg rounded-2xl bg-white p-5 dark:bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="font-display text-lg font-bold">
                  {selected.title}
                </h4>
                <p className="text-xs text-muted-foreground">
                  Total ₹{(selected.total / 100).toFixed(2)} · paid ₹{(selected.paid / 100).toFixed(2)} · remaining ₹{(selected.remaining / 100).toFixed(2)}
                </p>
              </div>
              <button onClick={() => setSelected(null)}>×</button>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">
              {selected.description}
            </p>
            <div className="mt-4 space-y-2 text-xs">
              {selected.adjustments?.map((adjustment: any) => (
                <div key={`adjustment-${adjustment.id}`} className="rounded border border-brand-mist p-2">
                  <strong>{adjustment.createdBy}</strong> · {new Date(adjustment.createdAt).toLocaleString()}
                  <p className="mt-1">Total increased by ₹{(adjustment.amount / 100).toFixed(2)}</p>
                  <p className="mt-1 whitespace-pre-wrap">{adjustment.reason}</p>
                </div>
              ))}
              {selected.notes?.map((note: any) => (
                <div
                  key={note.id}
                  className="rounded border border-brand-mist p-2"
                >
                  <strong>{note.authorUsername}</strong> ·{" "}
                  {new Date(note.createdAt).toLocaleString()}
                  <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {canAdd && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDialog("note")}
                  >
                    Add note
                  </Button>
                  {selected.status !== "paid" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        document
                          .getElementById("payable-payment")
                          ?.scrollIntoView({ behavior: "smooth" })
                      }
                    >
                      Make payment
                    </Button>
                  )}
                </>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialog("total")}
                >
                  Increase total
                </Button>
              )}
              {canDelete &&
                !selected.payments?.some((p: any) => !p.deletedAt) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      if (confirm("Delete this unpaid bill?")) {
                        const res = await api({
                          action: "deletePayableBill",
                          id: selected.id,
                        });
                        if (res.ok) {
                          setSelected(null);
                          await refresh();
                        }
                      }
                    }}
                  >
                    Delete
                  </Button>
                )}
            </div>
            {dialog === "note" && <div className="mt-4 rounded-lg border p-3"><label className="text-xs">Note<textarea className="mt-1 min-h-20 w-full rounded border p-2" value={noteText} onChange={(e) => setNoteText(e.target.value)} /></label><Button className="mt-2" onClick={() => void addNote()} disabled={busy || !noteText.trim()}>{busy ? "Saving…" : "Save note"}</Button></div>}
            {dialog === "total" && <div className="mt-4 rounded-lg border p-3"><p className="text-xs">Current total {`₹${(selected.total / 100).toFixed(2)}`} · remaining {`₹${(selected.remaining / 100).toFixed(2)}`}</p><label className="mt-2 block text-xs">New total (₹)<Input type="number" min={(selected.total / 100).toFixed(2)} step="0.01" value={newTotal} onChange={(e) => setNewTotal(e.target.value)} /></label><label className="mt-2 block text-xs">Reason<textarea className="mt-1 min-h-16 w-full rounded border p-2" value={increaseReason} onChange={(e) => setIncreaseReason(e.target.value)} /></label><Button className="mt-2" onClick={() => void increase()} disabled={busy || !newTotal || !increaseReason.trim()}>{busy ? "Updating…" : "Update total"}</Button></div>}
            {canEdit && <div className="mt-4 rounded-lg border p-3"><label className="text-xs">Add invoice files<Input className="mt-1" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setEditFiles(e.target.files)} /><span className={editFiles?.length ? "text-muted-foreground" : "text-red-600"}>{editFiles?.length ? `${editFiles.length} file(s) selected` : "No files selected"} · Images or PDF</span></label><Button className="mt-2" size="sm" variant="outline" onClick={() => void appendInvoices()} disabled={busy || !editFiles?.length}>{busy ? "Uploading…" : "Add invoice files"}</Button></div>}
            <div id="payable-payment" className="mt-5 border-t pt-4">
              <h5 className="font-semibold">Payments</h5>
              {selected.payments
                ?.filter((p: any) => !p.deletedAt)
                .map((p: any) => (
                  <div key={p.id} className="mt-2 rounded border border-brand-mist p-2 text-xs">
                    <p>{p.expenseDate} · ₹{(p.amount / 100).toFixed(2)} · {p.paymentMethod} · {p.accountName}</p>
                    <p className="mt-1 text-muted-foreground">{p.createdBy} · {new Date(p.createdAt).toLocaleString()}</p>
                    <p className="mt-1 whitespace-pre-wrap">{p.purpose}</p>
                  </div>
                ))}
              {canAdd && selected.status !== "paid" && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs">
                    Amount (₹)
                    <Input
                      type="number"
                      min="0"
                      max={(selected.remaining / 100).toFixed(2)}
                      step="0.01"
                      value={payment.amount}
                      onChange={(e) =>
                        setPayment({ ...payment, amount: e.target.value })
                      }
                    />
                  </label>
                  <label className="text-xs">
                    Payment date
                    <Input
                      type="date"
                      max={todayIST()}
                      value={payment.expenseDate}
                      onChange={(e) =>
                        setPayment({ ...payment, expenseDate: e.target.value })
                      }
                    />
                  </label>
                  <label className="text-xs">
                    Method
                    <select
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                      value={payment.paymentMethod}
                      onChange={(e) =>
                        setPayment({
                          ...payment,
                          paymentMethod: e.target.value,
                          accountId: "",
                        })
                      }
                    >
                      <option value="cash">Cash</option>
                      <option value="online">Online</option>
                    </select>
                  </label>
                  {payment.paymentMethod === "online" && (
                    <label className="text-xs">
                      Account
                      <select
                        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                        value={payment.accountId}
                        onChange={(e) =>
                          setPayment({ ...payment, accountId: e.target.value })
                        }
                      >
                        <option value="">Select account</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nickname || a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="text-xs sm:col-span-2">
                    Payment note *
                    <textarea className="mt-1 min-h-16 w-full rounded-md border border-input bg-background p-2" value={payment.note || ""} onChange={(e) => setPayment({ ...payment, note: e.target.value })} placeholder="What was this payment for?" />
                  </label>
                  <label className="text-xs sm:col-span-2">
                    Payment receipt (optional)
                    <Input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={(e) => setPaymentFiles(e.target.files)}
                    />
                    <span className={paymentFiles?.length ? "text-muted-foreground" : "text-red-600"}>{paymentFiles?.length ? `${paymentFiles.length} file(s) selected` : "No files selected"} · Images or PDF</span>
                  </label>
                  <Button
                    className="sm:col-span-2"
                    onClick={() => void pay()}
                    disabled={busy}
                  >
                    {busy ? "Recording payment…" : "Make payment"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
