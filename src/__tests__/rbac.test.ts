import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { actionAllowed, type ActionPerm } from "@/lib/actionPermissions";
import { CHECKIN_LOOKUP_DATA_KEYS, checkinLookupData } from "@/lib/checkinLookup";
import { buildFoodLookupGuests } from "@/lib/foodLookup";
import { normalizePhone } from "@/lib/phoneUtils";
import { shouldPollOrderStatus, stepperIndex, STATUS_STEPS } from "@/lib/orderStatus";
import { ALL_PERMISSION_KEYS } from "@/lib/permissionCatalog";

type UserRole = "admin" | "manager" | "staff";

const CHECKINS_PERMISSIONS: Record<string, ActionPerm> = {
  list: "canViewRecords", add: "canAddCheckin", addPast: "admin_only",
  update: "canEditRecords", delete: "canDeleteRecords",
  verifyCheckin: "canViewRecords", getFormCData: "canViewRecords",
  reExtractFormC: "admin_only", updateFormCData: "admin_only",
  getDashboard: "canViewDashboard", markVibeMatched: "canViewDashboard",
  checkoutBed: ["canCheckout", "canViewDashboard"], checkoutGuest: ["canCheckout", "canViewDashboard"], undoCheckout: ["canCheckout", "canViewDashboard"],
  getPendingFoodTab: ["canCheckout", "canViewDashboard"],
  getBeds: ["canViewBeds", "canViewTimeline"], assignBed: ["canAssignBed", "canViewBeds"], unassignBed: ["canAssignBed", "canViewBeds"],
  changeBed: ["canAssignBed", "canViewBeds"], markClean: "canMarkClean",
  getBedHistory: "canViewBeds", deleteBedHistory: "admin_only",
  initDorms: "admin_only", removeDorm: "admin_only", removeBed: "admin_only",
  getSetting: "admin_only", setSetting: "admin_only", getStats: "admin_only", healthCheck: "admin_only",
  getBookings: "canViewBookings", getUpcomingBookings: "canViewBookings",
  addBooking: "canAddBooking", updateBookingStatus: "canViewBookings", deleteBooking: "canDeleteBooking",
  getUsers: "admin_only", createUser: "admin_only", updateUser: "admin_only", deleteUser: "admin_only",
  getAuditLog: "admin_only", getSystemLogs: "admin_only", runBackup: "admin_only",
  getLatestRateScrape: "admin_only", getRateScrapeStatus: "admin_only",
  startRateScrape: "admin_only", updateRateScrapeResults: "admin_only",
  backfillManagerPermissions: "admin_only",
};

const FOOD_ORDERS_PERMISSIONS: Record<string, ActionPerm> = {
  listOrders: "canViewFoodOrders", getOrderDetails: "canViewFoodOrders",
  getOrderModifications: "canViewFoodOrders", getActiveGuests: "canViewFoodOrders",
  getGuestsWithTabs: "canViewFoodOrders", getGuestTab: "canViewFoodOrders",
  getGuestAllOrders: "canViewFoodOrders", getWalkinOrders: "canViewFoodOrders",
  getCombinedBill: "canViewFoodOrders", getMenu: "canViewFoodOrders",
  updateOrderStatus: ["canPlaceOrders", "canViewFoodOrders"], placeOrderForGuest: ["canPlaceOrders", "canViewFoodOrders"],
  voidItem: ["canPlaceOrders", "canViewFoodOrders"], updateItemQuantity: ["canPlaceOrders", "canViewFoodOrders"],
  reassignOrder: ["canPlaceOrders", "canViewFoodOrders"],
  markOrderPaid: "canMarkPaid", updatePaymentDetails: "canMarkPaid",
  applyDiscount: "canMarkPaid", removeDiscount: "canMarkPaid",
  cleanupOldOrders: "admin_only",
};

