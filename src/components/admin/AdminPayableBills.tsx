"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminToast } from "./AdminToast";
import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/accountCategories";
import type { Role } from "./types";
import { hasPermission } from "./types";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PayableBillHistory, BillInvoiceLinks, billMoney } from "./PayableBillHistory";
import { payableBillActivity } from "@/lib/payableBillActivity";

const todayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
type Bill = any;

async function filesPayload(files: FileList | null) {
  if ((files?.length || 0) > 5) throw new Error("Choose up to five invoice files");
  for (const file of Array.from(files || [])) {
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error("Choose JPEG, PNG, WebP or PDF files up to 10 MB each");
  }
  return Promise.all(
    Array.from(files || []).map(async (file) => ({
      name: file.name,
      mime: file.type,
      data: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
        reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled`));
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
  mode = "create",
  onViewRecords,
}: {
  password: string;
  username?: string;
  role: Role;
  permissions?: Record<string, boolean>;
  mode?: "create" | "records";
  onViewRecords?: () => void;
}) {
  const { showError, showSuccess } = useAdminToast();
  const canView = hasPermission(role, permissions, "canViewExpenses");
  const canAdd = hasPermission(role, permissions, "canAddExpense");
  const canEdit = hasPermission(role, permissions, "canEditExpense");
  const canDelete = hasPermission(role, permissions, "canDeleteExpense");
  const [bills, setBills] = useState<Bill[]>([]);
  const [showPaid, setShowPaid] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [created, setCreated] = useState(false);
  const [fileReset, setFileReset] = useState(0);
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
  const [noteText, setNoteText] = useState("");
  const [newTotal, setNewTotal] = useState("");
  const [increaseReason, setIncreaseReason] = useState("");
  const [dialog, setDialog] = useState<"" | "note" | "total" | "payment">("");
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
    if (!canView || mode !== "records") return;
    setLoading(true); setLoadError("");
    try {
      const res = await api({ action: "listPayableBills" });
      if (!res.ok) throw new Error("Could not load unpaid bills");
      setBills((await res.json()).bills || []);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Could not load unpaid bills"); }
    finally { setLoading(false); }
  }, [api, canView, mode]);
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
    if (busy) return;
    if (!form.title.trim() || !Number.isSafeInteger(amount) || amount <= 0 || !form.category)
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
      setCreated(true);
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
      setFileReset(value => value + 1);
      await refresh();
    } catch (error) { showError("Could not create bill", error instanceof Error ? error.message : "Check your connection and try again");
    } finally {
      setBusy(false);
    }
  };
  const pay = async () => {
    if (!selected || busy) return;
    const amount = Math.round(Number(payment.amount) * 100);
    if (
      !Number.isSafeInteger(amount) || amount <= 0 ||
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
      setFileReset(value => value + 1);
      setDialog("");
      await refresh(selected.id);
    } catch (error) { showError("Could not record payment", error instanceof Error ? error.message : "Check your connection and try again");
    } finally {
      setBusy(false);
    }
  };
  const addNote = async () => {
    if (!selected || busy) return;
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
    if (!selected || busy) return;
    const total = Math.round(Number(newTotal) * 100);
    const amount = total - selected.total;
    const reason = increaseReason.trim();
    if (!Number.isSafeInteger(total) || amount <= 0 || !reason) return showError("Enter a higher new total and a reason");
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
  const openBill = (bill: Bill, action: "" | "note" | "total" | "payment" = "") => {
    setPayment({ amount: "", expenseDate: todayIST(), paymentMethod: "cash", accountId: "", note: "", key: crypto.randomUUID() });
    setPaymentFiles(null); setNoteText(""); setNewTotal(""); setIncreaseReason(""); setFileReset(value => value + 1);
    setDialog(action); setSelected(bill);
  };
  const visible = bills.filter(bill => (showPaid || bill.status !== "paid") && [bill.title, bill.description, bill.category, bill.vendorName].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div>
      {mode === "create" && canAdd && (
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
                aria-label="Category *"
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
                key={`original-${fileReset}`}
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
          {created && <p className="mt-3 text-sm" role="status">Bill created.{canView && <Button className="ml-2" variant="outline" onClick={onViewRecords}>View unpaid bills</Button>}</p>}
        </section>
      )}
      {mode === "records" && canView && (
        <section className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-bold text-brand-green-dark">
              Unpaid Bills
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
          <Input className="mt-3" aria-label="Search unpaid bills" placeholder="Search name, vendor, category or description" value={search} onChange={event => setSearch(event.target.value)} />
          {loading && <p className="mt-3 text-sm" role="status">Loading bills…</p>}
          {loadError && <div className="mt-3 text-sm text-red-600" role="alert">{loadError}<Button variant="outline" className="ml-2" onClick={() => void load()}>Retry</Button></div>}
          <div className="mt-3 space-y-3">
            {visible.map((bill) => {
              const latest = payableBillActivity(bill)[0];
              return (
              <article
                key={bill.id}
                className="w-full rounded-xl border border-brand-mist bg-white p-4 text-left shadow-sm dark:bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-brand-green-dark">
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
                      : `${billMoney(bill.remaining)} left`}
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
                  {billMoney(bill.paid)} paid of {billMoney(bill.total)} · {billMoney(bill.remaining)} remaining
                </p>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm">{bill.description}</p>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <p>Type: {(bill.mainCategory || "").replaceAll("_", " ")}</p><p>Vendor: {bill.vendorName || "No vendor"}</p>
                  <p>Bill date: {bill.billDate}</p><p>Due: {bill.dueDate || "Not set"}{bill.status !== "paid" && bill.dueDate && bill.dueDate < todayIST() ? " · Overdue" : ""}</p>
                  <p>Created by {bill.createdBy} · {new Date(bill.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
                </div>
                <BillInvoiceLinks links={bill.billImageLink} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openBill(bill)}>View bill</Button>
                  {canAdd && <Button variant="outline" size="sm" onClick={() => openBill(bill, "note")}>Add note</Button>}
                  {canAdd && bill.status !== "paid" && <Button size="sm" onClick={() => openBill(bill, "payment")}>Make payment</Button>}
                  {canEdit && <Button variant="outline" size="sm" onClick={() => openBill(bill, "total")}>Increase total</Button>}
                </div>
                {latest && <p className="mt-3 line-clamp-2 break-words text-xs text-muted-foreground">Latest activity: {latest.text}</p>}
                <PayableBillHistory bill={bill} />
              </article>
              );
            })}
            {!visible.length && !loading && !loadError && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {search ? "No bills match your search." : "No unpaid bills."}
              </p>
            )}
          </div>
        </section>
      )}
      {selected && (
        <Dialog open onOpenChange={open => { if (!open && !busy) setSelected(null); }}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" showCloseButton={!busy}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="font-display text-lg font-bold">
                  {selected.title}
                </DialogTitle>
                <DialogDescription className="mt-2 text-xs text-muted-foreground">
                  Total ₹{(selected.total / 100).toFixed(2)} · paid ₹{(selected.paid / 100).toFixed(2)} · remaining ₹{(selected.remaining / 100).toFixed(2)}
                </DialogDescription>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">
              {selected.description}
            </p>
            <BillInvoiceLinks links={selected.billImageLink} />
            <div className="mt-4 flex flex-wrap gap-2">
              {canAdd && (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    variant="outline"
                    onClick={() => setDialog("note")}
                  >
                    Add note
                  </Button>
                  {selected.status !== "paid" && (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => setDialog("payment")}
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
                  disabled={busy}
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
            {canAdd && dialog === "note" && <div className="mt-4 rounded-lg border p-3"><label className="text-xs">Note<textarea maxLength={5000} className="mt-1 min-h-20 w-full rounded border p-2" value={noteText} onChange={(e) => setNoteText(e.target.value)} /></label><Button className="mt-2" onClick={() => void addNote()} disabled={busy || !noteText.trim()}>{busy ? "Saving…" : "Save note"}</Button></div>}
            {canEdit && dialog === "total" && <div className="mt-4 rounded-lg border p-3"><p className="text-xs">Current total {`₹${(selected.total / 100).toFixed(2)}`} · remaining {`₹${(selected.remaining / 100).toFixed(2)}`}</p><label className="mt-2 block text-xs">New total (₹)<Input type="number" min={(selected.total / 100).toFixed(2)} step="0.01" value={newTotal} onChange={(e) => setNewTotal(e.target.value)} /></label><label className="mt-2 block text-xs">Reason<textarea maxLength={500} className="mt-1 min-h-16 w-full rounded border p-2" value={increaseReason} onChange={(e) => setIncreaseReason(e.target.value)} /></label><Button className="mt-2" onClick={() => void increase()} disabled={busy || !newTotal || !increaseReason.trim()}>{busy ? "Updating…" : "Update total"}</Button></div>}
            <div id="payable-payment" className="mt-5 border-t pt-4">
              {canAdd && dialog === "payment" && selected.status !== "paid" && (
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
                      aria-label="Method"
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
                        aria-label="Account"
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
                    <textarea maxLength={500} className="mt-1 min-h-16 w-full rounded-md border border-input bg-background p-2" value={payment.note || ""} onChange={(e) => setPayment({ ...payment, note: e.target.value })} placeholder="What was this payment for?" />
                  </label>
                  <label className="text-xs sm:col-span-2">
                    Add invoice files (optional)
                    <Input
                      key={`payment-${fileReset}`}
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
            <PayableBillHistory bill={selected} expanded />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
