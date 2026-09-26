"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminToast } from "@/components/admin/AdminToast";
import { AdminLoading } from "./AdminLoading";
import { useTabWithHistory } from "@/hooks/useTabWithHistory";
import { hasPermission, type Role } from "./types";
import { cn, todayIST } from "@/lib/utils";
import {
  allocateEqual,
  allocatePercent,
  allocateShares,
  assertBalanced,
  inferGokoIncludeMode,
  owedIdsWithGoko,
  paiseToRupees,
  rupeesToPaise,
  sharesMoneyEqual,
  type GokoIncludeMode,
  type ShareInput,
} from "@/lib/splits";
import { CopyIcon, PlusIcon } from "lucide-react";

type SplitTab = "balances" | "activity" | "people" | "groups";

type Member = {
  id: number;
  name: string;
  phone: string;
  notes: string;
  kind: string;
  userId: number | null;
  employeeId: number | null;
  isHouse: number;
  isActive: number;
};

type Group = { id: number; name: string; memberIds: number[]; humanCount: number };
type SimplifyEdge = { from: number; to: number; amount: number };
type GokoPay = { payeeId: number; expenseId: number; amount: number; description: string };
type Account = { id: number; name: string; nickname: string | null; isDefault: number };
type Vendor = { id: number; name: string };

const LAST_GROUP_KEY = "goko.splits.lastGroupId";
const GOKO_SUBS = ["Groceries", "Supplies", "Utilities", "Maintenance", "Transport", "Miscellaneous", "Others"];

function memberLabel(m: Member, all: Member[]) {
  const dup = all.filter((x) => x.name === m.name).length > 1;
  if (!dup) return m.name;
  const tail = m.phone.replace(/\D/g, "").slice(-4);
  return tail ? `${m.name} · ${tail}` : `${m.name} #${m.id}`;
}

function gcdPaise(a: number, b: number) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function shareWeightFields(shares: ShareInput[]): Record<number, string> {
  const oweds = shares.filter((s) => s.owedAmount > 0).map((s) => s.owedAmount);
  let g = oweds[0] || 1;
  for (const n of oweds) g = gcdPaise(g, n);
  const o: Record<number, string> = {};
  for (const s of shares) o[s.memberId] = String(Math.round(s.owedAmount / g) || 0);
  return o;
}

