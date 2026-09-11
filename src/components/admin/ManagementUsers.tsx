"use client";

import { useState, useEffect, useRef } from "react";
import { useAdminApi } from "./useAdminApi";
import { useAdminToast } from "@/components/admin/AdminToast";
import { AdminLoading } from "./AdminLoading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlusIcon, Trash2Icon, PencilIcon, ShieldIcon, ShieldCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "./types";

type User = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  permissions: Record<string, boolean>;
  createdAt: string;
  isSystem: boolean;
};

const NAV_PERMISSION_OPTIONS = [
  { key: "canViewDashboard", label: "View Dashboard" },
  { key: "canViewBookings", label: "View Bookings" },
  { key: "canViewBeds", label: "View Beds" },
  { key: "canViewTimeline", label: "View Timeline" },
  { key: "canViewRecords", label: "View Records" },
  { key: "canViewFoodOrders", label: "View Food Orders" },
  { key: "canViewAccounts", label: "View Accounts" },
  { key: "canViewSplits", label: "View Splits" },
  { key: "canViewReviews", label: "View Reviews" },
  { key: "canViewManagement", label: "View Management" },
];

const CHECKIN_PERMISSION_OPTIONS = [
  { key: "canAddCheckin", label: "Add check-ins" },
  { key: "canAssignBed", label: "Assign beds" },
  { key: "canCheckout", label: "Checkout guests" },
  { key: "canMarkClean", label: "Mark beds clean" },
  { key: "canEditRecords", label: "Edit records" },
  { key: "canDeleteRecords", label: "Delete records" },
];

const BOOKING_PERMISSION_OPTIONS = [
  { key: "canAddBooking", label: "Add bookings" },
  { key: "canSyncBookings", label: "Sync bookings from email" },
  { key: "canDeleteBooking", label: "Delete bookings" },
];

const FOOD_PERMISSION_OPTIONS = [
  { key: "canAccessKitchen", label: "Kitchen page access" },
  { key: "canViewFoodOrders", label: "View food orders" },
  { key: "canPlaceOrders", label: "Place orders for guests" },
  { key: "canManageMenu", label: "Manage menu items" },
  { key: "canManageCategories", label: "Activate / deactivate categories" },
  { key: "canManageInventory", label: "Manage inventory / add stock" },
  { key: "canViewTabs", label: "View guest tabs / order summary" },
  { key: "canMarkPaid", label: "Mark orders as paid" },
  { key: "canGenerateBills", label: "Generate / print bills" },
  { key: "canChangeFoodSettings", label: "Change food settings" },
];

const EXPENSE_PERMISSION_OPTIONS = [
  { key: "canAddExpense", label: "Add expenses" },
  { key: "canEditExpense", label: "Edit expenses" },
  { key: "canDeleteExpense", label: "Delete expenses" },
  { key: "canViewExpenses", label: "View expense records" },
  { key: "canViewFoodBills", label: "View food revenue" },
  { key: "canAddIncome", label: "Add daily income entries" },
  { key: "canReconcile", label: "Reconcile daily balances" },
  { key: "canManageAccounts", label: "Manage account settings" },
];

const TOOLS_PERMISSION_OPTIONS = [
  { key: "canUseQRGenerator", label: "Use QR code generator" },
  { key: "canManageAttendance", label: "Manage staff attendance" },
];

const SPLITS_PERMISSION_OPTIONS = [
  { key: "canAddSplitExpense", label: "Add split expenses" },
  { key: "canEditSplitExpense", label: "Edit split expenses" },
  { key: "canDeleteSplitExpense", label: "Delete split expenses" },
  { key: "canSettleSplits", label: "Settle splits / Goko pay" },
  { key: "canManageSplits", label: "Manage people and groups" },
];

const ALL_PERMISSION_GROUPS = [
  NAV_PERMISSION_OPTIONS, CHECKIN_PERMISSION_OPTIONS, BOOKING_PERMISSION_OPTIONS,
  FOOD_PERMISSION_OPTIONS, EXPENSE_PERMISSION_OPTIONS, SPLITS_PERMISSION_OPTIONS, TOOLS_PERMISSION_OPTIONS,
];