const EXPENSES_PERMISSIONS: Record<string, ActionPerm> = {
  listExpenses: "canViewExpenses", getMyExpenses: "canViewExpenses",
  addExpense: "canAddExpense", updateExpense: "canEditExpense", deleteExpense: "canDeleteExpense",
  getFoodRevenue: "canViewFoodBills",
  getRoomRevenue: "canViewFoodBills",
  getDailyLedger: "canViewAccounts", listIncomeRecords: "canViewAccounts", getReconciliation: "canViewAccounts",
  getIncomeAccounts: "canAddIncome", addDailyIncome: "canAddIncome", deleteDailyIncome: "canDeleteExpense",
  saveReconciliation: "canManageAccounts", undoReconciliation: "canManageAccounts",
  adjustOpeningBalance: "canManageAccounts",
};

const BOOKINGS_PERMISSIONS: Record<string, ActionPerm> = {
  checkIn: ["canCheckIn", "canAddBooking"],
  collectStayPayment: ["canCheckIn", "canAddBooking"],
  checkOut: ["canCheckOut", "canAddBooking"],
  getPendingFoodTab: ["canCheckOut", "canAddBooking"],
  createBooking: "canAddBooking",
};

const SPLITS_PERMISSIONS: Record<string, ActionPerm> = {
  listMembers: "canViewSplits", listGroups: "canViewSplits", listActivity: "canViewSplits",
  getBalances: "canViewSplits", listAccounts: "canViewSplits",
  addMember: "canManageSplits", updateMember: "canManageSplits", deactivateMember: "canManageSplits",
  addGroup: "canManageSplits", updateGroup: "canManageSplits", setGroupMembers: "canManageSplits",
  deleteGroup: "canManageSplits", listLoginUsers: "canManageSplits",
  addExpense: "canAddSplitExpense", updateExpense: "canEditSplitExpense", deleteExpense: "canDeleteSplitExpense",
  addSettlement: "canSettleSplits", deleteSettlement: "canSettleSplits", payGokoReimbursement: "canSettleSplits",
};

const MENU_PERMISSIONS: Record<string, ActionPerm> = {
  getCategories: "canViewMenu", getMenuItems: "canViewMenu", getMenuItemsByCategory: "canViewMenu",
  addCategory: "canManageMenuCategories", updateCategory: "canManageMenuCategories", toggleCategoryAvailability: "canToggleMenuAvailability", deleteCategory: "canManageMenuCategories",
  addMenuItem: "canManageMenuItems", updateMenuItem: "canManageMenuItems", deleteMenuItem: "canManageMenuItems",
  toggleItemAvailability: "canToggleMenuAvailability", bulkToggleAvailability: "canToggleMenuAvailability",
  addStock: "canManageInventory", getLowStockItems: "canManageInventory",
  getFoodSettings: "canManageFoodSettings", updateFoodSettings: "canManageFoodSettings",
};

function checkPermission(
  role: UserRole,
  permissions: Record<string, boolean>,
  actionPermissions: Record<string, ActionPerm>,
  action: string
) {
  return actionAllowed(role, permissions, actionPermissions[action]);
}

describe("RBAC: Admin always has access", () => {
  const role: UserRole = "admin";
  const permissions = {};

  it("admin can access all checkins actions", () => {
    for (const action of Object.keys(CHECKINS_PERMISSIONS)) {
      expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, action)).toBe("allowed");
    }
  });

  it("admin can access all food-orders actions", () => {
    for (const action of Object.keys(FOOD_ORDERS_PERMISSIONS)) {
      expect(checkPermission(role, permissions, FOOD_ORDERS_PERMISSIONS, action)).toBe("allowed");
    }
  });

  it("admin can access all expenses actions", () => {
    for (const action of Object.keys(EXPENSES_PERMISSIONS)) {
      expect(checkPermission(role, permissions, EXPENSES_PERMISSIONS, action)).toBe("allowed");
    }
  });

  it("admin can access all splits actions", () => {
    for (const action of Object.keys(SPLITS_PERMISSIONS)) {
      expect(checkPermission(role, permissions, SPLITS_PERMISSIONS, action)).toBe("allowed");
    }
  });

  it("admin can access all menu actions", () => {
    for (const action of Object.keys(MENU_PERMISSIONS)) {
      expect(checkPermission(role, permissions, MENU_PERMISSIONS, action)).toBe("allowed");
    }
  });
});

