import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { actionAllowed, type ActionPerm } from "@/lib/actionPermissions";
import { isPiRuntime } from "@/lib/runtime";
import { addAuditEntry, addExpense, getAllUsers, getExpenseById, getUserById, getUserByUsername } from "@/db/queries";
import { getDb } from "@/db";
import { accounts, vendors } from "@/db/schema";
import { desc } from "drizzle-orm";
import { todayIST } from "@/lib/utils";
import {
  assertBalanced,
  assertGokoPayerRules,
  gokoAttributableRemaining,
  gokoPayButtons,
  netsFromEvents,
  overallNets,
  paiseToRupees,
  simplifyDebts,
  type ShareInput,
} from "@/lib/splits";
import {
  addMemberToGroup,
  addSplitGroup,
  addSplitMember,
  countLiveExpenses,
  countLiveHumanSettlements,
  countLiveSettlements,
  deleteSplitGroup,
  getAllGroupMemberships,
  getAllLiveExpenses,
  getAllLiveSettlements,
  getGroupMemberIds,
  getHouseMember,
  getReimbursementsForExpense,
  getSettlementByHostelExpenseId,
  getSettlementById,
  getSharesForExpenses,
  getSplitExpenseByHostelExpenseId,
  getSplitExpenseById,
  getSplitGroupById,
  getSplitGroups,
  getSplitMemberById,
  getSplitMembers,
  hardDeleteSplitExpense,
  insertShares,
  insertSplitExpense,
  insertSplitSettlement,
  loadGroupLedger,
  replaceShares,
  setGroupMembers,
  softDeleteSplitExpense,
  softDeleteSplitSettlement,
  toExpenseEvents,
  toSettlementEvents,
  updateSplitExpense,
  updateSplitGroup,
  updateSplitMember,
} from "@/db/splitQueries";

const ACTION_PERMISSIONS: Record<string, ActionPerm> = {
  listMembers: "canViewSplits",
  listGroups: "canViewSplits",
  listActivity: "canViewSplits",
  getBalances: "canViewSplits",
  listAccounts: "canViewSplits",
  addMember: "canManageSplits",
  updateMember: "canManageSplits",
  deactivateMember: "canManageSplits",
  addGroup: "canManageSplits",
  updateGroup: "canManageSplits",
  setGroupMembers: "canManageSplits",
  deleteGroup: "canManageSplits",
  listLoginUsers: "canManageSplits",
  addExpense: "canAddSplitExpense",
  updateExpense: "canEditSplitExpense",
  deleteExpense: "canDeleteSplitExpense",
  addSettlement: "canSettleSplits",
  deleteSettlement: "canSettleSplits",
  payGokoReimbursement: "canSettleSplits",
};

const MEMBER_KINDS = new Set(["staff", "volunteer", "other"]);
const SETTLE_METHODS = new Set(["cash", "upi", "other"]);
const SPLIT_METHODS = new Set(["equal", "exact", "percent", "shares"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function intIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => Number(x)).filter((n): n is number => Number.isInteger(n)))];
}

function isHouse(row: { isHouse: number } | null | undefined) {
  return row?.isHouse === 1;
}

function parseShares(raw: unknown): ShareInput[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "shares required";
  const shares: ShareInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return "invalid share";
    const s = item as Record<string, unknown>;
    const memberId = Number(s.memberId);
    const paidAmount = Number(s.paidAmount ?? 0);
    const owedAmount = Number(s.owedAmount ?? 0);
    if (!Number.isInteger(memberId) || memberId <= 0) return "invalid member";
    if (!Number.isInteger(paidAmount) || !Number.isInteger(owedAmount)) return "shares must be integers";
    shares.push({ memberId, paidAmount, owedAmount });
  }
  return shares;
}

function canUseAccounts(role: string, permissions: Record<string, boolean>) {
  return role === "admin" || Boolean(permissions.canAddExpense);
}

async function requireLoginUserId(raw: unknown): Promise<number | null | NextResponse> {
  if (raw == null || raw === "") return null;
  const userId = Number(raw);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: "Login user not found" }, { status: 400 });
  return userId;
}

async function memberNetsByGroup(memberId: number) {
  const groups = await getSplitGroups();
  const out: { groupId: number; net: number }[] = [];
  for (const g of groups) {
    const ledger = await loadGroupLedger(g.id);
    const nets = netsFromEvents(ledger.expenseEvents, ledger.settlementEvents);
    const net = nets.get(memberId) ?? 0;
    if (net !== 0) out.push({ groupId: g.id, net });
  }
  return out;
}

async function selfMemberId(username: string | undefined) {
  if (!username) return null;
  const user = await getUserByUsername(username);
  if (!user) return null;
  const members = await getSplitMembers();
  return members.find((m) => m.userId === user.id)?.id ?? null;
}