export function ManagementUsers({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { apiCall } = useAdminApi(password, username);
  const { showError } = useAdminToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [formUsername, setFormUsername] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState("staff");
  const [formPermissions, setFormPermissions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const scrollBackUserId = useRef<number | null>(null);

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await apiCall({ action: "getUsers" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } finally { setLoading(false); }
  };

  const saveUser = async () => {
    if (!formUsername || !formDisplayName || (!editingUser && !formPassword)) {
      showError("Please fill all required fields");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        action: editingUser ? "updateUser" : "createUser",
        newUsername: formUsername,
        displayName: formDisplayName,
        role: formRole,
        permissions: formPermissions,
      };
      if (editingUser) payload.userId = editingUser.id;
      if (formPassword) payload.userPassword = formPassword;

      const res = await apiCall(payload);
      if (res.ok) {
        if (editingUser) scrollBackUserId.current = editingUser.id;
        setShowForm(false);
        setEditingUser(null);
        resetForm();
        await loadUsers();
        if (scrollBackUserId.current) {
          const id = scrollBackUserId.current; scrollBackUserId.current = null;
          setTimeout(() => { const el = document.querySelector(`[data-user-id="${id}"]`); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 200);
        }
      } else {
        const d = await res.json();
        showError("Failed to save user", d.error);
      }
    } finally { setSaving(false); }
  };

  const deleteUser = async (userId: number) => {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    const res = await apiCall({ action: "deleteUser", userId });
    if (res.ok) await loadUsers();
    else { const d = await res.json(); showError("Failed to delete user", d.error); }
  };

  const resetForm = () => {
    setFormUsername(""); setFormDisplayName(""); setFormPassword("");
    setFormRole("staff"); setFormPermissions({});
  };

  const startEdit = (user: User) => {
    setEditingUser(user);
    setFormUsername(user.username);
    setFormDisplayName(user.displayName);
    setFormPassword("");
    setFormRole(user.role);
    setFormPermissions(user.permissions || {});
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  };

  if (role !== "admin") {
    return <p className="py-10 text-center text-brand-green-dark/50">Only admins can manage users.</p>;
  }

  if (loading) return <AdminLoading message="Loading users..." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold text-brand-green-dark">Users & Permissions</h3>
        <Button type="button" variant="cta" onClick={() => { resetForm(); setEditingUser(null); setShowForm(true); setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}>
          <PlusIcon className="mr-1 h-4 w-4" /> Add User
        </Button>
      </div>

      {/* User list */}
      <div className="space-y-3">
        {users.map((user) => (
          <div key={user.id} data-user-id={user.id} className="flex items-center justify-between gap-3 rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
            <div className="flex items-center gap-3">
              {user.isSystem ? <ShieldCheckIcon className="h-5 w-5 text-brand-green" /> : <ShieldIcon className="h-5 w-5 text-brand-green-dark/30" />}
              <div className="min-w-0">
                <p className="font-medium text-brand-green-dark">{user.displayName}</p>
                <p className="text-xs text-brand-green-dark/50">@{user.username} · {user.role}{user.isSystem ? " (system)" : ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!user.isSystem && (
                <>
                  <button type="button" onClick={() => startEdit(user)} className="rounded-md p-1.5 text-brand-green-dark/40 hover:bg-brand-sand hover:text-brand-green">
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => deleteUser(user.id)} className="rounded-md p-1.5 text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600">
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && <p className="py-8 text-center text-sm text-brand-green-dark/50">No users configured yet.</p>}
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div ref={formRef} className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-6 shadow-sm dark:shadow-none">
          <h4 className="mb-4 font-semibold text-brand-green-dark">{editingUser ? "Edit User" : "Add New User"}</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Username *</label>
              <Input value={formUsername} onChange={(e) => setFormUsername(e.target.value)} placeholder="e.g. staff1" disabled={!!editingUser} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Display Name *</label>
              <Input value={formDisplayName} onChange={(e) => setFormDisplayName(e.target.value)} placeholder="e.g. John" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">{editingUser ? "New Password (leave blank to keep)" : "Password *"}</label>
              <Input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="••••••" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-brand-green-dark/60">Role</label>
              <select value={formRole} onChange={(e) => setFormRole(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-3 flex items-center justify-between">
              <label className="block text-xs font-medium text-brand-green-dark/60">Permissions</label>
              <button
                type="button"
                onClick={() => {
                  const allKeys = ALL_PERMISSION_GROUPS.flat().map((p) => p.key);
                  const allSelected = allKeys.every((k) => formPermissions[k]);
                  const updated: Record<string, boolean> = { ...formPermissions };
                  for (const k of allKeys) updated[k] = !allSelected;
                  setFormPermissions(updated);
                }}
                className="rounded-md border border-brand-mist px-2.5 py-1 text-[10px] font-medium text-brand-green-dark/60 hover:bg-brand-sand"
              >
                {ALL_PERMISSION_GROUPS.flat().every((p) => formPermissions[p.key]) ? "Deselect All" : "Select All"}
              </button>
            </div>

            {([
              ["Navigation Permissions", NAV_PERMISSION_OPTIONS],
              ["Check-in & Beds", CHECKIN_PERMISSION_OPTIONS],
              ["Bookings", BOOKING_PERMISSION_OPTIONS],
              ["Food & Kitchen", FOOD_PERMISSION_OPTIONS],
              ["Accounts & Finance", EXPENSE_PERMISSION_OPTIONS],
              ["Splits", SPLITS_PERMISSION_OPTIONS],
              ["Tools", TOOLS_PERMISSION_OPTIONS],
            ] as [string, typeof NAV_PERMISSION_OPTIONS][]).map(([heading, options], idx) => (
              <div key={heading} className={idx > 0 ? "mt-4 border-t border-brand-mist pt-4" : ""}>
                <label className="mb-2 block text-xs font-medium text-brand-green-dark/60">{heading}</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {options.map((p) => (
                    <label key={p.key} className="flex items-center gap-2 rounded-lg border border-brand-mist px-3 py-2 text-xs">
                      <input
                        type="checkbox"
                        checked={formPermissions[p.key] || false}
                        onChange={(e) => setFormPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))}
                        className="rounded border-brand-mist"
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={saveUser} disabled={saving}>{saving ? "Saving..." : editingUser ? "Update" : "Create"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setEditingUser(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