describe("RBAC: active permission catalog", () => {
  it("exposes current fine-grained capabilities and excludes retired controls", () => {
    expect(ALL_PERMISSION_KEYS).toEqual(expect.arrayContaining([
      "canCheckIn", "canCheckOut", "canViewAnalytics", "canViewFoodTabs",
      "canEditFoodOrders", "canVoidFoodOrders", "canApplyFoodDiscounts", "canGenerateFoodBills",
      "canManageAccountSettings", "canManageVendors", "canManageEmployees", "canManagePayroll",
      "canViewMenu", "canManageMenuCategories", "canManageMenuItems", "canToggleMenuAvailability", "canManageFoodSettings",
      "canSendReviewRequests", "canEditReviewRequests", "canManageReviewSettings",
    ]));
    expect(ALL_PERMISSION_KEYS).not.toContain("canSyncBookings");
    expect(ALL_PERMISSION_KEYS).not.toContain("canAccessKitchen");
  });

  it("keeps renamed permissions compatible with existing users", () => {
    expect(checkPermission("staff", { canViewTabs: true }, { view: "canViewFoodTabs" }, "view")).toBe("allowed");
    expect(checkPermission("staff", { canGenerateBills: true }, { bill: "canGenerateFoodBills" }, "bill")).toBe("allowed");
    expect(checkPermission("staff", { canReconcile: true }, { reconcile: "canReconcileAccounts" }, "reconcile")).toBe("allowed");
    expect(checkPermission("staff", { canManageAccounts: true }, { settings: "canManageAccountSettings" }, "settings")).toBe("allowed");
  });
});

describe("RBAC: Staff with no permissions is blocked", () => {
  const role: UserRole = "staff";
  const permissions = {};

  it("staff without permissions cannot list records", () => {
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "list")).toBe("forbidden");
  });

  it("staff without permissions cannot view dashboard", () => {
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "getDashboard")).toBe("forbidden");
  });

  it("staff cannot access admin-only actions", () => {
    const adminOnlyActions = Object.entries(CHECKINS_PERMISSIONS)
      .filter(([, v]) => v === "admin_only")
      .map(([k]) => k);

    expect(adminOnlyActions.length).toBeGreaterThan(0);
    for (const action of adminOnlyActions) {
      expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, action)).toBe("admin_required");
    }
  });

  it("staff cannot mark orders paid without canMarkPaid", () => {
    expect(checkPermission(role, permissions, FOOD_ORDERS_PERMISSIONS, "markOrderPaid")).toBe("forbidden");
    expect(checkPermission(role, permissions, FOOD_ORDERS_PERMISSIONS, "applyDiscount")).toBe("forbidden");
  });

  it("staff cannot manage accounts without canManageAccounts", () => {
    expect(checkPermission(role, permissions, EXPENSES_PERMISSIONS, "saveReconciliation")).toBe("forbidden");
  });

  it("menu permissions remain independently scoped", () => {
    expect(checkPermission(role, { canViewMenu: true }, MENU_PERMISSIONS, "getMenuItems")).toBe("allowed");
    expect(checkPermission(role, { canViewMenu: true }, MENU_PERMISSIONS, "addMenuItem")).toBe("forbidden");
    expect(checkPermission(role, { canManageMenuItems: true }, MENU_PERMISSIONS, "updateMenuItem")).toBe("allowed");
    expect(checkPermission(role, { canManageMenuItems: true }, MENU_PERMISSIONS, "deleteCategory")).toBe("forbidden");
    expect(checkPermission(role, { canToggleMenuAvailability: true }, MENU_PERMISSIONS, "toggleItemAvailability")).toBe("allowed");
    expect(checkPermission(role, { canManageInventory: true }, MENU_PERMISSIONS, "addStock")).toBe("allowed");
    expect(checkPermission(role, { canManageFoodSettings: true }, MENU_PERMISSIONS, "updateFoodSettings")).toBe("allowed");
  });

  it("staff without permissions cannot view splits", () => {
    expect(checkPermission(role, permissions, SPLITS_PERMISSIONS, "listMembers")).toBe("forbidden");
    expect(checkPermission(role, permissions, SPLITS_PERMISSIONS, "getBalances")).toBe("forbidden");
  });
});