export async function POST(req: NextRequest) {
  try {
    if (isPiRuntime()) {
      return NextResponse.json({ error: "Splits is only available on the live site" }, { status: 403 });
    }

    const body = await req.json();
    const { password, username, action, ...params } = body;

    const auth = await authenticateUser(String(password || ""), username ? String(username) : undefined);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { role, displayName, permissions } = auth;
    const actorName = String(username || displayName);

    if (!action || typeof action !== "string") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (!(action in ACTION_PERMISSIONS)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    if (role !== "admin" && !permissions.canViewSplits) {
      return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    }

    const gate = actionAllowed(role, permissions, ACTION_PERMISSIONS[action]);
    if (gate === "admin_required") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    if (gate === "forbidden") {
      return NextResponse.json({ error: "You don't have permission to perform this action" }, { status: 403 });
    }

    switch (action) {
      case "listMembers": {
        const members = await getSplitMembers();
        return NextResponse.json({ members, selfMemberId: await selfMemberId(username) });
      }

      case "listLoginUsers": {
        const users = await getAllUsers();
        return NextResponse.json({
          users: users.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName })),
        });
      }

      case "listAccounts": {
        if (!canUseAccounts(role, permissions)) {
          return NextResponse.json({ error: "Listing hostel accounts needs Accounts add-expense permission" }, { status: 403 });
        }
        const db = getDb();
        const [accountRows, vendorRows] = await Promise.all([
          db.select({
            id: accounts.id,
            name: accounts.name,
            nickname: accounts.nickname,
            isDefault: accounts.isDefault,
            isActive: accounts.isActive,
          }).from(accounts).orderBy(desc(accounts.createdAt)),
          db.select({ id: vendors.id, name: vendors.name, category: vendors.category }).from(vendors).orderBy(desc(vendors.id)),
        ]);
        return NextResponse.json({
          accounts: accountRows.filter((a) => a.isActive === 1),
          vendors: vendorRows,
        });
      }

      case "addMember": {
        const name = String(params.name || "").trim();
        if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
        if (params.isHouse === 1 || params.isHouse === true) {
          return NextResponse.json({ error: "Cannot create a house member" }, { status: 400 });
        }
        const kind = String(params.kind || "staff");
        if (!MEMBER_KINDS.has(kind)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
        const userIdOrErr = await requireLoginUserId(params.userId);
        if (userIdOrErr instanceof NextResponse) return userIdOrErr;
        const employeeId = params.employeeId == null || params.employeeId === "" ? null : Number(params.employeeId);
        if (employeeId != null && !Number.isInteger(employeeId)) return NextResponse.json({ error: "Invalid employeeId" }, { status: 400 });
        try {
          const id = await addSplitMember({
            name,
            phone: String(params.phone || "").trim(),
            notes: String(params.notes || "").trim(),
            kind,
            userId: userIdOrErr,
            employeeId,
          });
          await addAuditEntry({ username: actorName, action: "split_member_added", target: name, details: `id=${id}` });
          return NextResponse.json({ ok: true, id });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/unique/i.test(msg)) return NextResponse.json({ error: "That login is already linked to a person" }, { status: 400 });
          throw err;
        }
      }

      case "updateMember": {
        const id = Number(params.id);
        if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
        const member = await getSplitMemberById(id);
        if (!member) return NextResponse.json({ error: "Member not found" }, { status: 400 });
        if (isHouse(member)) {
          if (params.name != null && String(params.name).trim() !== member.name) {
            return NextResponse.json({ error: "Cannot rename the house member" }, { status: 400 });
          }
          if (params.isHouse === 0 || params.isHouse === false) {
            return NextResponse.json({ error: "Cannot clear house member" }, { status: 400 });
          }
          if (params.isActive === 0 || params.isActive === false) {
            return NextResponse.json({ error: "Cannot deactivate the house member" }, { status: 400 });
          }
        }
        const patch: Parameters<typeof updateSplitMember>[1] = {};
        if (!isHouse(member) && params.name != null) {
          const name = String(params.name).trim();
          if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
          patch.name = name;
        }
        if (params.phone != null) patch.phone = String(params.phone).trim();
        if (params.notes != null) patch.notes = String(params.notes).trim();
        if (params.kind != null) {
          const kind = String(params.kind);
          if (!MEMBER_KINDS.has(kind)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
          if (isHouse(member)) return NextResponse.json({ error: "Cannot change house member kind" }, { status: 400 });
          patch.kind = kind;
        }
        if (params.userId !== undefined) {
          if (isHouse(member) && params.userId != null && params.userId !== "") {
            return NextResponse.json({ error: "Cannot link a login to the house member" }, { status: 400 });
          }
          const userIdOrErr = await requireLoginUserId(params.userId);
          if (userIdOrErr instanceof NextResponse) return userIdOrErr;
          patch.userId = userIdOrErr;
        }
        if (params.employeeId !== undefined) {
          patch.employeeId = params.employeeId == null || params.employeeId === "" ? null : Number(params.employeeId);
          if (patch.employeeId != null && !Number.isInteger(patch.employeeId)) return NextResponse.json({ error: "Invalid employeeId" }, { status: 400 });
        }
        try {
          await updateSplitMember(id, patch);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/unique/i.test(msg)) return NextResponse.json({ error: "That login is already linked to a person" }, { status: 400 });
          throw err;
        }
        await addAuditEntry({ username: actorName, action: "split_member_updated", target: member.name, details: `id=${id}` });
        return NextResponse.json({ ok: true });
      }

      case "deactivateMember": {
        const id = Number(params.id);
        if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
        const member = await getSplitMemberById(id);
        if (!member) return NextResponse.json({ error: "Member not found" }, { status: 400 });
        if (isHouse(member)) return NextResponse.json({ error: "Cannot deactivate the house member" }, { status: 400 });
        const nonzero = await memberNetsByGroup(id);
        if (nonzero.length) {
          const groups = await getSplitGroups();
          const names = nonzero.map((n) => groups.find((g) => g.id === n.groupId)?.name || `group #${n.groupId}`).join(", ");
          return NextResponse.json({ error: `Settle this person's balances in ${names} before deactivating`, nets: nonzero }, { status: 400 });
        }
        await updateSplitMember(id, { isActive: 0 });
        await addAuditEntry({ username: actorName, action: "split_member_deactivated", target: member.name, details: `id=${id}` });
        return NextResponse.json({ ok: true });
      }

      case "listGroups": {
        const [groups, memberships, members] = await Promise.all([
          getSplitGroups(),
          getAllGroupMemberships(),
          getSplitMembers(),
        ]);
        const membersById = new Map(members.map((m) => [m.id, m]));
        const grouped = groups.map((g) => {
          const ids = memberships.filter((r) => r.groupId === g.id).map((r) => r.memberId);
          return {
            ...g,
            memberIds: ids,
            humanCount: ids.filter((id) => {
              const m = membersById.get(id);
              return !!m && m.isHouse !== 1 && m.isActive === 1;
            }).length,
          };
        });
        return NextResponse.json({ groups: grouped });
      }

      case "addGroup": {
        const name = String(params.name || "").trim();
        if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
        const id = await addSplitGroup({ name, createdBy: actorName });
        const memberIds = intIds(params.memberIds);
        if (memberIds.length) {
          const house = await getHouseMember();
          const withoutForcedHouse = memberIds.filter((mid) => !house || mid !== house.id);
          if (withoutForcedHouse.length && id) await setGroupMembers(id, withoutForcedHouse);
        }
        await addAuditEntry({ username: actorName, action: "split_group_added", target: name, details: `id=${id}` });
        return NextResponse.json({ ok: true, id });
      }

      case "updateGroup": {
        const id = Number(params.id);
        if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
        const group = await getSplitGroupById(id);
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 400 });
        const name = String(params.name || "").trim();
        if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
        await updateSplitGroup(id, { name });
        await addAuditEntry({ username: actorName, action: "split_group_updated", target: name, details: `id=${id}` });
        return NextResponse.json({ ok: true });
      }

      case "setGroupMembers": {
        const id = Number(params.id);
        if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
        const group = await getSplitGroupById(id);
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 400 });
        if (!Array.isArray(params.memberIds)) return NextResponse.json({ error: "memberIds required" }, { status: 400 });
        const house = await getHouseMember();
        const nextIds = intIds(params.memberIds).filter((mid) => !house || mid !== house.id);
        const currentIds = await getGroupMemberIds(id);
        const removing = currentIds.filter((mid) => !nextIds.includes(mid) && (!house || mid !== house.id));
        if (removing.length) {
          const ledger = await loadGroupLedger(id);
          const nets = netsFromEvents(ledger.expenseEvents, ledger.settlementEvents);
          for (const mid of removing) {
            if ((nets.get(mid) ?? 0) !== 0) {
              return NextResponse.json({ error: "Settle this person in the group before removing them" }, { status: 400 });
            }
          }
        }
        await setGroupMembers(id, nextIds);
        return NextResponse.json({ ok: true });
      }

      case "deleteGroup": {
        const id = Number(params.id);
        if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
        const group = await getSplitGroupById(id);
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 400 });
        if (await countLiveExpenses(id)) {
          return NextResponse.json({ error: "Delete or settle expenses before deleting this group" }, { status: 400 });
        }
        if (await countLiveSettlements(id)) {
          return NextResponse.json({ error: "Undo settlements before deleting this group" }, { status: 400 });
        }
        await deleteSplitGroup(id);
        await addAuditEntry({ username: actorName, action: "split_group_deleted", target: group.name, details: `id=${id}` });
        return NextResponse.json({ ok: true });
      }

      case "listActivity": {
        const groupId = Number(params.groupId);
        if (!Number.isInteger(groupId)) return NextResponse.json({ error: "groupId required" }, { status: 400 });
        const includeDeleted = Boolean(params.showDeleted);
        const ledger = await loadGroupLedger(groupId);
        const expenses = includeDeleted ? ledger.expenses : ledger.expenses.filter((e) => !e.deletedAt);
        const settlements = includeDeleted ? ledger.settlements : ledger.settlements.filter((s) => !s.deletedAt);
        const reimbursedIds = new Set(
          ledger.settlements
            .filter((s) => !s.deletedAt && s.splitExpenseId != null && s.hostelExpenseId != null)
            .map((s) => s.splitExpenseId as number),
        );
        const shareByExpense = new Map<number, ShareInput[]>();
        for (const s of ledger.shares) {
          const list = shareByExpense.get(s.expenseId) ?? [];
          list.push({ memberId: s.memberId, paidAmount: s.paidAmount, owedAmount: s.owedAmount });
          shareByExpense.set(s.expenseId, list);
        }
        const items = [
          ...expenses.map((e) => ({ kind: "expense" as const, createdAt: e.createdAt, id: e.id, expense: { ...e, shares: shareByExpense.get(e.id) ?? [], reimbursed: reimbursedIds.has(e.id) } })),
          ...settlements.map((s) => ({ kind: "settlement" as const, createdAt: s.createdAt, id: s.id, settlement: s })),
        ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id));
        return NextResponse.json({ items });
      }

      case "getBalances": {
        const groupId = Number(params.groupId);
        if (!Number.isInteger(groupId)) return NextResponse.json({ error: "groupId required" }, { status: 400 });
        const house = await getHouseMember();
        const ledger = await loadGroupLedger(groupId);
        const nets = netsFromEvents(ledger.expenseEvents, ledger.settlementEvents);
        const simplify = simplifyDebts(nets);
        const currentIds = await getGroupMemberIds(groupId);
        const displayIds = new Set(currentIds);
        for (const [id, net] of nets) {
          if (net !== 0) displayIds.add(id);
        }
        const allExpenses = await getAllLiveExpenses();
        const [allShares, allSettlements] = await Promise.all([
          getSharesForExpenses(allExpenses.map((e) => e.id)),
          getAllLiveSettlements(),
        ]);
        const liveExpenseIds = new Set(allExpenses.map((e) => e.id));
        const overall = overallNets(
          (() => {
            const byGroup = new Map<number, typeof allExpenses>();
            for (const e of allExpenses) {
              const list = byGroup.get(e.groupId) ?? [];
              list.push(e);
              byGroup.set(e.groupId, list);
            }
            const settleByGroup = new Map<number, typeof allSettlements>();
            for (const s of allSettlements) {
              const list = settleByGroup.get(s.groupId) ?? [];
              list.push(s);
              settleByGroup.set(s.groupId, list);
            }
            const maps = [];
            const groupIds = new Set([...byGroup.keys(), ...settleByGroup.keys()]);
            for (const gid of groupIds) {
              const ex = byGroup.get(gid) ?? [];
              const st = settleByGroup.get(gid) ?? [];
              maps.push(netsFromEvents(toExpenseEvents(ex, allShares.filter((s) => liveExpenseIds.has(s.expenseId))), toSettlementEvents(st)));
            }
            return maps;
          })(),
        );
        const payButtons = house
          ? gokoPayButtons(house.id, ledger.expenseEvents, ledger.settlementEvents).map((b) => {
              const exp = ledger.expenses.find((e) => e.id === b.expenseId);
              return { ...b, description: exp?.description || "" };
            })
          : [];
        return NextResponse.json({
          groupId,
          nets: [...displayIds].map((memberId) => ({ memberId, net: nets.get(memberId) ?? 0 })),
          simplify,
          overallNets: [...overall.entries()].map(([memberId, net]) => ({ memberId, net })),
          gokoPayButtons: payButtons,
          selfMemberId: await selfMemberId(username),
        });
      }

      case "addExpense": {
        const groupId = Number(params.groupId);
        if (!Number.isInteger(groupId)) return NextResponse.json({ error: "groupId required" }, { status: 400 });
        const group = await getSplitGroupById(groupId);
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 400 });
        const description = String(params.description || "").trim();
        if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
        const totalAmount = Number(params.totalAmount);
        const expenseDate = String(params.expenseDate || "");
        if (!DATE_RE.test(expenseDate)) return NextResponse.json({ error: "expenseDate must be YYYY-MM-DD" }, { status: 400 });
        const splitMethod = String(params.splitMethod || "equal");
        if (!SPLIT_METHODS.has(splitMethod)) return NextResponse.json({ error: "Invalid split method" }, { status: 400 });
        const shares = parseShares(params.shares);
        if (typeof shares === "string") return NextResponse.json({ error: shares }, { status: 400 });
        const balanced = assertBalanced(totalAmount, shares);
        if (balanced) return NextResponse.json({ error: balanced }, { status: 400 });

        const house = await getHouseMember();
        const gokoRule = assertGokoPayerRules(house?.id, shares, totalAmount);
        if (gokoRule) return NextResponse.json({ error: gokoRule }, { status: 400 });
        const members = await getSplitMembers();
        const byId = new Map(members.map((m) => [m.id, m]));
        for (const s of shares) {
          const m = byId.get(s.memberId);
          if (!m) return NextResponse.json({ error: "Unknown member on expense" }, { status: 400 });
          if (m.isActive !== 1) return NextResponse.json({ error: `${m.name} is inactive` }, { status: 400 });
        }

        const gokoShare = house ? shares.find((s) => s.memberId === house.id) : undefined;
        const gokoPaid = gokoShare?.paidAmount ?? 0;
        const gokoIsPayer = gokoPaid > 0;

        if (gokoIsPayer) {
          if (!canUseAccounts(role, permissions)) {
            return NextResponse.json({ error: "Adding a hostel-paid expense also needs Accounts permission" }, { status: 403 });
          }
        } else if (shares.every((s) => s.paidAmount === s.owedAmount)) {
          return NextResponse.json({ error: "Nothing to split" }, { status: 400 });
        }

        const humans = shares.filter((s) => !house || s.memberId !== house.id);
        if (humans.length === 0 && !gokoIsPayer) {
          return NextResponse.json({ error: "Need at least one person" }, { status: 400 });
        }

        if (Array.isArray(params.addMemberIds)) {
          for (const raw of params.addMemberIds) {
            const mid = Number(raw);
            if (!Number.isInteger(mid)) continue;
            const m = byId.get(mid);
            if (!m || m.isActive !== 1) return NextResponse.json({ error: "Cannot add an inactive member to the group" }, { status: 400 });
          }
        }

        let hostelExpenseId: number | null = null;
        if (gokoIsPayer) {
          const posted = await reuseOrPostHostelExpense(params, totalAmount, description, actorName);
          if ("error" in posted) return posted.error;
          hostelExpenseId = posted.id;
        }

        const expenseId = await insertSplitExpense({
          groupId,
          description,
          totalAmount,
          expenseDate,
          splitMethod,
          notes: String(params.notes || ""),
          createdBy: actorName,
          hostelExpenseId,
        });
        if (!expenseId) {
          const extra = hostelExpenseId ? ` Accounts entry #${hostelExpenseId} was saved; Splits row is missing.` : "";
          return NextResponse.json({ error: "Failed to save split expense." + extra, hostelExpenseId }, { status: 500 });
        }
        try {
          await insertShares(expenseId, shares);
        } catch (err) {
          try {
            await hardDeleteSplitExpense(expenseId);
          } catch (cleanupErr) {
            console.error("split expense cleanup failed", cleanupErr);
            try { await updateSplitExpense(expenseId, { hostelExpenseId: null }); } catch { /* reuse can still attach Accounts */ }
          }
          const extra = hostelExpenseId ? ` Accounts entry #${hostelExpenseId} was saved; Splits row is missing.` : "";
          console.error("split shares insert failed", err);
          return NextResponse.json({ error: "Failed to save shares." + extra, ...(hostelExpenseId ? { hostelExpenseId } : {}) }, { status: 500 });
        }
        try {
          if (Array.isArray(params.addMemberIds)) {
            for (const raw of params.addMemberIds) {
              const mid = Number(raw);
              if (!Number.isInteger(mid) || (house && mid === house.id)) continue;
              await addMemberToGroup(groupId, mid);
            }
          }
          for (const s of shares) {
            if (house && s.memberId === house.id) continue;
            await addMemberToGroup(groupId, s.memberId);
          }
          await addAuditEntry({
            username: actorName,
            action: "split_expense_added",
            target: description,
            details: `id=${expenseId} ₹${paiseToRupees(totalAmount)}${hostelExpenseId ? ` hostelExpenseId=${hostelExpenseId}` : ""}`,
          });
        } catch (err) {
          console.error("split expense post-save bookkeeping failed", err);
        }
        return NextResponse.json({ ok: true, id: expenseId, hostelExpenseId });
      }

      case "updateExpense": {
        const id = Number(params.id);
        if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
        const existing = await getSplitExpenseById(id);
        if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 400 });
        if (existing.deletedAt) return NextResponse.json({ error: "Cannot edit a deleted expense" }, { status: 400 });
        if (params.groupId != null && Number(params.groupId) !== existing.groupId) {
          return NextResponse.json({ error: "Cannot move an expense to another group" }, { status: 400 });
        }

        const description = params.description != null ? String(params.description).trim() : existing.description;
        if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
        const expenseDate = params.expenseDate != null ? String(params.expenseDate) : existing.expenseDate;
        if (!DATE_RE.test(expenseDate)) return NextResponse.json({ error: "expenseDate must be YYYY-MM-DD" }, { status: 400 });
        const notes = params.notes != null ? String(params.notes) : existing.notes;
        const moneyTouched = params.totalAmount != null || params.shares != null || params.splitMethod != null;

        const reimbursements = await getReimbursementsForExpense(id);
        if (moneyTouched && (reimbursements.length || existing.hostelExpenseId)) {
          return NextResponse.json({ error: "Money fields are locked after a Goko / Accounts booking — description, notes, and date only" }, { status: 400 });
        }
        if (moneyTouched && await countLiveHumanSettlements(existing.groupId)) {
          return NextResponse.json({ error: "Undo settlements in this group before changing money" }, { status: 400 });
        }

        if (!moneyTouched) {
          await updateSplitExpense(id, { description, expenseDate, notes });
          await addAuditEntry({ username: actorName, action: "split_expense_updated", target: description, details: `id=${id} description-only` });
          return NextResponse.json({ ok: true });
        }

        const totalAmount = params.totalAmount != null ? Number(params.totalAmount) : existing.totalAmount;
        const splitMethod = params.splitMethod != null ? String(params.splitMethod) : existing.splitMethod;
        if (!SPLIT_METHODS.has(splitMethod)) return NextResponse.json({ error: "Invalid split method" }, { status: 400 });
        const shares = params.shares != null ? parseShares(params.shares) : (await getSharesForExpenses([id])).map((s) => ({
          memberId: s.memberId, paidAmount: s.paidAmount, owedAmount: s.owedAmount,
        }));
        if (typeof shares === "string") return NextResponse.json({ error: shares }, { status: 400 });
        const balanced = assertBalanced(totalAmount, shares);
        if (balanced) return NextResponse.json({ error: balanced }, { status: 400 });

        const house = await getHouseMember();
        const gokoRule = assertGokoPayerRules(house?.id, shares, totalAmount);
        if (gokoRule) return NextResponse.json({ error: gokoRule }, { status: 400 });
        const members = await getSplitMembers();
        const byId = new Map(members.map((m) => [m.id, m]));
        for (const s of shares) {
          const m = byId.get(s.memberId);
          if (!m) return NextResponse.json({ error: "Unknown member on expense" }, { status: 400 });
          if (m.isActive !== 1) return NextResponse.json({ error: `${m.name} is inactive` }, { status: 400 });
        }
        const gokoShare = house ? shares.find((s) => s.memberId === house.id) : undefined;
        const booked = reimbursements.reduce((n, r) => n + r.amount, 0);
        if ((gokoShare?.owedAmount ?? 0) < booked) {
          return NextResponse.json({ error: "Goko's share cannot drop below already booked reimbursements" }, { status: 400 });
        }
        const gokoPaid = gokoShare?.paidAmount ?? 0;
        if (gokoPaid > 0) {
          if (!canUseAccounts(role, permissions)) {
            return NextResponse.json({ error: "Adding a hostel-paid expense also needs Accounts permission" }, { status: 403 });
          }
        }
        if (gokoPaid === 0 && shares.every((s) => s.paidAmount === s.owedAmount)) {
          return NextResponse.json({ error: "Nothing to split" }, { status: 400 });
        }

        let hostelExpenseId = existing.hostelExpenseId ?? null;
        if (gokoPaid > 0 && !hostelExpenseId) {
          const posted = await reuseOrPostHostelExpense(params, totalAmount, description, actorName);
          if ("error" in posted) return posted.error;
          hostelExpenseId = posted.id;
        }

        const prevMoney = {
          description: existing.description,
          totalAmount: existing.totalAmount,
          expenseDate: existing.expenseDate,
          splitMethod: existing.splitMethod,
          notes: existing.notes,
          hostelExpenseId: existing.hostelExpenseId ?? null,
        };
        const newlyPosted = Boolean(hostelExpenseId && hostelExpenseId !== (existing.hostelExpenseId ?? null));
        try {
          await updateSplitExpense(id, { description, totalAmount, expenseDate, splitMethod, notes, hostelExpenseId });
          await replaceShares(id, shares);
        } catch (err) {
          try {
            await updateSplitExpense(id, prevMoney);
          } catch (restoreErr) {
            console.error("split expense header restore failed", restoreErr);
          }
          const extra = newlyPosted ? ` Accounts entry #${hostelExpenseId} was saved; Splits update is missing.` : "";
          console.error("split shares replace failed", err);
          return NextResponse.json({ error: "Failed to save shares." + extra, ...(newlyPosted ? { hostelExpenseId } : {}) }, { status: 500 });
        }
        for (const s of shares) {
          if (house && s.memberId === house.id) continue;
          await addMemberToGroup(existing.groupId, s.memberId);
        }
        await addAuditEntry({ username: actorName, action: "split_expense_updated", target: description, details: `id=${id}` });
        return NextResponse.json({ ok: true });
      }

      case "deleteExpense": {
        const id = Number(params.id);
        if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
        const existing = await getSplitExpenseById(id);
        if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 400 });
        if (existing.deletedAt) return NextResponse.json({ error: "Already deleted" }, { status: 400 });
        const reimbursements = await getReimbursementsForExpense(id);
        if (reimbursements.length) {
          return NextResponse.json({ error: "Cannot delete an expense after Goko reimbursed it via Accounts" }, { status: 400 });
        }
        if (await countLiveHumanSettlements(existing.groupId)) {
          return NextResponse.json({ error: "Undo settlements in this group before hiding an expense" }, { status: 400 });
        }
        await softDeleteSplitExpense(id);
        const warning = existing.hostelExpenseId
          ? `Accounts entry #${existing.hostelExpenseId} is unchanged.`
          : undefined;
        await addAuditEntry({ username: actorName, action: "split_expense_deleted", target: existing.description, details: `id=${id}` });
        return NextResponse.json({ ok: true, warning });
      }

      case "addSettlement": {
        const groupId = Number(params.groupId);
        const fromMemberId = Number(params.fromMemberId);
        const toMemberId = Number(params.toMemberId);
        const amount = Number(params.amount);
        if (!Number.isInteger(groupId) || !Number.isInteger(fromMemberId) || !Number.isInteger(toMemberId)) {
          return NextResponse.json({ error: "groupId, fromMemberId, and toMemberId required" }, { status: 400 });
        }
        if (!Number.isInteger(amount) || amount <= 0) return NextResponse.json({ error: "amount must be a positive integer" }, { status: 400 });
        if (fromMemberId === toMemberId) return NextResponse.json({ error: "Cannot settle with yourself" }, { status: 400 });
        const [from, to, group] = await Promise.all([
          getSplitMemberById(fromMemberId),
          getSplitMemberById(toMemberId),
          getSplitGroupById(groupId),
        ]);
        if (!from || !to || !group) return NextResponse.json({ error: "Member or group not found" }, { status: 400 });
        if (isHouse(from)) return NextResponse.json({ error: "Goko payments must use Pay via Accounts" }, { status: 400 });
        if (isHouse(to)) return NextResponse.json({ error: "Goko payments must use Pay via Accounts" }, { status: 400 });
        const method = String(params.method || "other");
        if (!SETTLE_METHODS.has(method)) return NextResponse.json({ error: "Invalid method" }, { status: 400 });

        const ledger = await loadGroupLedger(groupId);
        const nets = netsFromEvents(ledger.expenseEvents, ledger.settlementEvents);
        const suggestions = simplifyDebts(nets);
        const edge = suggestions.find((s) => s.from === fromMemberId && s.to === toMemberId);
        const markSettled = Boolean(params.markSettled);
        const confirmOverpay = Boolean(params.confirmOverpay);
        if (!edge) {
          return NextResponse.json({ error: "No suggested settlement in that direction — already settled?" }, { status: 400 });
        }
        if (markSettled && amount !== edge.amount) {
          return NextResponse.json({ error: "Mark settled must use the suggested amount" }, { status: 400 });
        }
        if (amount > edge.amount && !confirmOverpay) {
          return NextResponse.json({ error: "This is more than they owe; confirm overpay to reverse the debt" }, { status: 400 });
        }

        const settlementId = await insertSplitSettlement({
          groupId,
          fromMemberId,
          toMemberId,
          amount,
          method,
          notes: String(params.notes || ""),
          createdBy: actorName,
        });
        if (!settlementId) return NextResponse.json({ error: "Failed to save settlement" }, { status: 500 });
        try {
          await addAuditEntry({
            username: actorName,
            action: "split_settlement_added",
            target: `${from.name} → ${to.name}`,
            details: `id=${settlementId} ₹${paiseToRupees(amount)} in ${group.name}`,
          });
        } catch (err) {
          console.error("split settlement audit failed", err);
        }
        return NextResponse.json({ ok: true, id: settlementId });
      }

      case "deleteSettlement": {
        const id = Number(params.id);
        if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
        const existing = await getSettlementById(id);
        if (!existing) return NextResponse.json({ error: "Settlement not found" }, { status: 400 });
        if (existing.deletedAt) return NextResponse.json({ error: "Already deleted" }, { status: 400 });
        if (existing.hostelExpenseId) {
          return NextResponse.json({ error: "Cannot delete an Accounts-linked settlement" }, { status: 400 });
        }
        await softDeleteSplitSettlement(id);
        await addAuditEntry({
          username: actorName,
          action: "split_settlement_deleted",
          target: `${existing.fromMemberId} → ${existing.toMemberId}`,
          details: `id=${id}`,
        });
        return NextResponse.json({ ok: true });
      }

      case "payGokoReimbursement": {
        if (!canUseAccounts(role, permissions)) {
          return NextResponse.json({ error: "Pay via Accounts also needs Accounts add-expense permission" }, { status: 403 });
        }
        const toMemberId = Number(params.toMemberId);
        const splitExpenseId = Number(params.splitExpenseId);
        const amount = Number(params.amount);
        if (!Number.isInteger(toMemberId) || !Number.isInteger(splitExpenseId)) {
          return NextResponse.json({ error: "toMemberId and splitExpenseId required" }, { status: 400 });
        }
        if (!Number.isInteger(amount) || amount <= 0) return NextResponse.json({ error: "amount must be a positive integer" }, { status: 400 });
        const house = await getHouseMember();
        if (!house) return NextResponse.json({ error: "House member missing" }, { status: 400 });
        const expense = await getSplitExpenseById(splitExpenseId);
        if (!expense || expense.deletedAt) return NextResponse.json({ error: "Expense not found" }, { status: 400 });
        const payee = await getSplitMemberById(toMemberId);
        if (!payee) return NextResponse.json({ error: "Payee not found" }, { status: 400 });
        if (isHouse(payee)) return NextResponse.json({ error: "Cannot reimburse the house member" }, { status: 400 });

        const ledger = await loadGroupLedger(expense.groupId);
        const remaining = gokoAttributableRemaining(house.id, ledger.expenseEvents, ledger.settlementEvents, toMemberId, splitExpenseId);
        if (amount > remaining) {
          return NextResponse.json({ error: `Amount exceeds remaining Goko slice (₹${paiseToRupees(remaining)})` }, { status: 400 });
        }

        const subCategory = String(params.subCategory || "").trim();
        if (!subCategory) return NextResponse.json({ error: "Category is required" }, { status: 400 });
        if (subCategory === "Salary") return NextResponse.json({ error: "Reimbursements cannot be Salary" }, { status: 400 });

        const posted = await reuseOrPostHostelExpense(params, amount, String(params.purpose || expense.description), actorName);
        if ("error" in posted) return posted.error;

        try {
          const settlementId = await insertSplitSettlement({
            groupId: expense.groupId,
            fromMemberId: house.id,
            toMemberId,
            amount,
            method: String(params.paymentMethod || "other") === "online" ? "upi" : "cash",
            notes: `Pay via Accounts #${posted.id}`,
            createdBy: actorName,
            hostelExpenseId: posted.id,
            splitExpenseId,
          });
          if (!settlementId) {
            return NextResponse.json({
              error: `Accounts entry #${posted.id} was saved; Splits settlement is missing.`,
              hostelExpenseId: posted.id,
            }, { status: 500 });
          }
          try {
            await addAuditEntry({
              username: actorName,
              action: "split_goko_reimbursed",
              target: payee.name,
              details: `settlement=${settlementId} expense=${splitExpenseId} hostelExpenseId=${posted.id} ₹${paiseToRupees(amount)}`,
            });
          } catch (err) {
            console.error("split reimbursement audit failed", err);
          }
          return NextResponse.json({ ok: true, id: settlementId, hostelExpenseId: posted.id });
        } catch (err) {
          console.error("split reimbursement settlement failed", err);
          return NextResponse.json({
            error: `Accounts entry #${posted.id} was saved; Splits settlement is missing.`,
            hostelExpenseId: posted.id,
          }, { status: 500 });
        }
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Splits API error:", message);
    if (/no such table/i.test(message)) {
      return NextResponse.json({ error: "Splits tables missing — apply migration 0041" }, { status: 503 });
    }
    return NextResponse.json({ error: message.includes("D1_ERROR") || message.includes("Failed query") ? "Database temporarily unavailable. Please try again." : "Internal server error" }, { status: 500 });
  }
}

