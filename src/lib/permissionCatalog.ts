export type PermissionOption = { key: string; label: string; description?: string };

export const PERMISSION_GROUPS: Array<{ label: string; options: PermissionOption[] }> = [
  {
    label: "Navigation Permissions",
    options: [
      ["canViewDashboard", "View Dashboard"], ["canViewBookings", "View Bookings"],
      ["canViewBeds", "View Beds"], ["canViewTimeline", "View Timeline"],
      ["canViewRecords", "View Records"], ["canViewFoodOrders", "View Food Orders"],
      ["canViewAccounts", "View Accounts"], ["canViewSplits", "View Splits"],
      ["canViewReviews", "View Reviews"], ["canViewManagement", "View Management"],
      ["canViewTasks", "View and update assigned tasks"],
      ["canViewAudit", "View Audit Logs"], ["canViewLogs", "View System Logs"],
      ["canViewAnalytics", "View Analytics"], ["canViewQuickLinks", "View Links & QRs"],
    ].map(([key, label]) => ({ key, label })),
  },
  {
    label: "Notification Categories",
    options: [
      ["canReceiveBookingNotifications", "Receive booking notifications"],
      ["canReceiveCheckinNotifications", "Receive check-in notifications"],
      ["canReceiveFoodNotifications", "Receive food notifications"],
      ["canReceiveAttentionNotifications", "Receive attention notifications"],
      ["canReceiveOperationsNotifications", "Receive operations notifications"],
      ["canReceiveReminderNotifications", "Receive reminder notifications"],
    ].map(([key, label]) => ({ key, label })),
  },
  {
    label: "Check-in & Beds",
    options: [
      ["canAddCheckin", "Add check-ins"], ["canAssignBed", "Assign beds"],
      ["canCheckout", "Checkout guests"], ["canMarkClean", "Mark beds clean"],
      ["canEditRecords", "Edit records"], ["canDeleteRecords", "Delete records"],
    ].map(([key, label]) => ({ key, label })),
  },
  {
    label: "Bookings",
    options: [
      ["canAddBooking", "Add bookings"], ["canCheckIn", "Check in booking guests"],
      ["canRecordBookingPayments", "Record OTA postpaid booking payments"],
      ["canCorrectBookingPayments", "Correct / revert mistaken OTA booking payments"],
      ["canCheckOut", "Check out booking guests"], ["canDeleteBooking", "Delete bookings"],
      ["canManageBookingContacts", "Manage booking contact details"],
      ["canManageBookingTemplates", "Manage booking message templates"],
    ].map(([key, label]) => ({ key, label })),
  },
  {
    label: "Food & Kitchen",
    options: [
      ["canViewFoodTabs", "View guest tabs / order summary"], ["canPlaceOrders", "Place orders for guests"],
      ["canEditFoodOrders", "Edit food orders"], ["canVoidFoodOrders", "Void food order items"],
      ["canMarkPaid", "Mark orders as paid"], ["canApplyFoodDiscounts", "Apply food discounts"],
      ["canGenerateFoodBills", "Generate / print food bills"], ["canManageInventory", "Manage inventory / add stock"],
      ["canViewMenu", "View menu management"], ["canManageMenuCategories", "Manage menu categories"],
      ["canManageMenuItems", "Manage menu items"], ["canToggleMenuAvailability", "Toggle menu availability"],
      ["canManageFoodSettings", "Manage food settings"],
    ].map(([key, label]) => ({ key, label })),
  },
  {
    label: "Accounts & Finance",
    options: [
      ["canAddExpense", "Add expenses"], ["canEditExpense", "Edit expenses"],
      ["canDeleteExpense", "Delete expenses"], ["canViewExpenses", "View expense records"],
      ["canViewFoodBills", "View food and room revenue"], ["canAddIncome", "Add daily income entries"],
      ["canReconcileCash", "Reconcile cash balance"], ["canReconcileOnline", "Reconcile online account balances"],
      ["canSettlePlatformPayments", "Record and allocate OTA payouts"],
      ["canAdjustPlatformReceivables", "Adjust OTA receivables and deductions"],
      ["canManageAccountSettings", "Manage account settings"],
      ["canManageVendors", "Manage vendors"], ["canManageEmployees", "Manage employees"],
      ["canManagePayroll", "Manage payroll"],
    ].map(([key, label]) => ({ key, label })),
  },
  {
    label: "Reviews",
    options: [
      ["canSendReviewRequests", "Send review requests"], ["canEditReviewRequests", "Edit or reset review requests"],
      ["canManageReviewSettings", "Manage review settings"],
    ].map(([key, label]) => ({ key, label })),
  },
  {
    label: "Splits & Tools",
    options: [
      ["canAddSplitExpense", "Add split expenses"], ["canEditSplitExpense", "Edit split expenses"],
      ["canDeleteSplitExpense", "Delete split expenses"], ["canSettleSplits", "Settle splits / Goko pay"],
      ["canManageSplits", "Manage people and groups"], ["canUseQRGenerator", "Use QR code generator"],
      ["canManageAttendance", "Manage staff attendance"],
      ["canManageTasks", "Create and manage all tasks"],
    ].map(([key, label]) => ({ key, label })),
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((group) => group.options.map((option) => option.key));