describe("RBAC: Staff with specific permissions", () => {
  const role: UserRole = "staff";

  it("staff with canViewRecords can list but not add", () => {
    const permissions = { canViewRecords: true };
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "list")).toBe("allowed");
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "verifyCheckin")).toBe("allowed");
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "add")).toBe("forbidden");
  });

  it("staff with canViewDashboard can access dashboard actions", () => {
    const permissions = { canViewDashboard: true };
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "getDashboard")).toBe("allowed");
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "checkoutBed")).toBe("allowed");
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "getPendingFoodTab")).toBe("allowed");
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "markVibeMatched")).toBe("allowed");
  });

  it("timeline view permission can load timeline data without bed permission", () => {
    expect(checkPermission(role, { canViewTimeline: true }, CHECKINS_PERMISSIONS, "getBeds")).toBe("allowed");
    expect(checkPermission(role, { canViewTimeline: true }, CHECKINS_PERMISSIONS, "assignBed")).toBe("forbidden");
  });

  it("staff with canMarkPaid can handle payments but not view orders without canViewFoodOrders", () => {
    const permissions = { canMarkPaid: true };
    expect(checkPermission(role, permissions, FOOD_ORDERS_PERMISSIONS, "markOrderPaid")).toBe("allowed");
    expect(checkPermission(role, permissions, FOOD_ORDERS_PERMISSIONS, "applyDiscount")).toBe("allowed");
    expect(checkPermission(role, permissions, FOOD_ORDERS_PERMISSIONS, "listOrders")).toBe("forbidden");
  });

  it("staff with both food permissions can view and pay", () => {
    const permissions = { canViewFoodOrders: true, canMarkPaid: true };
    expect(checkPermission(role, permissions, FOOD_ORDERS_PERMISSIONS, "listOrders")).toBe("allowed");
    expect(checkPermission(role, permissions, FOOD_ORDERS_PERMISSIONS, "markOrderPaid")).toBe("allowed");
  });

  it("income entry, viewing, and deletion stay independently permissioned", () => {
    expect(checkPermission(role, { canAddIncome: true }, EXPENSES_PERMISSIONS, "getIncomeAccounts")).toBe("allowed");
    expect(checkPermission(role, { canAddIncome: true }, EXPENSES_PERMISSIONS, "addDailyIncome")).toBe("allowed");
    expect(checkPermission(role, { canAddIncome: true }, EXPENSES_PERMISSIONS, "listIncomeRecords")).toBe("forbidden");
    expect(checkPermission(role, { canViewAccounts: true }, EXPENSES_PERMISSIONS, "listIncomeRecords")).toBe("allowed");
    expect(checkPermission(role, { canDeleteExpense: true }, EXPENSES_PERMISSIONS, "deleteDailyIncome")).toBe("allowed");
  });

  it("staff can never access admin-only regardless of permissions", () => {
    const permissions = { canViewRecords: true, canAddCheckin: true, canEditRecords: true };
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "createUser")).toBe("admin_required");
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "getSetting")).toBe("admin_required");
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "deleteUser")).toBe("admin_required");
  });
});