async function reuseOrPostHostelExpense(
  params: Record<string, unknown>,
  amount: number,
  purpose: string,
  actorName: string,
): Promise<{ id: number } | { error: NextResponse }> {
  const reuseId = Number(params.hostelExpenseId);
  if (Number.isInteger(reuseId) && reuseId > 0) {
    const row = await getExpenseById(reuseId);
    if (!row || row.deletedAt) {
      return { error: NextResponse.json({ error: "Accounts entry not found — do not retry with that id" }, { status: 400 }) };
    }
    if (row.createdBy !== actorName) {
      return { error: NextResponse.json({ error: "Accounts entry belongs to a different save" }, { status: 400 }) };
    }
    if (row.amount !== amount) {
      return { error: NextResponse.json({ error: `Accounts #${reuseId} amount does not match` }, { status: 400 }) };
    }
    if (await getSplitExpenseByHostelExpenseId(reuseId)) {
      return { error: NextResponse.json({ error: `Accounts #${reuseId} is already linked to a split expense` }, { status: 400 }) };
    }
    if (await getSettlementByHostelExpenseId(reuseId)) {
      return { error: NextResponse.json({ error: `Accounts #${reuseId} is already linked to a settlement` }, { status: 400 }) };
    }
    return { id: reuseId };
  }
  return postHostelExpense(params, amount, purpose, actorName);
}

