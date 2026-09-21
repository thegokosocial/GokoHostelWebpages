"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  Loader2Icon,
  BanknoteIcon,
  UsersIcon,
  StoreIcon,
  IndianRupeeIcon,
  UploadIcon,
  TagsIcon,
} from "lucide-react";
import { BulkExpenseImport } from "./BulkExpenseImport";
import { BulkIncomeImport } from "./BulkIncomeImport";
import { useAdminToast } from "@/components/admin/AdminToast";
import { cn } from "@/lib/utils";
import { AdminLoading } from "./AdminLoading";
import {
  managementSectionTabActiveClass,
  managementSectionTabClass,
  managementSectionTabsClass,
  managementSectionTabInactiveClass,
} from "./managementSectionTabs";
import type { Role } from "./types";
import type { IncomeCategory } from "@/lib/accountCategories";

type Account = {
  id: number; name: string; nickname: string; bankName: string;
  accountType: string; accountNumber: string; ifscCode: string;
  isDefault: number; isActive: number; openingBalance: number; createdAt: string;
};

type Vendor = {
  id: number; name: string; category: string; contactPhone: string;
  notes: string; isActive: number; createdAt: string;
};

type Employee = {
  id: number; name: string; role: string; phone: string;
  salary: number; salaryFrequency: string; bankAccount: string;
  attendanceStartDate: string; employmentEndDate: string;
  isActive: number; createdAt: string;
};

const ACCOUNT_TYPES = [
  { id: "savings", label: "Savings" },
  { id: "current", label: "Current" },
  { id: "cash", label: "Cash" },
];

type SettingsSection = "accounts" | "employees" | "vendors" | "categories" | "bulkExpenses" | "bulkIncome";