describe("RBAC: Dual-key OR (fine-grained or today's coarse key)", () => {
  const role: UserRole = "staff";

  it("assignBed allowed with canViewBeds (legacy) or canAssignBed (fine)", () => {
    expect(checkPermission(role, { canViewBeds: true }, CHECKINS_PERMISSIONS, "assignBed")).toBe("allowed");
    expect(checkPermission(role, { canAssignBed: true }, CHECKINS_PERMISSIONS, "assignBed")).toBe("allowed");
    expect(checkPermission(role, {}, CHECKINS_PERMISSIONS, "assignBed")).toBe("forbidden");
  });

  it("checkoutBed allowed with canViewDashboard or canCheckout", () => {
    expect(checkPermission(role, { canViewDashboard: true }, CHECKINS_PERMISSIONS, "checkoutBed")).toBe("allowed");
    expect(checkPermission(role, { canCheckout: true }, CHECKINS_PERMISSIONS, "checkoutBed")).toBe("allowed");
    expect(checkPermission(role, {}, CHECKINS_PERMISSIONS, "checkoutBed")).toBe("forbidden");
  });

  it("placeOrderForGuest allowed with canViewFoodOrders or canPlaceOrders", () => {
    expect(checkPermission(role, { canViewFoodOrders: true }, FOOD_ORDERS_PERMISSIONS, "placeOrderForGuest")).toBe("allowed");
    expect(checkPermission(role, { canPlaceOrders: true }, FOOD_ORDERS_PERMISSIONS, "placeOrderForGuest")).toBe("allowed");
    expect(checkPermission(role, {}, FOOD_ORDERS_PERMISSIONS, "placeOrderForGuest")).toBe("forbidden");
  });

  it("bookings checkIn/checkOut allowed with canAddBooking or dedicated keys", () => {
    expect(checkPermission(role, { canAddBooking: true }, BOOKINGS_PERMISSIONS, "checkIn")).toBe("allowed");
    expect(checkPermission(role, { canCheckIn: true }, BOOKINGS_PERMISSIONS, "checkIn")).toBe("allowed");
    expect(checkPermission(role, { canCheckIn: true }, BOOKINGS_PERMISSIONS, "collectStayPayment")).toBe("allowed");
    expect(checkPermission(role, { canCheckOut: true }, BOOKINGS_PERMISSIONS, "checkOut")).toBe("allowed");
    expect(checkPermission(role, { canCheckOut: true }, BOOKINGS_PERMISSIONS, "getPendingFoodTab")).toBe("allowed");
    expect(checkPermission(role, { canCheckIn: true }, BOOKINGS_PERMISSIONS, "checkOut")).toBe("forbidden");
    expect(checkPermission(role, { canCheckIn: true }, BOOKINGS_PERMISSIONS, "getPendingFoodTab")).toBe("forbidden");
  });
});

describe("RBAC: Manager with empty permissions (env password)", () => {
  const role: UserRole = "manager";
  const permissions = {};

  it("manager with env password (empty permissions) is blocked from permission-gated actions", () => {
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "list")).toBe("forbidden");
    expect(checkPermission(role, permissions, FOOD_ORDERS_PERMISSIONS, "listOrders")).toBe("forbidden");
  });

  it("manager is blocked from admin-only actions", () => {
    expect(checkPermission(role, permissions, CHECKINS_PERMISSIONS, "createUser")).toBe("admin_required");
  });
});

describe("RBAC: Splits", () => {
  const role: UserRole = "staff";

  it("view-only can list but not add or settle", () => {
    const permissions = { canViewSplits: true };
    expect(checkPermission(role, permissions, SPLITS_PERMISSIONS, "listMembers")).toBe("allowed");
    expect(checkPermission(role, permissions, SPLITS_PERMISSIONS, "getBalances")).toBe("allowed");
    expect(checkPermission(role, permissions, SPLITS_PERMISSIONS, "addExpense")).toBe("forbidden");
    expect(checkPermission(role, permissions, SPLITS_PERMISSIONS, "addSettlement")).toBe("forbidden");
    expect(checkPermission(role, permissions, SPLITS_PERMISSIONS, "addMember")).toBe("forbidden");
  });

  it("settle without canAddExpense is allowed on the map; route still ANDs Accounts", () => {
    expect(checkPermission(role, { canSettleSplits: true }, SPLITS_PERMISSIONS, "payGokoReimbursement")).toBe("allowed");
    expect(checkPermission(role, { canSettleSplits: true }, SPLITS_PERMISSIONS, "addSettlement")).toBe("allowed");
    const route = readFileSync("src/app/api/admin/splits/route.ts", "utf8");
    expect(route).toContain("canUseAccounts");
    expect(route).toContain("canAddExpense");
    expect(route).not.toContain("paySalary");
    expect(route).toContain('isHouse === 1');
    expect(route).toContain("Pay via Accounts");
    expect(route).toContain("deleteSettlement");
    expect(route).toContain("Cannot delete an Accounts-linked settlement");
    expect(route).toContain("Undo settlements in this group before hiding an expense");
    expect(route).toContain("reuseOrPostHostelExpense");
    const updateIdx = route.indexOf('case "updateExpense"');
    const updateSlice = route.slice(updateIdx, route.indexOf('case "deleteExpense"'));
    expect(updateSlice).toContain("canUseAccounts");
    expect(updateSlice).toContain("hostelExpenseId");
    expect(updateSlice).toContain("Undo settlements in this group before changing money");
  });

  it("env manager with empty permissions cannot open splits", () => {
    expect(checkPermission("manager", {}, SPLITS_PERMISSIONS, "listMembers")).toBe("forbidden");
    expect(checkPermission("manager", {}, SPLITS_PERMISSIONS, "payGokoReimbursement")).toBe("forbidden");
  });

  it("ManagementUsers Select All includes splits keys and nav view", () => {
    const ui = readFileSync("src/components/admin/ManagementUsers.tsx", "utf8");
    const catalog = readFileSync("src/lib/permissionCatalog.ts", "utf8");
    expect(ui).toContain("PERMISSION_GROUPS");
    expect(catalog).toContain("canViewSplits");
    expect(catalog).toContain("canManageSplits");
  });
});