export function AdminSplits({
  password, username, role, permissions = {},
}: {
  password: string;
  username?: string;
  role: Role;
  permissions?: Record<string, boolean>;
}) {
  const { showError, showSuccess, showInfo } = useAdminToast();
  const [tab, setTab] = useTabWithHistory<SplitTab>("tab", "balances", {
    validValues: ["balances", "activity", "people", "groups"],
  });
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selfMemberId, setSelfMemberId] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [nets, setNets] = useState<{ memberId: number; net: number }[]>([]);
  const [simplify, setSimplify] = useState<SimplifyEdge[]>([]);
  const [overall, setOverall] = useState<{ memberId: number; net: number }[]>([]);
  const [gokoPays, setGokoPays] = useState<GokoPay[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState("");
  const [payTarget, setPayTarget] = useState<GokoPay | null>(null);

  const canAdd = hasPermission(role, permissions, "canAddSplitExpense");
  const canEdit = hasPermission(role, permissions, "canEditSplitExpense");
  const canDelete = hasPermission(role, permissions, "canDeleteSplitExpense");
  const canSettle = hasPermission(role, permissions, "canSettleSplits");
  const canManage = hasPermission(role, permissions, "canManageSplits");
  const canAccounts = hasPermission(role, permissions, "canAddExpense");

  const api = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const res = await fetch("/api/admin/splits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, username, action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Request failed") as Error & { hostelExpenseId?: number };
      if (typeof data.hostelExpenseId === "number") err.hostelExpenseId = data.hostelExpenseId;
      throw err;
    }
    return data;
  }, [password, username]);

  const house = members.find((m) => m.isHouse === 1) || null;
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const selected = groups.find((g) => g.id === groupId) || null;
  const groupHumans = selected
    ? selected.memberIds.map((id) => byId.get(id)).filter((m): m is Member => !!m && m.isHouse !== 1 && m.isActive === 1)
    : [];

  const loadCore = useCallback(async () => {
    const [m, g] = await Promise.all([api("listMembers"), api("listGroups")]);
    setMembers(m.members || []);
    setSelfMemberId(m.selfMemberId ?? null);
    setGroups(g.groups || []);
    return { groups: (g.groups || []) as Group[] };
  }, [api]);

  const loadGroup = useCallback(async (gid: number) => {
    const [b, a] = await Promise.all([api("getBalances", { groupId: gid }), api("listActivity", { groupId: gid })]);
    setNets(b.nets || []);
    setSimplify(b.simplify || []);
    setOverall(b.overallNets || []);
    setGokoPays(b.gokoPayButtons || []);
    setActivity(a.items || []);
    if (b.selfMemberId != null) setSelfMemberId(b.selfMemberId);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const core = await loadCore();
        if (cancelled) return;
        const sticky = Number(localStorage.getItem(LAST_GROUP_KEY) || 0);
        const stickyGroup = core.groups.find((g) => g.id === sticky && g.humanCount >= 1);
        const first = stickyGroup || core.groups.find((g) => g.humanCount >= 1) || null;
        setGroupId(first?.id ?? null);
        if (first) await loadGroup(first.id);
      } catch (err) {
        showError(err instanceof Error ? err.message : "Failed to load splits");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadCore, loadGroup, showError]);

  const refresh = async (gid = groupId) => {
    await loadCore();
    if (gid) await loadGroup(gid);
  };

  const pickGroup = (id: number) => {
    setGroupId(id);
    const g = groups.find((x) => x.id === id);
    if (g && g.humanCount >= 1) localStorage.setItem(LAST_GROUP_KEY, String(id));
    loadGroup(id).catch((err) => showError(err instanceof Error ? err.message : "Failed to load group"));
  };

  if (loading) return <AdminLoading />;
  const mainTab = tab === "people" || tab === "groups" ? "manage" : tab;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold text-brand-green-dark dark:text-zinc-100">Splits</h2>
          <p className="text-sm text-brand-green-dark/60">Staff and volunteer IOUs. Hostel cash still goes through Accounts.</p>
        </div>
        {canAdd && (
          <Button type="button" variant="cta" className="gap-1" onClick={() => { setEditing(null); setSheetOpen(true); }} disabled={!selected || groupHumans.length === 0}>
            <PlusIcon className="h-4 w-4" /> Add expense
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-white dark:bg-card p-1 border border-brand-mist">
        {([["balances", "Balances"], ["activity", "Activity"], ["manage", "Manage"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id === "manage" ? (tab === "groups" ? "groups" : "people") : id)}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", mainTab === id ? "bg-brand-green text-white" : "text-brand-green-dark/70 hover:bg-brand-green/[0.06]")}
          >
            {label}
          </button>
        ))}
      </div>

      {mainTab !== "manage" && (
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs">Group</Label>
          <select value={groupId ?? ""} onChange={(e) => pickGroup(Number(e.target.value))} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
            {groups.length === 0 && <option value="">No groups yet</option>}
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name} #{g.id}</option>)}
          </select>
        </div>
      )}

      {members.filter((m) => m.isActive === 1 && m.isHouse !== 1).length === 0 && (
        <div className="rounded-2xl border border-dashed border-brand-mist bg-white dark:bg-card p-6 text-sm text-brand-green-dark/70">
          Add people, then create a group (e.g. Kitchen).
          {canManage && <Button type="button" className="ml-3" size="sm" onClick={() => setTab("people")}>Add people</Button>}
        </div>
      )}
      {members.filter((m) => m.isActive === 1 && m.isHouse !== 1).length > 0 && groups.length === 0 && (
        <div className="rounded-2xl border border-dashed border-brand-mist bg-white dark:bg-card p-6 text-sm text-brand-green-dark/70">
          Create a group (e.g. Kitchen) to add expenses.
          {canManage && <Button type="button" className="ml-3" size="sm" onClick={() => setTab("groups")}>Create Kitchen</Button>}
        </div>
      )}

      {tab === "balances" && selected && (
        <BalancesView
          members={members} group={selected} nets={nets} simplify={simplify} overall={overall}
          gokoPays={gokoPays} selfMemberId={selfMemberId} houseId={house?.id ?? null}
          canSettle={canSettle} canAccounts={canAccounts} canManage={canManage} busy={busy}
          onCopy={async (text) => { await navigator.clipboard.writeText(text); showSuccess("Copied"); }}
          onSettle={async (edge, amount, confirmOverpay) => {
            setBusy(`settle-${edge.from}-${edge.to}`);
            try {
              await api("addSettlement", {
                groupId: selected.id, fromMemberId: edge.from, toMemberId: edge.to, amount,
                method: "other",
                markSettled: amount === edge.amount,
                confirmOverpay,
              });
              showSuccess(confirmOverpay ? "Overpay recorded" : "Marked settled");
              await refresh(selected.id);
            } catch (err) {
              showError(err instanceof Error ? err.message : "Settle failed");
            } finally { setBusy(""); }
          }}
          onPay={setPayTarget}
        />
      )}

      {tab === "activity" && selected && (
        <ActivityView
          items={activity} members={members} canEdit={canEdit} canDelete={canDelete} canSettle={canSettle} busy={busy}
          onEdit={(expense) => { setEditing(expense); setSheetOpen(true); }}
          onDelete={async (id) => {
            if (!confirm("Hide this expense from balances? Undo settlements in this group first if any. Linked Accounts rows stay.")) return;
            setBusy(`del-${id}`);
            try {
              const data = await api("deleteExpense", { id });
              if (data.warning) showInfo(data.warning);
              showSuccess("Expense removed from splits");
              await refresh(selected.id);
            } catch (err) {
              showError(err instanceof Error ? err.message : "Delete failed");
            } finally { setBusy(""); }
          }}
          onUndoSettle={async (id) => {
            if (!confirm("Undo this settlement?")) return;
            setBusy(`undsettle-${id}`);
            try {
              await api("deleteSettlement", { id });
              showSuccess("Settlement undone");
              await refresh(selected.id);
            } catch (err) {
              showError(err instanceof Error ? err.message : "Undo failed");
            } finally { setBusy(""); }
          }}
        />
      )}

      {mainTab === "manage" && (
        <div className="flex gap-1">
          <button type="button" onClick={() => setTab("people")} className={cn("rounded-lg px-3 py-1.5 text-sm", tab === "people" ? "bg-brand-green/10 font-semibold" : "text-brand-green-dark/60")}>People</button>
          <button type="button" onClick={() => setTab("groups")} className={cn("rounded-lg px-3 py-1.5 text-sm", tab === "groups" ? "bg-brand-green/10 font-semibold" : "text-brand-green-dark/60")}>Groups</button>
        </div>
      )}

      {tab === "people" && <PeopleView members={members} canManage={canManage} api={api} onChange={() => refresh().catch((e) => showError(e.message))} />}
      {tab === "groups" && <GroupsView members={members} groups={groups} canManage={canManage} api={api} onChange={() => refresh().catch((e) => showError(e.message))} onCreated={async (id) => {
        localStorage.setItem(LAST_GROUP_KEY, String(id));
        setGroupId(id);
        setTab("balances");
        await refresh(id);
      }} onDeleted={async (id) => {
        if (groupId === id) {
          localStorage.removeItem(LAST_GROUP_KEY);
          setGroupId(null);
        }
        const core = await loadCore();
        if (groupId === id) {
          const first = core.groups.find((g) => g.humanCount >= 1) || null;
          setGroupId(first?.id ?? null);
          if (first) {
            localStorage.setItem(LAST_GROUP_KEY, String(first.id));
            await loadGroup(first.id);
          }
        } else if (groupId) await loadGroup(groupId);
      }} />}

      {sheetOpen && selected && (
        <ExpenseSheet
          members={members} group={selected} house={house} selfMemberId={selfMemberId}
          editing={editing} canAccounts={canAccounts} canManage={canManage} api={api}
          settleLocked={activity.some((item) => item.kind === "settlement" && item.settlement && !item.settlement.hostelExpenseId)}
          onClose={() => { setSheetOpen(false); setEditing(null); }}
          onSaved={async (gid) => {
            localStorage.setItem(LAST_GROUP_KEY, String(gid));
            setSheetOpen(false);
            setEditing(null);
            showSuccess(editing ? "Expense updated" : "Expense added");
            await refresh(gid);
          }}
          onError={showError}
        />
      )}

      {payTarget && house && selected && byId.get(payTarget.payeeId) && (
        <GokoPayModal
          target={payTarget} payee={byId.get(payTarget.payeeId)!} members={members}
          canAccounts={canAccounts} api={api} onClose={() => setPayTarget(null)}
          onPaid={async (warning?: string) => {
            setPayTarget(null);
            if (warning) showInfo(warning);
            showSuccess("Goko paid via Accounts");
            await refresh(selected.id);
          }}
          onError={showError}
        />
      )}
    </div>
  );
}

