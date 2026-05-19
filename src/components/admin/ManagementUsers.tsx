"use client";

import { useState, useEffect } from "react";
import { useAdminApi } from "./useAdminApi";
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

const PERMISSION_OPTIONS = [
  { key: "canAddCheckin", label: "Add check-ins" },
  { key: "canAssignBed", label: "Assign beds" },
  { key: "canCheckout", label: "Checkout guests" },
  { key: "canMarkClean", label: "Mark beds clean" },
  { key: "canEditRecords", label: "Edit records" },
  { key: "canDeleteRecords", label: "Delete records" },
  { key: "canManageDorms", label: "Manage dorms" },
  { key: "canViewStats", label: "View stats" },
];

export function ManagementUsers({ password, username, role }: { password: string; username?: string; role: Role }) {
  const { apiCall } = useAdminApi(password, username);
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
      alert("Please fill all required fields");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        action: editingUser ? "updateUser" : "createUser",
        username: formUsername,
        displayName: formDisplayName,
        role: formRole,
        permissions: formPermissions,
      };
      if (editingUser) payload.userId = editingUser.id;
      if (formPassword) payload.password = formPassword;

      const res = await apiCall(payload);
      if (res.ok) {
        setShowForm(false);
        setEditingUser(null);
        resetForm();
        await loadUsers();
      } else {
        const d = await res.json();
        alert(d.error || "Failed to save user");
      }
    } finally { setSaving(false); }
  };

  const deleteUser = async (userId: number) => {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    const res = await apiCall({ action: "deleteUser", userId });
    if (res.ok) await loadUsers();
    else { const d = await res.json(); alert(d.error || "Failed"); }
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
  };

  if (role !== "admin") {
    return <p className="py-10 text-center text-brand-green-dark/50">Only admins can manage users.</p>;
  }

  if (loading) return <AdminLoading message="Loading users..." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-brand-green-dark">Users & Permissions</h3>
        <Button type="button" variant="cta" onClick={() => { resetForm(); setEditingUser(null); setShowForm(true); }}>
          <PlusIcon className="mr-1 h-4 w-4" /> Add User
        </Button>
      </div>

      {/* User list */}
      <div className="space-y-3">
        {users.map((user) => (
          <div key={user.id} className="flex items-center justify-between rounded-xl border border-brand-mist bg-white p-4">
            <div className="flex items-center gap-3">
              {user.isSystem ? <ShieldCheckIcon className="h-5 w-5 text-brand-green" /> : <ShieldIcon className="h-5 w-5 text-brand-green-dark/30" />}
              <div>
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
                  <button type="button" onClick={() => deleteUser(user.id)} className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600">
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
        <div className="rounded-2xl border border-brand-mist bg-white p-6 shadow-sm">
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
            <label className="mb-2 block text-xs font-medium text-brand-green-dark/60">Permissions</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PERMISSION_OPTIONS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 rounded-lg border border-brand-mist px-3 py-2 text-xs">
                  <input
                    type="checkbox"
                    checked={formRole === "manager" || formPermissions[p.key] || false}
                    disabled={formRole === "manager"}
                    onChange={(e) => setFormPermissions((prev) => ({ ...prev, [p.key]: e.target.checked }))}
                    className="rounded border-brand-mist"
                  />
                  {p.label}
                </label>
              ))}
            </div>
            {formRole === "manager" && <p className="mt-1 text-[10px] text-brand-green-dark/40">Managers have all permissions by default</p>}
          </div>

          <div className="mt-5 flex gap-2">
            <Button type="button" variant="cta" onClick={saveUser} disabled={saving}>{saving ? "Saving..." : editingUser ? "Update" : "Create"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setEditingUser(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