describe("RBAC: Unknown actions pass through", () => {
  it("unknown action is allowed (no entry in permission map)", () => {
    const result = checkPermission("staff", {}, CHECKINS_PERMISSIONS, "changeMyPassword");
    expect(result).toBe("allowed");
  });
});

describe("RBAC: All admin-only actions are accounted for", () => {
  it("sensitive settings actions are admin-only", () => {
    expect(CHECKINS_PERMISSIONS["getSetting"]).toBe("admin_only");
    expect(CHECKINS_PERMISSIONS["setSetting"]).toBe("admin_only");
  });

  it("user management actions are admin-only", () => {
    expect(CHECKINS_PERMISSIONS["getUsers"]).toBe("admin_only");
    expect(CHECKINS_PERMISSIONS["createUser"]).toBe("admin_only");
    expect(CHECKINS_PERMISSIONS["updateUser"]).toBe("admin_only");
    expect(CHECKINS_PERMISSIONS["deleteUser"]).toBe("admin_only");
  });

  it("cleanup is admin-only", () => {
    expect(FOOD_ORDERS_PERMISSIONS["cleanupOldOrders"]).toBe("admin_only");
  });
});

describe("Check-in lookup contract", () => {
  it("keeps returning-guest fields including Drive links and Form C", () => {
    const data = checkinLookupData({
      name: "Ada Guest",
      contact: "9876543210",
      comingFrom: "Goa",
      nationality: "France",
      emergencyName: "Sam",
      emergencyPhone: "9123456780",
      idType: "passport",
      idCardLink: "https://drive.google.com/file/d/abc/view",
      visaLink: "https://drive.google.com/file/d/visa/view",
      formCData: '{"purposeOfVisit":"Leisure"}',
    });
    expect(Object.keys(data).sort()).toEqual([...CHECKIN_LOOKUP_DATA_KEYS].sort());
    expect(data.idCardLink).toContain("drive.google.com");
    expect(data.formCData).toContain("purposeOfVisit");
    expect(data.emergencyName).toBe("Sam");
  });
});

describe("Food lookup guests", () => {
  it("matches normalized phones and keeps a later checkout record with a different id", () => {
    const guests = buildFoodLookupGuests(
      normalizePhone("+91 98765 43210"),
      [{ id: 1, name: "In House", contact: "+919876543210" }],
      [{ guestContact: "9876543210", dormName: "Palm", bedId: "A1" }],
      [{ id: 2, name: "Left", contact: "9876543210" }]
    );
    expect(guests).toEqual([
      { checkinId: 1, name: "In House", phone: "9876543210", roomInfo: "Palm - Bed A1", checkedOut: false },
      { checkinId: 2, name: "Left", phone: "9876543210", roomInfo: "", checkedOut: true },
    ]);
  });

  it("does not duplicate the same checkin id as both active and checked out", () => {
    const guests = buildFoodLookupGuests(
      "9876543210",
      [{ id: 9, name: "Same", contact: "9876543210" }],
      [],
      [{ id: 9, name: "Same", contact: "9876543210" }]
    );
    expect(guests).toEqual([
      { checkinId: 9, name: "Same", phone: "9876543210", roomInfo: "", checkedOut: false },
    ]);
  });

  it("returns checked-out guest when not also active", () => {
    const guests = buildFoodLookupGuests(
      "9876543210",
      [],
      [],
      [{ id: 9, name: "Gone", contact: "98765 43210" }]
    );
    expect(guests).toEqual([
      { checkinId: 9, name: "Gone", phone: "9876543210", roomInfo: "", checkedOut: true },
    ]);
  });

  it("returns empty for unknown phone", () => {
    expect(buildFoodLookupGuests("1111111111", [{ id: 1, name: "X", contact: "9999999999" }], [], [])).toEqual([]);
  });
});