function BalancesView(props: {
  members: Member[]; group: Group; nets: { memberId: number; net: number }[];
  simplify: SimplifyEdge[]; overall: { memberId: number; net: number }[];
  gokoPays: GokoPay[]; selfMemberId: number | null; houseId: number | null;
  canSettle: boolean; canAccounts: boolean; canManage: boolean; busy: string;
  onCopy: (text: string) => void;
  onSettle: (edge: SimplifyEdge, amount: number, confirmOverpay: boolean) => void;
  onPay: (p: GokoPay) => void;
}) {
  const { members, group, nets, simplify, overall, gokoPays, selfMemberId, houseId, canSettle, canAccounts, canManage, busy, onCopy, onSettle, onPay } = props;
  const you = selfMemberId != null ? overall.find((n) => n.memberId === selfMemberId) : null;
  return (
    <div className="space-y-4">
      {you && you.net !== 0 && (
        <div className="rounded-xl border border-brand-mist bg-white dark:bg-card px-4 py-3 text-sm">
          <span className="font-semibold">You {you.net > 0 ? "are owed" : "owe"} ₹{paiseToRupees(Math.abs(you.net))}</span>
          <span className="text-brand-green-dark/50"> overall (all groups)</span>
        </div>
      )}
      {canManage && selfMemberId == null && (
        <p className="text-xs text-brand-green-dark/50">Link your login on a person in Manage → People to see You owe here.</p>
      )}
      <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card overflow-hidden">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-green-dark/50">In {group.name} #{group.id}</div>
        {nets.length === 0 && <p className="px-4 py-6 text-sm text-brand-green-dark/50">No balances yet.</p>}
        {nets.map((n) => {
          const m = members.find((x) => x.id === n.memberId);
          if (!m) return null;
          return (
            <div key={n.memberId} className="flex items-center justify-between border-t border-brand-mist px-4 py-2.5 text-sm">
              <span>{memberLabel(m, members)}{m.isHouse === 1 ? " (hostel)" : ""}</span>
              <span className={n.net > 0 ? "text-green-700" : n.net < 0 ? "text-red-600" : "text-brand-green-dark/40"}>
                {n.net === 0 ? "settled" : `${n.net > 0 ? "+" : "−"}₹${paiseToRupees(Math.abs(n.net))}`}
              </span>
            </div>
          );
        })}
      </div>
      {simplify.filter((e) => e.from !== houseId && e.to !== houseId).map((edge) => {
        const from = members.find((m) => m.id === edge.from);
        const to = members.find((m) => m.id === edge.to);
        if (!from || !to) return null;
        const summary = `Pay ${memberLabel(to, members)} #${to.id} ₹${paiseToRupees(edge.amount)} for ${group.name} #${group.id} — ${memberLabel(from, members)}. Phone: ${to.phone || "ask them"}.`;
        return (
          <SettleCard
            key={`${edge.from}-${edge.to}-${edge.amount}`}
            from={from} to={to} members={members} group={group} edge={edge}
            canSettle={canSettle} busy={busy} onCopy={onCopy} onSettle={onSettle}
            summary={summary}
          />
        );
      })}
      {gokoPays.map((p) => {
        const payee = members.find((m) => m.id === p.payeeId);
        if (!payee) return null;
        return (
          <div key={`${p.expenseId}-${p.payeeId}`} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
            <p className="text-sm font-medium">Goko pays {memberLabel(payee, members)} ₹{paiseToRupees(p.amount)}</p>
            <p className="text-xs text-brand-green-dark/60">{p.description} · books today in Accounts</p>
            {gokoPays.length > 1 && <p className="text-xs text-brand-green-dark/50">Hostel share goes to who paid, by member order — not split by how much each paid.</p>}
            {canSettle && canAccounts && <Button type="button" size="sm" variant="cta" disabled={busy !== ""} onClick={() => onPay(p)}>Pay via Accounts</Button>}
            {canSettle && !canAccounts && <p className="text-xs text-brand-green-dark/50">Needs Accounts add-expense permission.</p>}
          </div>
        );
      })}
    </div>
  );
}