async function postHostelExpense(
  params: Record<string, unknown>,
  amount: number,
  purpose: string,
  actorName: string,
): Promise<{ id: number } | { error: NextResponse }> {
  const paymentMethod = String(params.paymentMethod || "cash") === "online" ? "online" : "cash";
  const accountIdRaw = paymentMethod === "online" ? Number(params.accountId) : null;
  if (paymentMethod === "online") {
    if (!Number.isInteger(accountIdRaw) || !accountIdRaw) {
      return { error: NextResponse.json({ error: "Account is required for online payment" }, { status: 400 }) };
    }
  }
  const subCategory = String(params.subCategory || "").trim();
  if (!subCategory) return { error: NextResponse.json({ error: "Category is required" }, { status: 400 }) };
  if (subCategory === "Salary") return { error: NextResponse.json({ error: "Reimbursements cannot be Salary" }, { status: 400 }) };
  const mainCategory = String(params.mainCategory || "stay_expense");
  const expenseDate = String(params.expenseDate || todayIST());
  const vendorId = params.vendorId == null || params.vendorId === "" ? null : Number(params.vendorId);
  const category = subCategory === "Others" ? String(params.customCategory || purpose).trim() || purpose : subCategory;
  const id = await addExpense({
    amount,
    category,
    customCategory: subCategory === "Others" ? String(params.customCategory || "") : "",
    purpose: purpose || category,
    billImageLink: "",
    createdBy: actorName,
    expenseDate,
    createdMonth: expenseDate.slice(0, 7),
    vendorId,
    accountId: paymentMethod === "cash" ? null : accountIdRaw,
    paymentMethod,
    mainCategory,
    subCategory,
  });
  if (!id) return { error: NextResponse.json({ error: "Failed to save Accounts expense" }, { status: 500 }) };
  return { id };
}