function expenseGate(role: UserRole, permissions: Record<string, boolean>, action: string) {
  const gate = checkPermission(role, permissions, EXPENSES_PERMISSIONS, action);
  if (gate === "admin_required") return { status: 403, error: "Admin access required" };
  if (gate === "forbidden") return { status: 403, error: "You don't have permission to perform this action" };
  return { status: 200, error: null };
}

describe("Mock workflows: Bill Records edit (production 8:39pm failure)", () => {
  const ui = readFileSync("src/components/admin/AdminBillRecords.tsx", "utf8");
  const route = readFileSync("src/app/api/admin/expenses/route.ts", "utf8");

  it("round 1: manager with canEditExpense can save a submitted bill (the Admin-only 403)", () => {
    const user = { role: "manager" as const, permissions: { canViewExpenses: true, canEditExpense: true } };
    expect(expenseGate(user.role, user.permissions, "updateExpense")).toEqual({ status: 200, error: null });
    expect(expenseGate(user.role, user.permissions, "listExpenses")).toEqual({ status: 200, error: null });
    expect(ui).toContain('hasPermission(role, permissions, "canEditExpense")');
    expect(ui).toContain('action: "updateExpense"');
  });

  it("round 1: staff who can only view bills is still blocked from save and delete", () => {
    const perms = { canViewExpenses: true };
    expect(expenseGate("staff", perms, "listExpenses").status).toBe(200);
    expect(expenseGate("staff", perms, "updateExpense")).toEqual({
      status: 403,
      error: "You don't have permission to perform this action",
    });
    expect(expenseGate("staff", perms, "deleteExpense").status).toBe(403);
  });

  it("round 2: staff with edit but not delete can update the Cloudflare bill and cannot delete it", () => {
    const perms = { canViewExpenses: true, canEditExpense: true };
    expect(expenseGate("staff", perms, "updateExpense").status).toBe(200);
    expect(expenseGate("staff", perms, "deleteExpense").status).toBe(403);
    expect(expenseGate("staff", perms, "addExpense").status).toBe(403);
  });

  it("round 2: admin can update, delete, and undo reconciliation", () => {
    expect(expenseGate("admin", {}, "updateExpense").status).toBe(200);
    expect(expenseGate("admin", {}, "deleteExpense").status).toBe(200);
    expect(expenseGate("admin", {}, "undoReconciliation").status).toBe(200);
  });

  it("round 3: update/delete/undo do not still return Admin only after the permission map", () => {
    for (const action of ["updateExpense", "deleteExpense", "undoReconciliation"]) {
      const section = route.match(new RegExp(`case "${action}":[\\s\\S]*?(?=\\n      case "|\\n      default:)`))?.[0] ?? "";
      expect(section.length).toBeGreaterThan(20);
      expect(section).not.toContain('error: "Admin only"');
      expect(section).not.toContain('role !== "admin"');
    }
    expect(route).toContain('updateExpense: "canEditExpense"');
    expect(route).toContain('deleteExpense: "canDeleteExpense"');
  });

  it("round 3: env-password manager with empty permissions cannot edit bills", () => {
    expect(expenseGate("manager", {}, "updateExpense").status).toBe(403);
  });
});

describe("Order status polling / stepper", () => {
  it("cancelled is not a stepper step and does not poll", () => {
    expect(STATUS_STEPS.includes("cancelled" as (typeof STATUS_STEPS)[number])).toBe(false);
    expect(stepperIndex("cancelled")).toBe(-1);
    expect(stepperIndex("preparing")).toBe(2);
    expect(shouldPollOrderStatus("cancelled", false)).toBe(false);
    expect(shouldPollOrderStatus("served", false)).toBe(false);
    expect(shouldPollOrderStatus("preparing", false)).toBe(true);
    expect(shouldPollOrderStatus("preparing", true)).toBe(false);
  });
});