function SettleCard({ from, to, members, group, edge, canSettle, busy, onCopy, onSettle, summary }: {
  from: Member; to: Member; members: Member[]; group: Group; edge: SimplifyEdge;
  canSettle: boolean; busy: string;
  onCopy: (text: string) => void;
  onSettle: (edge: SimplifyEdge, amount: number, confirmOverpay: boolean) => void;
  summary: string;
}) {
  const [custom, setCustom] = useState(paiseToRupees(edge.amount));
  const amount = rupeesToPaise(custom);
  return (
    <div className="rounded-xl border border-brand-mist bg-white dark:bg-card p-3 space-y-2">
      <p className="text-sm font-medium">{memberLabel(from, members)} pays {memberLabel(to, members)} ₹{paiseToRupees(edge.amount)} — in {group.name} #{group.id}</p>
      <p className="text-xs text-brand-green-dark/50">Settling in {group.name} only.</p>
      {canSettle && (
        <div>
          <Label className="text-xs">Amount (₹)</Label>
          <Input type="number" min="0" step="0.01" value={custom} onChange={(e) => setCustom(e.target.value)} className="mt-1" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => onCopy(paiseToRupees(edge.amount))}><CopyIcon className="h-3.5 w-3.5" /> Copy ₹</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onCopy(summary)}>Copy settle summary</Button>
        {canSettle && (
          <Button type="button" size="sm" variant="cta" disabled={busy !== "" || !Number.isInteger(amount) || amount <= 0} onClick={() => {
            if (amount > edge.amount && !confirm("This is more than they owe and will reverse the debt. Continue?")) return;
            onSettle(edge, amount, amount > edge.amount);
          }}>
            {busy === `settle-${edge.from}-${edge.to}` ? "Saving…" : amount === edge.amount ? "Mark settled" : "Record payment"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ActivityView({ items, members, canEdit, canDelete, canSettle, busy, onEdit, onDelete, onUndoSettle }: {
  items: any[]; members: Member[]; canEdit: boolean; canDelete: boolean; canSettle: boolean; busy: string;
  onEdit: (expense: any) => void; onDelete: (id: number) => void; onUndoSettle: (id: number) => void;
}) {
  if (!items.length) return <p className="text-sm text-brand-green-dark/50">No activity yet.</p>;
  return (
    <div className="space-y-2">
      {items.map((item) => {
        if (item.kind === "expense") {
          const e = item.expense;
          const payers = (e.shares as ShareInput[] || []).filter((s) => s.paidAmount > 0);
          const payerName = payers.map((s) => {
            const m = members.find((x) => x.id === s.memberId);
            return m ? memberLabel(m, members) : `#${s.memberId}`;
          }).join(" + ") || "Someone";
          return (
            <div key={`e-${e.id}`} className="rounded-xl border border-brand-mist bg-white dark:bg-card px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="text-left flex-1" onClick={() => canEdit && onEdit(e)} disabled={!canEdit}>
                  <p className="font-medium text-sm">{e.description}{e.reimbursed ? " · Accounts booked" : e.hostelExpenseId ? " · hostel paid" : ""}</p>
                  <p className="text-xs text-brand-green-dark/50">{e.expenseDate} · {payerName} paid ₹{paiseToRupees(e.totalAmount)}</p>
                </button>
                <div className="flex gap-1">
                  {canEdit && <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(e)}>Edit</Button>}
                  {canDelete && !e.reimbursed && <Button type="button" size="sm" variant="ghost" disabled={busy !== ""} onClick={() => onDelete(e.id)}>Delete</Button>}
                </div>
              </div>
            </div>
          );
        }
        const s = item.settlement;
        const fromM = members.find((m) => m.id === s.fromMemberId);
        const toM = members.find((m) => m.id === s.toMemberId);
        const from = fromM ? memberLabel(fromM, members) : `#${s.fromMemberId}`;
        const to = toM ? memberLabel(toM, members) : `#${s.toMemberId}`;
        return (
          <div key={`s-${s.id}`} className="rounded-xl border border-brand-mist bg-white dark:bg-card px-4 py-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p>{from} paid {to} ₹{paiseToRupees(s.amount)}</p>
                <p className="text-xs text-brand-green-dark/50">{s.hostelExpenseId ? `Accounts #${s.hostelExpenseId}` : s.method}</p>
              </div>
              {canSettle && !s.hostelExpenseId && (
                <Button type="button" size="sm" variant="ghost" disabled={busy !== ""} onClick={() => onUndoSettle(s.id)}>Undo</Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PeopleView({ members, canManage, api, onChange }: {
  members: Member[]; canManage: boolean;
  api: (action: string, extra?: Record<string, unknown>) => Promise<any>;
  onChange: () => void;
}) {
  const { showError, showSuccess } = useAdminToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState("volunteer");
  const [userId, setUserId] = useState("");
  const [logins, setLogins] = useState<{ id: number; username: string; displayName: string }[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!canManage) return;
    api("listLoginUsers").then((d) => setLogins(d.users || [])).catch(() => {});
  }, [api, canManage]);
  const linked = new Set(members.map((m) => m.userId).filter((id): id is number => id != null));
  return (
    <div className="space-y-4">
      {canManage && (
        <form className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 grid gap-3 sm:grid-cols-4" onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await api("addMember", { name: name.trim(), phone: phone.trim(), kind, userId: userId ? Number(userId) : null });
            setName(""); setPhone(""); setUserId("");
            showSuccess("Person added");
            onChange();
          } catch (err) { showError(err instanceof Error ? err.message : "Failed"); }
          finally { setSaving(false); }
        }}>
          <div className="sm:col-span-2"><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1" /></div>
          <div><Label className="text-xs">Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" /></div>
          <div>
            <Label className="text-xs">Kind</Label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="volunteer">Volunteer</option>
              <option value="staff">Staff</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Link login (You owe strip)</Label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">None</option>
              {logins.filter((u) => !linked.has(u.id)).map((u) => (
                <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4"><Button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Add person"}</Button></div>
        </form>
      )}
      <div className="rounded-2xl border border-brand-mist bg-white dark:bg-card divide-y divide-brand-mist">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <div>
              <span className="font-medium">{memberLabel(m, members)}</span>
              {m.isHouse === 1 && <span className="ml-2 text-xs text-brand-green-dark/50">hostel</span>}
              {m.isActive !== 1 && <span className="ml-2 text-xs text-red-500">inactive</span>}
              <div className="text-xs text-brand-green-dark/50">{m.kind}{m.phone ? ` · ${m.phone}` : ""} #{m.id}{m.userId ? ` · login #${m.userId}` : ""}</div>
            </div>
            <div className="flex items-center gap-2">
              {canManage && m.isHouse !== 1 && m.isActive === 1 && (
                <select
                  value={m.userId ?? ""}
                  onChange={async (e) => {
                    try {
                      await api("updateMember", { id: m.id, userId: e.target.value ? Number(e.target.value) : null });
                      onChange();
                    } catch (err) { showError(err instanceof Error ? err.message : "Failed"); }
                  }}
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                >
                  <option value="">No login</option>
                  {logins.filter((u) => u.id === m.userId || !linked.has(u.id)).map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                  ))}
                </select>
              )}
              {canManage && m.isHouse !== 1 && m.isActive === 1 && (
                <Button type="button" size="sm" variant="ghost" onClick={async () => {
                  try { await api("deactivateMember", { id: m.id }); showSuccess("Deactivated"); onChange(); }
                  catch (err) { showError(err instanceof Error ? err.message : "Failed"); }
                }}>Deactivate</Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupsView({ members, groups, canManage, api, onChange, onCreated, onDeleted }: {
  members: Member[]; groups: Group[]; canManage: boolean;
  api: (action: string, extra?: Record<string, unknown>) => Promise<any>;
  onChange: () => void;
  onCreated: (id: number) => void | Promise<void>;
  onDeleted: (id: number) => void | Promise<void>;
}) {
  const { showError, showSuccess } = useAdminToast();
  const [name, setName] = useState("Kitchen");
  const humans = members.filter((m) => m.isHouse !== 1 && m.isActive === 1);
  const [picked, setPicked] = useState<number[]>([]);
  return (
    <div className="space-y-4">
      {canManage && (
        <form className="rounded-2xl border border-brand-mist bg-white dark:bg-card p-4 space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          try {
            const data = await api("addGroup", { name: name.trim(), memberIds: picked });
            setName("Kitchen"); setPicked([]);
            showSuccess("Group created");
            if (typeof data.id === "number") await onCreated(data.id);
            else onChange();
          } catch (err) { showError(err instanceof Error ? err.message : "Failed"); }
        }}>
          <div><Label className="text-xs">Group name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kitchen" required className="mt-1" /></div>
          <div className="flex flex-wrap gap-2">
            {humans.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-xs border border-brand-mist rounded-lg px-2 py-1">
                <input type="checkbox" checked={picked.includes(m.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, m.id] : p.filter((id) => id !== m.id))} />
                {memberLabel(m, members)}
              </label>
            ))}
          </div>
          <Button type="submit" disabled={!name.trim() || picked.length < 1}>{picked.length < 1 ? "Pick people first" : "Create group"}</Button>
        </form>
      )}
      {groups.map((g) => (
        <div key={g.id} className="rounded-xl border border-brand-mist bg-white dark:bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">{g.name} #{g.id}</p>
            {canManage && (
              <Button type="button" size="sm" variant="ghost" onClick={async () => {
                if (!confirm(`Delete group ${g.name}?`)) return;
                try { await api("deleteGroup", { id: g.id }); showSuccess("Group deleted"); await onDeleted(g.id); }
                catch (err) { showError(err instanceof Error ? err.message : "Failed"); }
              }}>Delete</Button>
            )}
          </div>
          <p className="text-xs text-brand-green-dark/50 mt-1">{g.memberIds.map((id) => { const m = members.find((x) => x.id === id); return m ? memberLabel(m, members) : null; }).filter(Boolean).join(", ") || "No one yet"}</p>
          {canManage && (
            <div className="mt-2 flex flex-wrap gap-2">
              {humans.map((m) => {
                const on = g.memberIds.includes(m.id);
                return (
                  <label key={m.id} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={on} onChange={async (e) => {
                      const next = e.target.checked ? [...g.memberIds, m.id] : g.memberIds.filter((id) => id !== m.id);
                      try { await api("setGroupMembers", { id: g.id, memberIds: next }); onChange(); }
                      catch (err) { showError(err instanceof Error ? err.message : "Failed"); }
                    }} />
                    {memberLabel(m, members)}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ExpenseSheet({ members, group, house, selfMemberId, editing, canAccounts, canManage, api, settleLocked, onClose, onSaved, onError }: {
  members: Member[]; group: Group; house: Member | null; selfMemberId: number | null; editing: any | null;
  canAccounts: boolean; canManage: boolean; settleLocked?: boolean;
  api: (action: string, extra?: Record<string, unknown>) => Promise<any>;
  onClose: () => void; onSaved: (groupId: number) => void; onError: (msg: string) => void;
}) {
  const initialHumans = members.filter((m) => m.isHouse !== 1 && m.isActive === 1 && (group.memberIds.includes(m.id) || editing?.shares?.some((s: ShareInput) => s.memberId === m.id)));
  const defaultPayer = (selfMemberId && initialHumans.some((m) => m.id === selfMemberId))
    ? selfMemberId
    : [...initialHumans].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)[0]?.id ?? 0;

  const [description, setDescription] = useState(editing?.description || "");
  const [amount, setAmount] = useState(editing ? paiseToRupees(editing.totalAmount) : "");
  const [payerId, setPayerId] = useState<number>(editing?.shares?.find((s: ShareInput) => s.paidAmount > 0)?.memberId || defaultPayer);
  const [checked, setChecked] = useState<number[]>(
    editing
      ? (editing.shares as ShareInput[]).filter((s) => s.owedAmount > 0 && members.find((m) => m.id === s.memberId)?.isHouse !== 1).map((s) => s.memberId)
      : initialHumans.map((m) => m.id),
  );
  const [more, setMore] = useState(() => {
    const pays = (editing?.shares as ShareInput[] | undefined)?.filter((s) => s.paidAmount > 0) || [];
    return pays.length > 1;
  });
  const [date, setDate] = useState(editing?.expenseDate || todayIST());
  const [notes, setNotes] = useState(editing?.notes || "");
  const [method, setMethod] = useState<"equal" | "exact" | "percent" | "shares">(editing?.splitMethod || "equal");
  const [gokoMode, setGokoMode] = useState<GokoIncludeMode>(
    inferGokoIncludeMode(house?.id, editing?.totalAmount, editing?.shares || [], editing?.splitMethod || "equal"),
  );
  const [exact, setExact] = useState<Record<number, string>>(() => {
    const o: Record<number, string> = {};
    for (const s of (editing?.shares as ShareInput[] | undefined) || []) o[s.memberId] = paiseToRupees(s.owedAmount);
    return o;
  });
  const [pct, setPct] = useState<Record<number, string>>(() => {
    const o: Record<number, string> = {};
    const total = editing?.totalAmount || 0;
    if (!total) return o;
    for (const s of (editing?.shares as ShareInput[] | undefined) || []) {
      o[s.memberId] = ((s.owedAmount / total) * 100).toFixed(2);
    }
    return o;
  });
  const [weights, setWeights] = useState<Record<number, string>>(() => shareWeightFields((editing?.shares as ShareInput[] | undefined) || []));
  const [multiPay, setMultiPay] = useState(() => ((editing?.shares as ShareInput[] | undefined)?.filter((s) => s.paidAmount > 0).length || 0) > 1);
  const [paidExtra, setPaidExtra] = useState<Record<number, string>>(() => {
    const o: Record<number, string> = {};
    for (const s of (editing?.shares as ShareInput[] | undefined) || []) {
      if (s.paidAmount > 0) o[s.memberId] = paiseToRupees(s.paidAmount);
    }
    return o;
  });
  const [reuseHostelId, setReuseHostelId] = useState<number | null>(null);
  const moneyLocked = Boolean(editing?.hostelExpenseId || editing?.reimbursed || (editing && settleLocked));
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [inlineName, setInlineName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [subCategory, setSubCategory] = useState("Groceries");
  const [mainCategory, setMainCategory] = useState("food_expense");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [created, setCreated] = useState<Member[]>([]);
  const [extraIds, setExtraIds] = useState<number[]>([]);
  const gokoIsPayer = !multiPay && house != null && payerId === house.id;
  const allMembers = [...members, ...created];
  const humans = allMembers.filter((m) => m.isHouse !== 1 && m.isActive === 1);
  const inGroup = humans.filter((m) => group.memberIds.includes(m.id) || extraIds.includes(m.id) || editing?.shares?.some((s: ShareInput) => s.memberId === m.id));

  useEffect(() => {
    if (!gokoIsPayer || !canAccounts) return;
    api("listAccounts").then((d) => {
      setAccounts(d.accounts || []);
      setVendors(d.vendors || []);
      const def = (d.accounts || []).find((a: Account) => a.isDefault === 1);
      if (def) setAccountId(String(def.id));
    }).catch(() => {});
  }, [api, gokoIsPayer, canAccounts]);

  function buildShares(): ShareInput[] | string {
    if (/\.\d{3,}$/.test(amount.trim())) return "Use at most 2 decimal places";
    const total = rupeesToPaise(amount);
    if (!Number.isInteger(total) || total <= 0) return "Enter a valid amount";
    let paidMap: Map<number, number>;
    if (gokoIsPayer) {
      if (!house) return "House member missing";
      paidMap = new Map([[house.id, total]]);
    } else if (multiPay) {
      paidMap = new Map();
      for (const [id, v] of Object.entries(paidExtra)) {
        const n = rupeesToPaise(v);
        if (n > 0) paidMap.set(Number(id), n);
      }
      const paidSum = [...paidMap.values()].reduce((a, b) => a + b, 0);
      if (paidMap.size === 0) return "Pick who paid";
      if (paidSum !== total) return `Paid amounts must sum to ₹${paiseToRupees(total)}`;
    } else {
      if (!payerId) return "Pick who paid";
      paidMap = new Map([[payerId, total]]);
    }
    if (!gokoIsPayer && gokoMode !== "covers_all") {
      if (!checked.some((id) => id !== house?.id)) return "Select people to split with";
    }
    let owed: Map<number, number>;
    try {
      if (gokoIsPayer || gokoMode === "covers_all") {
        if (!house) return "House member missing";
        owed = new Map([[house.id, total]]);
      } else if (method === "equal") {
        const ids = owedIdsWithGoko(checked, gokoMode, house?.id ?? null);
        if (ids.length === 0) return "Select people to split with";
        owed = allocateEqual(total, ids);
      } else if (method === "percent") {
        const rows = owedIdsWithGoko(checked, gokoMode, house?.id ?? null)
          .map((id) => ({ memberId: id, basisPoints: Math.round(Number(pct[id] || 0) * 100) }))
          .filter((r) => r.basisPoints > 0);
        owed = allocatePercent(total, rows);
      } else if (method === "shares") {
        const rows = owedIdsWithGoko(checked, gokoMode, house?.id ?? null)
          .map((id) => ({ memberId: id, shares: Number(weights[id] || 0) }))
          .filter((r) => r.shares > 0);
        owed = allocateShares(total, rows);
      } else {
        owed = new Map();
        for (const id of owedIdsWithGoko(checked, gokoMode, house?.id ?? null)) {
          owed.set(id, rupeesToPaise(exact[id] || "0") || 0);
        }
      }
    } catch (err) {
      return err instanceof Error ? err.message : "Split failed";
    }
    const ids = new Set([...paidMap.keys(), ...owed.keys()]);
    const shares: ShareInput[] = [...ids].map((memberId) => ({
      memberId, paidAmount: paidMap.get(memberId) || 0, owedAmount: owed.get(memberId) || 0,
    })).filter((s) => s.paidAmount > 0 || s.owedAmount > 0);
    const err = assertBalanced(total, shares);
    if (err) return err === "owed must sum to total" && method === "exact" ? `₹${paiseToRupees(total - shares.reduce((n, s) => n + s.owedAmount, 0))} left to assign` : err;
    if (!gokoIsPayer && shares.every((s) => s.paidAmount === s.owedAmount)) return "Nothing to split";
    return shares;
  }

  const preview = amount ? buildShares() : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-card p-5 space-y-3">
        <h3 className="font-display text-lg font-bold">{editing ? "Edit expense" : "Add expense"}</h3>
        <p className="text-xs text-brand-green-dark/50">{group.name} #{group.id}</p>
        {moneyLocked && (
          <p className="text-xs text-amber-800">
            {editing && settleLocked && !editing.hostelExpenseId && !editing.reimbursed
              ? "Undo settlements in this group before changing money — description, notes, and date only."
              : "Money is locked after an Accounts booking — description, notes, and date only."}
          </p>
        )}
        <div><Label className="text-xs">Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" /></div>
        <div><Label className="text-xs">Amount (₹)</Label><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={moneyLocked} className="mt-1" /></div>
        <div>
          <Label className="text-xs">Paid by</Label>
          <select value={payerId} disabled={moneyLocked || multiPay} onChange={(e) => setPayerId(Number(e.target.value))} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            {inGroup.map((m) => <option key={m.id} value={m.id}>{memberLabel(m, allMembers)}</option>)}
            {house && canAccounts && !multiPay && <option value={house.id}>Goko (hostel account)</option>}
          </select>
        </div>
        {!gokoIsPayer && gokoMode !== "covers_all" && (
          <div>
            <Label className="text-xs">{method === "equal" ? "Split equally among" : "Split among"}</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {inGroup.map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 text-xs border border-brand-mist rounded-lg px-2 py-1">
                  <input type="checkbox" checked={checked.includes(m.id)} disabled={moneyLocked} onChange={(e) => setChecked((c) => e.target.checked ? [...c, m.id] : c.filter((id) => id !== m.id))} />
                  {memberLabel(m, allMembers)}
                </label>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="text-xs text-brand-green" onClick={() => setMore((v) => !v)}>{more ? "Less" : "More"}</button>
        {more && (
          <div className="space-y-3 border-t border-brand-mist pt-3">
            <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" /></div>
            <div><Label className="text-xs">Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" /></div>
            {!gokoIsPayer && (
              <>
                <div>
                  <Label className="text-xs">Include Goko (hostel share)</Label>
                  <select value={gokoMode} disabled={moneyLocked} onChange={(e) => {
                    const next = e.target.value as GokoIncludeMode;
                    setGokoMode(next);
                    if (next === "equal") setMethod("equal");
                  }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="none">No — personal split only</option>
                    <option value="covers_all">Staff paid — hostel owes the whole bill</option>
                    <option value="equal">Equal with the group</option>
                    <option value="grid">Use the grid</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Method</Label>
                  <select value={method} disabled={moneyLocked || gokoMode === "equal"} onChange={(e) => {
                    const next = e.target.value as typeof method;
                    setMethod(next);
                    if (gokoMode === "equal" && next !== "equal") setGokoMode("grid");
                    if (next === "percent") {
                      const ids = owedIdsWithGoko(checked, gokoMode, house?.id ?? null);
                      if (ids.length) {
                        const pts = allocateEqual(10000, ids);
                        const o: Record<number, string> = {};
                        for (const id of ids) o[id] = ((pts.get(id) ?? 0) / 100).toFixed(2);
                        setPct(o);
                      }
                    }
                    if (next === "shares") {
                      setWeights((prev) => {
                        const filled = Object.values(prev).some((v) => Number(v) > 0);
                        if (filled) return prev;
                        const o: Record<number, string> = {};
                        for (const id of owedIdsWithGoko(checked, gokoMode, house?.id ?? null)) o[id] = "1";
                        return o;
                      });
                    }
                  }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="equal">Equally</option>
                    <option value="exact">Exact amounts</option>
                    <option value="percent">Percent</option>
                    <option value="shares">Shares</option>
                  </select>
                </div>
              </>
            )}
            {(method === "exact" || method === "percent" || method === "shares") && !gokoIsPayer && (
              <div className="space-y-1">
                {owedIdsWithGoko(checked, gokoMode, house?.id ?? null).map((id) => {
                  const m = allMembers.find((x) => x.id === id) || (house && house.id === id ? house : null);
                  if (!m) return null;
                  const val = method === "exact" ? exact : method === "percent" ? pct : weights;
                  const set = method === "exact" ? setExact : method === "percent" ? setPct : setWeights;
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span className="text-xs w-28 truncate">{memberLabel(m, allMembers)}</span>
                      <Input type="number" step={method === "shares" ? "1" : "0.01"} value={val[id] || ""} disabled={moneyLocked} onChange={(e) => set((p) => ({ ...p, [id]: e.target.value }))} />
                    </div>
                  );
                })}
              </div>
            )}
            {!gokoIsPayer && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={multiPay} disabled={moneyLocked} onChange={(e) => {
                  const on = e.target.checked;
                  setMultiPay(on);
                  if (on) {
                    setMore(true);
                    setPaidExtra((p) => {
                      if (Object.values(p).some((v) => rupeesToPaise(v) > 0)) return p;
                      return payerId && amount ? { [payerId]: amount } : p;
                    });
                  }
                }} />
                More than one person paid
              </label>
            )}
            <div>
              <Label className="text-xs">Add someone to this group</Label>
              <select defaultValue="" onChange={(e) => {
                const id = Number(e.target.value);
                e.currentTarget.value = "";
                if (!id) return;
                setExtraIds((ids) => ids.includes(id) ? ids : [...ids, id]);
                setChecked((c) => c.includes(id) ? c : [...c, id]);
              }} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Existing person…</option>
                {humans.filter((m) => !group.memberIds.includes(m.id) && !extraIds.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{memberLabel(m, allMembers)}</option>)}
              </select>
              {canManage && (
              <form className="flex gap-2 mt-2" onSubmit={async (e) => {
                e.preventDefault();
                if (!inlineName.trim()) return;
                try {
                  const data = await api("addMember", { name: inlineName.trim(), kind: "volunteer" });
                  const newbie: Member = { id: data.id, name: inlineName.trim(), phone: "", notes: "", kind: "volunteer", userId: null, employeeId: null, isHouse: 0, isActive: 1 };
                  setCreated((c) => [...c, newbie]);
                  setExtraIds((ids) => [...ids, data.id]);
                  setChecked((c) => [...c, data.id]);
                  setInlineName("");
                } catch (err) { onError(err instanceof Error ? err.message : "Failed"); }
              }}>
                <Input value={inlineName} onChange={(e) => setInlineName(e.target.value)} placeholder="New name" />
                <Button type="submit" variant="ghost" size="sm">Add</Button>
              </form>
              )}
            </div>
          </div>
        )}
        {multiPay && !gokoIsPayer && (
          <div className="space-y-1 border-t border-brand-mist pt-3">
            <p className="text-xs text-brand-green-dark/50">Who paid how much</p>
            {inGroup.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="text-xs w-28 truncate">{memberLabel(m, allMembers)}</span>
                <Input type="number" step="0.01" value={paidExtra[m.id] || ""} disabled={moneyLocked} onChange={(e) => setPaidExtra((p) => ({ ...p, [m.id]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}
        {gokoIsPayer && !moneyLocked && (
          <div className="space-y-2 border-t border-brand-mist pt-3">
            <p className="text-xs text-brand-green-dark/60">Hostel is paying — this books in Accounts now.</p>
            {reuseHostelId && <p className="text-xs text-amber-800">Retry will attach Accounts #{reuseHostelId} instead of booking again.</p>}
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </select>
            {paymentMethod === "online" && (
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Select account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}</option>)}
              </select>
            )}
            <select value={mainCategory} onChange={(e) => setMainCategory(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="stay_expense">Stay Expense</option>
              <option value="food_expense">Food Expense</option>
            </select>
            <select value={subCategory} onChange={(e) => setSubCategory(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              {GOKO_SUBS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">No vendor</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        )}
        {typeof preview === "string" && <p className="text-xs text-red-500">{preview}</p>}
        {Array.isArray(preview) && (
          <p className="text-xs text-brand-green-dark/70">
            {preview.filter((s) => s.owedAmount > 0).map((s) => {
              const m = allMembers.find((x) => x.id === s.memberId) || (house && house.id === s.memberId ? house : null);
              return `${m ? memberLabel(m, allMembers) : `#${s.memberId}`} ₹${paiseToRupees(s.owedAmount)}`;
            }).join(" · ")}
          </p>
        )}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="cta" disabled={saving || !amount.trim() || (!moneyLocked && typeof preview === "string") || !description.trim() || (gokoIsPayer && paymentMethod === "online" && !accountId)} onClick={async () => {
            setSaving(true);
            try {
              if (moneyLocked && editing) {
                await api("updateExpense", { id: editing.id, groupId: group.id, description: description.trim(), expenseDate: date, notes });
                onSaved(group.id);
                return;
              }
              const shares = buildShares();
              if (typeof shares === "string") { onError(shares); return; }
              const moneySame = editing && rupeesToPaise(amount) === editing.totalAmount && sharesMoneyEqual(shares, editing.shares || []);
              if (editing && moneySame) {
                await api("updateExpense", { id: editing.id, groupId: group.id, description: description.trim(), expenseDate: date, notes });
                onSaved(group.id);
                return;
              }
              const body: Record<string, unknown> = {
                groupId: group.id, description: description.trim(), totalAmount: rupeesToPaise(amount),
                expenseDate: date, splitMethod: gokoIsPayer || gokoMode === "covers_all" ? "exact" : method,
                notes, shares, addMemberIds: shares.map((s) => s.memberId),
              };
              if (!editing) body.idempotencyKey = idempotencyKey;
              if (gokoIsPayer) {
                Object.assign(body, {
                  paymentMethod, accountId: paymentMethod === "online" ? Number(accountId) : null,
                  mainCategory, subCategory, vendorId: vendorId ? Number(vendorId) : null, purpose: description.trim(),
                  ...(reuseHostelId ? { hostelExpenseId: reuseHostelId } : {}),
                });
              }
              if (editing) await api("updateExpense", { id: editing.id, ...body });
              else {
                await api("addExpense", body);
                setIdempotencyKey(crypto.randomUUID());
              }
              onSaved(group.id);
            } catch (err) {
              const hid = err && typeof err === "object" && "hostelExpenseId" in err ? Number((err as { hostelExpenseId?: number }).hostelExpenseId) : 0;
              if (hid) setReuseHostelId(hid);
              onError(err instanceof Error ? err.message : "Failed");
            }
            finally { setSaving(false); }
          }}>{saving ? "Saving…" : reuseHostelId ? "Retry with existing Accounts row" : "Save"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function GokoPayModal({ target, payee, members, canAccounts, api, onClose, onPaid, onError }: {
  target: GokoPay; payee: Member; members: Member[]; canAccounts: boolean;
  api: (action: string, extra?: Record<string, unknown>) => Promise<any>;
  onClose: () => void; onPaid: (warning?: string) => void; onError: (msg: string) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [subCategory, setSubCategory] = useState("Groceries");
  const [mainCategory, setMainCategory] = useState("food_expense");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(paiseToRupees(target.amount));
  const [reuseHostelId, setReuseHostelId] = useState<number | null>(null);
  useEffect(() => {
    api("listAccounts").then((d) => {
      setAccounts(d.accounts || []);
      const def = (d.accounts || []).find((a: Account) => a.isDefault === 1);
      if (def) setAccountId(String(def.id));
    }).catch(() => {});
  }, [api]);
  if (!canAccounts) return null;
  const paise = rupeesToPaise(amount);
  const onlineBlocked = paymentMethod === "online" && !accountId;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white dark:bg-card p-5 space-y-3">
        <h3 className="font-display font-bold">Pay via Accounts</h3>
        <p className="text-sm">Goko pays {memberLabel(payee, members)}</p>
        <p className="text-xs text-brand-green-dark/50">{target.description} · remaining ₹{paiseToRupees(target.amount)} · books today in Accounts</p>
        <div>
          <Label className="text-xs">Amount (₹)</Label>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
        </div>
        {reuseHostelId && <p className="text-xs text-amber-800">Will attach existing Accounts #{reuseHostelId} instead of booking again.</p>}
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="cash">Cash</option>
          <option value="online">Online</option>
        </select>
        {paymentMethod === "online" && (
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">Select account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}</option>)}
          </select>
        )}
        <select value={mainCategory} onChange={(e) => setMainCategory(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="stay_expense">Stay Expense</option>
          <option value="food_expense">Food Expense</option>
        </select>
        <select value={subCategory} onChange={(e) => setSubCategory(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          {GOKO_SUBS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex gap-2">
          <Button type="button" variant="cta" disabled={saving || onlineBlocked || !Number.isInteger(paise) || paise <= 0 || paise > target.amount} onClick={async () => {
            setSaving(true);
            try {
              await api("payGokoReimbursement", {
                toMemberId: target.payeeId, splitExpenseId: target.expenseId, amount: paise,
                paymentMethod, accountId: paymentMethod === "online" ? Number(accountId) : null,
                mainCategory, subCategory, purpose: target.description,
                ...(reuseHostelId ? { hostelExpenseId: reuseHostelId } : {}),
              });
              onPaid();
            } catch (err) {
              const hid = err && typeof err === "object" && "hostelExpenseId" in err ? Number((err as { hostelExpenseId?: number }).hostelExpenseId) : 0;
              if (hid) setReuseHostelId(hid);
              onError(err instanceof Error ? err.message : "Failed");
            }
            finally { setSaving(false); }
          }}>{saving ? "Saving…" : reuseHostelId ? "Retry with existing Accounts row" : "Confirm"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