export function AccountSettings({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { showError, showSuccess } = useAdminToast();
  const [section, setSection] = useState<SettingsSection>("accounts");
  const [loading, setLoading] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [foodOnlineReceiptAccountId, setFoodOnlineReceiptAccountId] = useState("");
  const [roomOnlineReceiptAccountId, setRoomOnlineReceiptAccountId] = useState("");
  const [savingReceiptDefaults, setSavingReceiptDefaults] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([]);
  const [categoryDraft, setCategoryDraft] = useState<{ kind: "expense" | "income"; index: number | null; name: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const scrollBackId = useRef<string | null>(null);

  // Form states
  const [formData, setFormData] = useState<Record<string, string>>({});

  // Salary payment
  const [payingEmployee, setPayingEmployee] = useState<Employee | null>(null);
  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryMonth, setSalaryMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [salaryMethod, setSalaryMethod] = useState("cash");
  const [salaryAccountId, setSalaryAccountId] = useState("");
  const [salaryNotes, setSalaryNotes] = useState("");
  const [salaryPayType, setSalaryPayType] = useState("salary");
  const [payingSalary, setPayingSalary] = useState(false);
  const [salaryRequestId, setSalaryRequestId] = useState("");
  const [payrollSummary, setPayrollSummary] = useState<{ grossAmount: number; attendanceDeduction: number; netPayable: number; salaryPaid: number; remainingPayable: number; paidLeaveUnits: number; unpaidLeaveUnits: number; isProjected: boolean } | null>(null);

  const apiCall = useCallback(async (body: Record<string, any>) => {
    const payload: Record<string, any> = { password, ...body };
    if (username) payload.username = username;
    return fetch("/api/admin/account-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [password, username]);

  const loadPayroll = useCallback(async (employeeId: number, month: string) => {
    const payload: Record<string, unknown> = { password, action: "getPayroll", employeeId, month };
    if (username) payload.username = username;
    const res = await fetch("/api/admin/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) return;
    const data = await res.json();
    setPayrollSummary(data.summary || null);
    if (data.summary) setSalaryAmount((data.summary.remainingPayable / 100).toFixed(0));
  }, [password, username]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, venRes, empRes, catRes] = await Promise.all([
        apiCall({ action: "listAccounts" }),
        apiCall({ action: "listVendors" }),
        apiCall({ action: "listEmployees" }),
        apiCall({ action: "listCategories" }),
      ]);
      if (accRes.ok) { const d = await accRes.json(); setAccounts(d.accounts || []); setFoodOnlineReceiptAccountId(d.foodOnlineReceiptAccountId || ""); setRoomOnlineReceiptAccountId(d.roomOnlineReceiptAccountId || ""); }
      if (venRes.ok) { const d = await venRes.json(); setVendors(d.vendors || []); }
      if (empRes.ok) { const d = await empRes.json(); setEmployees(d.employees || []); }
      if (catRes.ok) { const d = await catRes.json(); setExpenseCategories(d.expenseCategories || []); setIncomeCategories(d.incomeCategories || []); }
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => { setFormData({}); setEditing(null); setShowForm(false); };

  const startAdd = () => { resetForm(); setShowForm(true); setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); };

  const startEdit = (item: any) => {
    setEditing(item);
    const data: Record<string, string> = {};
    Object.entries(item).forEach(([k, v]) => { data[k] = v != null ? String(v) : ""; });
    if (section === "accounts" && item.openingBalance != null) {
      data.openingBalance = (item.openingBalance / 100).toFixed(2);
    }
    if (section === "employees" && item.salary != null) {
      data.salary = (item.salary / 100).toFixed(2);
    }
    setFormData(data);
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  const saveItem = async () => {
    setSaving(true);
    try {
      let action = "";
      const payload: Record<string, any> = { ...formData };

      if (section === "accounts") {
        action = editing ? "updateAccount" : "addAccount";
        if (payload.openingBalance) payload.openingBalance = Math.round(parseFloat(payload.openingBalance) * 100);
        if (editing) payload.id = editing.id;
      } else if (section === "vendors") {
        action = editing ? "updateVendor" : "addVendor";
        if (editing) payload.id = editing.id;
      } else {
        action = editing ? "updateEmployee" : "addEmployee";
        if (payload.salary) payload.salary = Math.round(parseFloat(payload.salary) * 100);
        if (editing) payload.id = editing.id;
      }

      const res = await apiCall({ action, ...payload });
      if (res.ok) {
        if (editing) scrollBackId.current = String(editing.id);
        resetForm();
        loadData().then(() => {
          if (scrollBackId.current) {
            const id = scrollBackId.current;
            scrollBackId.current = null;
            setTimeout(() => {
              const el = document.querySelector(`[data-item-id="${id}"]`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 200);
          }
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id: number) => {
    if (!confirm("Are you sure you want to delete this?")) return;
    const action = section === "accounts" ? "deleteAccount" : section === "vendors" ? "deleteVendor" : "deleteEmployee";
    await apiCall({ action, id });
    loadData();
  };

  const removeEmployee = async (employee: Employee) => {
    if (!confirm(`Remove ${employee.name} from the employee list? Compensation, payroll, and attendance history will be retained.`)) return;
    try {
      const res = await apiCall({ action: "removeEmployee", id: employee.id });
      if (!res.ok) {
        showError((await res.json().catch(() => ({}))).error || "Could not remove employee");
        return;
      }
      showSuccess(`${employee.name} removed from the employee list; history retained`);
      await loadData();
    } catch {
      showError("Could not remove employee. Check your connection and try again.");
    }
  };

  const saveReceiptDefaults = async () => {
    setSavingReceiptDefaults(true);
    try {
      const res = await apiCall({ action: "saveReceiptDefaults", foodOnlineReceiptAccountId, roomOnlineReceiptAccountId });
      if (!res.ok) {
        showError((await res.json().catch(() => ({}))).error || "Could not save receipt defaults");
        return;
      }
      showSuccess("Online receipt defaults saved");
    } catch {
      showError("Could not save receipt defaults. Check your connection and try again.");
    } finally {
      setSavingReceiptDefaults(false);
    }
  };

  const updateField = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const saveCategory = async () => {
    if (!categoryDraft?.name.trim()) return;
    const nextExpenses = [...expenseCategories];
    const nextIncome = [...incomeCategories];
    if (categoryDraft.kind === "expense") {
      if (categoryDraft.index == null) nextExpenses.push(categoryDraft.name.trim());
      else nextExpenses[categoryDraft.index] = categoryDraft.name.trim();
    } else if (categoryDraft.index == null) {
      nextIncome.push({ id: categoryDraft.name.trim(), name: categoryDraft.name.trim() });
    } else {
      const current = nextIncome[categoryDraft.index];
      nextIncome[categoryDraft.index] = { id: ["stay", "food", "refund", "other"].includes(current.id) ? current.id : categoryDraft.name.trim(), name: categoryDraft.name.trim() };
    }
    setSaving(true);
    try {
      const res = await apiCall({ action: "saveCategories", expenseCategories: nextExpenses, incomeCategories: nextIncome });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return showError(data.error || "Could not save category");
      setExpenseCategories(data.expenseCategories); setIncomeCategories(data.incomeCategories); setCategoryDraft(null); showSuccess("Category saved");
    } finally { setSaving(false); }
  };

  const deleteCategory = async (kind: "expense" | "income", index: number) => {
    if (!confirm("Remove this category from future entries? Existing records will keep it.")) return;
    const nextExpenses = kind === "expense" ? expenseCategories.filter((_, itemIndex) => itemIndex !== index) : expenseCategories;
    const nextIncome = kind === "income" ? incomeCategories.filter((_, itemIndex) => itemIndex !== index) : incomeCategories;
    const res = await apiCall({ action: "saveCategories", expenseCategories: nextExpenses, incomeCategories: nextIncome });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showError(data.error || "Could not delete category");
    setExpenseCategories(data.expenseCategories); setIncomeCategories(data.incomeCategories); showSuccess("Category removed");
  };

  const startPaySalary = (emp: Employee) => {
    setPayingEmployee(emp);
    setSalaryAmount((emp.salary / 100).toFixed(0));
    setSalaryNotes("");
    setSalaryPayType("salary");
    setSalaryRequestId(crypto.randomUUID());
    setPayrollSummary(null);
    void loadPayroll(emp.id, salaryMonth);
    const defaultAcc = accounts.find((a) => a.isDefault);
    if (defaultAcc) setSalaryAccountId(String(defaultAcc.id));
  };

  useEffect(() => {
    if (payingEmployee && (salaryPayType === "salary" || salaryPayType === "advance")) void loadPayroll(payingEmployee.id, salaryMonth);
  }, [payingEmployee, salaryMonth, salaryPayType, loadPayroll]);

  const submitSalaryPayment = async () => {
    if (!payingEmployee) return;
    const amt = parseFloat(salaryAmount);
    if (!amt || amt <= 0) return;
    if (salaryMethod === "online" && !salaryAccountId) { showError("Please select an account for online payment"); return; }
    setPayingSalary(true);
    try {
      await apiCall({
        action: "paySalary",
        employeeId: payingEmployee.id,
        amount: Math.round(amt * 100),
        month: salaryMonth,
        accountId: salaryMethod === "online" && salaryAccountId ? parseInt(salaryAccountId) : null,
        paymentMethod: salaryMethod,
        payType: salaryPayType,
        notes: salaryNotes,
        requestId: salaryRequestId,
      });
      setPayingEmployee(null);
      loadData();
    } finally {
      setPayingSalary(false);
    }
  };

  if (loading) return <AdminLoading message="Loading settings..." />;

  return (
    <div className="space-y-6">
      {/* Section Tabs */}
      <div className={managementSectionTabsClass}>
        {([
          { id: "accounts" as SettingsSection, label: "Accounts", icon: <BanknoteIcon className="h-3.5 w-3.5" /> },
          { id: "employees" as SettingsSection, label: "Employees", icon: <UsersIcon className="h-3.5 w-3.5" /> },
          { id: "vendors" as SettingsSection, label: "Vendors", icon: <StoreIcon className="h-3.5 w-3.5" /> },
          { id: "categories" as SettingsSection, label: "Categories", icon: <TagsIcon className="h-3.5 w-3.5" /> },
          { id: "bulkExpenses" as SettingsSection, label: "Bulk Expenses", icon: <UploadIcon className="h-3.5 w-3.5" /> },
          { id: "bulkIncome" as SettingsSection, label: "Bulk Income", icon: <UploadIcon className="h-3.5 w-3.5" /> },
        ]).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => { setSection(s.id); resetForm(); }}
            className={cn(
              managementSectionTabClass,
              section === s.id ? managementSectionTabActiveClass : managementSectionTabInactiveClass
            )}
          >
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      {/* Bulk upload sections */}
      {section === "bulkExpenses" && (
        <BulkExpenseImport password={password} username={username} role={role} />
      )}
      {section === "bulkIncome" && (
        <BulkIncomeImport password={password} username={username} role={role} />
      )}

      {section === "categories" && (
        <div className="grid gap-5 lg:grid-cols-2">
          {(["expense", "income"] as const).map((kind) => {
            const items = kind === "expense" ? expenseCategories.map((name) => ({ name })) : incomeCategories;
            return <div key={kind} className="rounded-xl border border-brand-mist bg-white p-4 dark:bg-card">
              <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold capitalize text-brand-green-dark">{kind} categories ({items.length})</h3><p className="mt-0.5 text-[10px] text-muted-foreground">Used for new {kind} entries. Existing records are unchanged.</p></div><Button type="button" className="h-7 gap-1 text-xs" onClick={() => setCategoryDraft({ kind, index: null, name: "" })}><PlusIcon className="h-3 w-3" /> Add</Button></div>
              {categoryDraft?.kind === kind && <div className="mt-3 flex gap-2"><Input autoFocus value={categoryDraft.name} maxLength={60} onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })} placeholder={`New ${kind} category`} className="h-8 text-xs" /><Button type="button" className="h-8 text-xs" disabled={saving || !categoryDraft.name.trim()} onClick={saveCategory}>{categoryDraft.index == null ? "Create" : "Update"}</Button><Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => setCategoryDraft(null)}>Cancel</Button></div>}
              <div className="mt-3 space-y-2">{items.map((item, index) => <div key={`${kind}-${index}-${item.name}`} className="flex items-center justify-between rounded-lg border border-brand-mist px-3 py-2"><span className="text-sm text-brand-green-dark">{item.name}</span><div className="flex gap-1"><button type="button" title="Edit category" onClick={() => setCategoryDraft({ kind, index, name: item.name })} className="rounded-md p-1.5 text-brand-green-dark/40 hover:bg-brand-sand hover:text-brand-green"><PencilIcon className="h-3.5 w-3.5" /></button><button type="button" title="Delete category" onClick={() => void deleteCategory(kind, index)} className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"><Trash2Icon className="h-3.5 w-3.5" /></button></div></div>)}</div>
            </div>;
          })}
        </div>
      )}

      {/* List + Add button */}
      {(section === "accounts" || section === "employees" || section === "vendors") && <><div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-brand-green-dark capitalize">{section} ({
          section === "accounts" ? accounts.length : section === "vendors" ? vendors.length : employees.length
        })</h3>
        <Button type="button" onClick={startAdd} className="h-7 gap-1 text-xs">
          <PlusIcon className="h-3 w-3" /> Add
        </Button>
      </div>

      {section === "accounts" && (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
          <h4 className="text-sm font-semibold text-brand-green-dark">Online guest receipt defaults</h4>
          <p className="mt-1 text-xs text-brand-green-dark/60">These banks are preselected when staff record online Food or Room payments. They may be the same account.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-brand-green-dark/70">Food online receipts
              <select value={foodOnlineReceiptAccountId} onChange={(e) => setFoodOnlineReceiptAccountId(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">Select account…</option>{accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}</option>)}</select>
            </label>
            <label className="text-xs text-brand-green-dark/70">Room online receipts
              <select value={roomOnlineReceiptAccountId} onChange={(e) => setRoomOnlineReceiptAccountId(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="">Select account…</option>{accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}</option>)}</select>
            </label>
          </div>
          <Button type="button" className="mt-3 h-8 text-xs" onClick={saveReceiptDefaults} disabled={savingReceiptDefaults || !foodOnlineReceiptAccountId || !roomOnlineReceiptAccountId}>
            {savingReceiptDefaults ? <><Loader2Icon className="mr-1 h-3 w-3 animate-spin" /> Saving...</> : "Save receipt defaults"}
          </Button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div ref={formRef} className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4 sm:p-5 space-y-4">
          <h4 className="text-sm font-semibold text-brand-green-dark">{editing ? "Edit" : "Add"} {section.slice(0, -1)}</h4>

          {section === "accounts" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Account Name *</Label>
                <Input value={formData.name || ""} onChange={(e) => updateField("name", e.target.value)} className="mt-1 h-8 text-xs" placeholder="e.g. Primary Account" />
              </div>
              <div>
                <Label className="text-xs">Nickname</Label>
                <Input value={formData.nickname || ""} onChange={(e) => updateField("nickname", e.target.value)} className="mt-1 h-8 text-xs" placeholder="e.g. Main" />
              </div>
              <div>
                <Label className="text-xs">Bank Name</Label>
                <Input value={formData.bankName || ""} onChange={(e) => updateField("bankName", e.target.value)} className="mt-1 h-8 text-xs" placeholder="e.g. SBI" />
              </div>
              <div>
                <Label className="text-xs">Account Type</Label>
                <select value={formData.accountType || "savings"} onChange={(e) => updateField("accountType", e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs">
                  {ACCOUNT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Account Number</Label>
                <Input value={formData.accountNumber || ""} onChange={(e) => updateField("accountNumber", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">IFSC Code</Label>
                <Input value={formData.ifscCode || ""} onChange={(e) => updateField("ifscCode", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">Opening Balance (₹)</Label>
                <Input type="number" step="0.01" value={formData.openingBalance || ""} onChange={(e) => updateField("openingBalance", e.target.value)} className="mt-1 h-8 text-xs" placeholder="0.00" />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" checked={formData.isDefault === "1"} onChange={(e) => updateField("isDefault", e.target.checked ? "1" : "0")} className="accent-brand-green" />
                <span className="text-xs text-brand-green-dark/70">Default account for online payments</span>
              </div>
            </div>
          )}

          {section === "vendors" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Vendor Name *</Label>
                <Input value={formData.name || ""} onChange={(e) => updateField("name", e.target.value)} className="mt-1 h-8 text-xs" placeholder="e.g. Chicken Shop" />
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <select value={formData.category || ""} onChange={(e) => updateField("category", e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs">
                  <option value="">Select category</option>
                  {expenseCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                  {formData.category && !expenseCategories.includes(formData.category) && <option value={formData.category}>{formData.category}</option>}
                </select>
              </div>
              <div>
                <Label className="text-xs">Contact Phone</Label>
                <Input value={formData.contactPhone || ""} onChange={(e) => updateField("contactPhone", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Input value={formData.notes || ""} onChange={(e) => updateField("notes", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Optional notes" />
              </div>
            </div>
          )}

          {section === "employees" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Name *</Label>
                <Input value={formData.name || ""} onChange={(e) => updateField("name", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Employee name" />
              </div>
              <div>
                <Label className="text-xs">Role</Label>
                <Input value={formData.role || ""} onChange={(e) => updateField("role", e.target.value)} className="mt-1 h-8 text-xs" placeholder="e.g. Cook, Cleaner" />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={formData.phone || ""} onChange={(e) => updateField("phone", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">Salary (₹)</Label>
                <Input type="number" step="0.01" value={formData.salary || ""} onChange={(e) => updateField("salary", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Monthly salary" />
              </div>
              <div>
                <Label className="text-xs">Frequency</Label>
                <select value={formData.salaryFrequency || "monthly"} onChange={(e) => updateField("salaryFrequency", e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs">
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Bank Account (for reference)</Label>
                <Input value={formData.bankAccount || ""} onChange={(e) => updateField("bankAccount", e.target.value)} className="mt-1 h-8 text-xs" placeholder="Optional" />
              </div>
              <div>
                <Label className="text-xs">Attendance start date</Label>
                <Input type="date" value={formData.attendanceStartDate || ""} onChange={(e) => updateField("attendanceStartDate", e.target.value)} className="mt-1 h-8 text-xs" />
              </div>
              {editing && <div>
                <Label className="text-xs">Salary effective month</Label>
                <Input type="month" value={formData.compensationEffectiveMonth || new Date().toISOString().slice(0, 7)} onChange={(e) => updateField("compensationEffectiveMonth", e.target.value)} className="mt-1 h-8 text-xs" />
              </div>}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" onClick={saveItem} disabled={saving} className="h-8 gap-1.5 text-xs">
              {saving ? <Loader2Icon className="h-3 w-3 animate-spin" /> : null}
              {editing ? "Update" : "Create"}
            </Button>
            <Button type="button" variant="ghost" onClick={resetForm} className="h-8 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {/* Items List */}
      <div className="space-y-2">
        {section === "accounts" && accounts.map((a) => (
          <div key={a.id} data-item-id={a.id} className="flex items-center justify-between rounded-xl border border-brand-mist bg-white dark:bg-card p-3 sm:p-4">
            <div>
              <p className="text-sm font-medium text-brand-green-dark">
                {a.name} {a.nickname && <span className="text-brand-green-dark/50">({a.nickname})</span>}
                {a.isDefault ? <span className="ml-2 rounded bg-brand-green/10 px-1.5 py-0.5 text-[10px] text-brand-green">Default</span> : null}
              </p>
              <p className="text-[10px] text-brand-green-dark/50">
                {a.bankName && `${a.bankName} · `}{a.accountType}{a.accountNumber && ` · ****${a.accountNumber.slice(-4)}`}
              </p>
              <p className="text-[10px] text-brand-green-dark/40">Opening: ₹{(a.openingBalance / 100).toFixed(0)}</p>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => startEdit(a)} className="rounded-md p-1.5 text-brand-green-dark/40 hover:bg-brand-sand hover:text-brand-green"><PencilIcon className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => deleteItem(a.id)} className="rounded-md p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600"><Trash2Icon className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}

        {section === "vendors" && vendors.map((v) => (
          <div key={v.id} data-item-id={v.id} className="flex items-center justify-between rounded-xl border border-brand-mist bg-white dark:bg-card p-3 sm:p-4">
            <div>
              <p className="text-sm font-medium text-brand-green-dark">{v.name}</p>
              <p className="text-[10px] text-brand-green-dark/50">
                {v.category && `${v.category} · `}{v.contactPhone || "No phone"}
              </p>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => startEdit(v)} className="rounded-md p-1.5 text-brand-green-dark/40 hover:bg-brand-sand hover:text-brand-green"><PencilIcon className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => deleteItem(v.id)} className="rounded-md p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600"><Trash2Icon className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}

        {section === "employees" && employees.map((e) => (
          <div key={e.id} data-item-id={e.id} className="flex items-center justify-between rounded-xl border border-brand-mist bg-white dark:bg-card p-3 sm:p-4">
            <div>
              <p className="text-sm font-medium text-brand-green-dark">{e.name}</p>
              <p className="text-[10px] text-brand-green-dark/50">
                {e.role && `${e.role} · `}₹{(e.salary / 100).toFixed(0)}/{e.salaryFrequency}{e.phone && ` · ${e.phone}`}{!e.isActive && " · Inactive"}
              </p>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => startPaySalary(e)} className="rounded-md px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 hover:bg-emerald-100 dark:hover:bg-emerald-900/50" title="Pay Salary">
                <IndianRupeeIcon className="inline h-3 w-3" /> Pay
              </button>
              <button type="button" onClick={() => startEdit(e)} className="rounded-md p-1.5 text-brand-green-dark/40 hover:bg-brand-sand hover:text-brand-green"><PencilIcon className="h-3.5 w-3.5" /></button>
              {e.isActive
                ? <button type="button" title="Deactivate employee" onClick={() => deleteItem(e.id)} className="rounded-md p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600"><Trash2Icon className="h-3.5 w-3.5" /></button>
                : <button type="button" title="Remove employee from list (history retained)" aria-label={`Remove ${e.name} from employee list`} onClick={() => removeEmployee(e)} className="rounded-md p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600"><Trash2Icon className="h-3.5 w-3.5" /></button>}
            </div>
          </div>
        ))}

        {((section === "accounts" && accounts.length === 0) || (section === "vendors" && vendors.length === 0) || (section === "employees" && employees.length === 0)) && (
          <p className="py-8 text-center text-sm text-brand-green-dark/50">No {section} configured yet.</p>
        )}
      </div>
      </>}

      {/* Salary/Bonus/Advance/Loan Payment Modal */}
      {payingEmployee && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4 bg-black/40 backdrop-blur-sm sm:items-center">
          <div className="max-h-[min(90dvh,100%)] w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-brand-mist bg-white dark:bg-card p-5 shadow-xl dark:shadow-none sm:p-6">
            <h4 className="font-display text-base font-bold text-brand-green-dark">Pay Employee</h4>
            <p className="mt-1 text-xs text-brand-green-dark/60">
              {payingEmployee.name} · {payingEmployee.role || "Staff"}
            </p>
            <div className="mt-4 space-y-3">
              {payrollSummary && (salaryPayType === "salary" || salaryPayType === "advance") && <div className="rounded-lg bg-brand-sand/60 p-3 text-xs">
                <div className="flex justify-between"><span>Gross salary</span><strong>₹{(payrollSummary.grossAmount / 100).toFixed(0)}</strong></div>
                <div className="mt-1 flex justify-between text-red-600"><span>Attendance deduction ({payrollSummary.unpaidLeaveUnits / 2}d unpaid)</span><strong>-₹{(payrollSummary.attendanceDeduction / 100).toFixed(0)}</strong></div>
                <div className="mt-1 flex justify-between"><span>Already paid</span><strong>₹{(payrollSummary.salaryPaid / 100).toFixed(0)}</strong></div>
                <div className="mt-2 flex justify-between border-t border-brand-mist pt-2"><span>{payrollSummary.isProjected ? "Projected remaining" : "Remaining payable"}</span><strong>₹{(payrollSummary.remainingPayable / 100).toFixed(0)}</strong></div>
              </div>}
              <div>
                <Label className="text-xs">Payment Type</Label>
                <select value={salaryPayType} onChange={(e) => setSalaryPayType(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs">
                  <option value="salary">Salary</option>
                  <option value="bonus">Bonus</option>
                  <option value="advance">Advance / Early Salary</option>
                  <option value="loan">Loan</option>
                  <option value="reimbursement">Reimbursement</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Amount (₹)</Label>
                <Input type="number" min="0" step="1" value={salaryAmount} onChange={(e) => setSalaryAmount(e.target.value)} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">Month</Label>
                <Input type="month" value={salaryMonth} onChange={(e) => setSalaryMonth(e.target.value)} className="mt-1 h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">Payment Method</Label>
                <select value={salaryMethod} onChange={(e) => setSalaryMethod(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs">
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                </select>
              </div>
              {salaryMethod === "online" && (
                <div>
                  <Label className="text-xs">Account</Label>
                  <select value={salaryAccountId} onChange={(e) => setSalaryAccountId(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs">
                    <option value="">Select account...</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <Label className="text-xs">Notes (optional)</Label>
                <Input value={salaryNotes} onChange={(e) => setSalaryNotes(e.target.value)} className="mt-1 h-8 text-xs" placeholder="e.g. Advance, partial..." />
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <Button type="button" onClick={submitSalaryPayment} disabled={payingSalary} className="flex-1 gap-1.5">
                {payingSalary ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <IndianRupeeIcon className="h-3.5 w-3.5" />}
                Pay ₹{salaryAmount || "0"} ({salaryPayType})
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPayingEmployee(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
