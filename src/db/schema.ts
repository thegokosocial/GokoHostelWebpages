import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// Sync columns shared across synced tables
const syncColumns = {
  syncId: text("sync_id"),
  syncUpdatedAt: text("sync_updated_at"),
  syncSource: text("sync_source").default("cloudflare"),
};

const syncColumnsWithDelete = {
  ...syncColumns,
  deletedAt: text("deleted_at"),
};

export const checkins = sqliteTable("checkins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  submittedAt: text("submitted_at").notNull(),
  arrivalDate: text("arrival_date").notNull(),
  arrivalTime: text("arrival_time"),
  name: text("name").notNull(),
  persons: text("persons"),
  contact: text("contact").notNull(),
  stayingDays: text("staying_days"),
  comingFrom: text("coming_from"),
  nationality: text("nationality"),
  emergencyName: text("emergency_name"),
  emergencyPhone: text("emergency_phone"),
  idType: text("id_type"),
  idCardLink: text("id_card_link"),
  visaLink: text("visa_link"),
  verified: text("verified").default("pending"),
  status: text("status").notNull().default("active"),
  checkedOutAt: text("checked_out_at").default(""),
  formCData: text("form_c_data").default(""),
  bookingPlatform: text("booking_platform").default(""),
  bookingId: text("booking_id").default(""),
  dob: text("dob").default(""),
  dobFromId: text("dob_from_id").default(""),
  vibeMatched: integer("vibe_matched").notNull().default(0),
  createdMonth: text("created_month").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_checkins_month").on(table.createdMonth),
  index("idx_checkins_contact").on(table.contact),
  index("idx_checkins_arrival").on(table.arrivalDate),
  index("idx_checkins_status").on(table.status),
]);

export const dorms = sqliteTable("dorms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
});

export const beds = sqliteTable("beds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dormId: integer("dorm_id").notNull().references(() => dorms.id),
  dormName: text("dorm_name").notNull(),
  bedId: text("bed_id").notNull(),
  position: text("position").notNull().default("Lower"),
  type: text("type").notNull().default("Bunk"),
  status: text("status").notNull().default("available"),
  guestName: text("guest_name").default(""),
  guestContact: text("guest_contact").default(""),
  checkinDate: text("checkin_date").default(""),
  expectedCheckout: text("expected_checkout").default(""),
  stayingDays: text("staying_days").default(""),
  isBlocked: integer("is_blocked").notNull().default(0),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_beds_dorm").on(table.dormId),
  index("idx_beds_status").on(table.status),
]);

export const bedHistory = sqliteTable("bed_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bedIdLabel: text("bed_id_label").notNull(),
  dormName: text("dorm_name").notNull(),
  action: text("action").notNull(),
  guestName: text("guest_name").default(""),
  guestContact: text("guest_contact").default(""),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_history_action").on(table.action),
  index("idx_history_dorm").on(table.dormName),
]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  syncUpdatedAt: text("sync_updated_at"),
  syncSource: text("sync_source").default("cloudflare"),
});

export const apiStats = sqliteTable("api_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  month: text("month").notNull().unique(),
  vision: integer("vision").notNull().default(0),
  sheets: integer("sheets").notNull().default(0),
  drive: integer("drive").notNull().default(0),
  total: integer("total").notNull().default(0),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("staff"),
  permissions: text("permissions").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").default(""),
  isSystem: integer("is_system").notNull().default(0),
  ...syncColumnsWithDelete,
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull(),
  userId: integer("user_id"),
  username: text("username").notNull(),
  action: text("action").notNull(),
  target: text("target").default(""),
  details: text("details").default(""),
  ipAddress: text("ip_address").default(""),
}, (table) => [
  index("idx_audit_time").on(table.timestamp),
  index("idx_audit_user").on(table.username),
  index("idx_audit_action").on(table.action),
]);

export const systemLogs = sqliteTable("system_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull(),
  level: text("level").notNull(),
  source: text("source").default(""),
  message: text("message").notNull(),
  details: text("details").default(""),
  requestId: text("request_id").default(""),
}, (table) => [
  index("idx_logs_time").on(table.timestamp),
  index("idx_logs_level").on(table.level),
]);

export const rateScrapes = sqliteTable("rate_scrapes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  city: text("city").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  propertyType: text("property_type").default("hostels"),
  status: text("status").notNull().default("pending"),
  results: text("results").default(""),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at").default(""),
});

export const bookings = sqliteTable("bookings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  guestName: text("guest_name").notNull(),
  contact: text("contact").default(""),
  platform: text("platform").notNull(),
  bookingRef: text("booking_ref").default(""),
  checkinDate: text("checkin_date").notNull(),
  checkoutDate: text("checkout_date").default(""),
  roomType: text("room_type").default(""),
  persons: integer("persons").notNull().default(1),
  paymentStatus: text("payment_status").default("unknown"),
  specialRequests: text("special_requests").default(""),
  status: text("status").notNull().default("received"),
  source: text("source").default("manual"),
  property: text("property").default("goko_hostel"),
  rawData: text("raw_data").default(""),
  createdAt: text("created_at").notNull(),
  syncedAt: text("synced_at").default(""),
  amountBeforeTax: integer("amount_before_tax").default(0),
  amountTax: integer("amount_tax").default(0),
  amountTotal: integer("amount_total").default(0),
  amountPaid: integer("amount_paid").default(0), // ingest 0; prepaid check-in copies total as online
  paymentMethod: text("payment_method").notNull().default(""), // cash | online | split
  cashReceived: integer("cash_received").notNull().default(0),
  changeGiven: integer("change_given").notNull().default(0),
  amountRefunded: integer("amount_refunded").notNull().default(0),
  refundMethod: text("refund_method").notNull().default(""),
  refundCash: integer("refund_cash").notNull().default(0),
  refundedAt: text("refunded_at").notNull().default(""),
  refundedBy: text("refunded_by").notNull().default(""),

  nightlyRate: integer("nightly_rate").default(0),
  currency: text("currency").default("INR"),
  email: text("email").default(""),
  cmBookingId: text("cm_booking_id").default(""),
  gokoBookingId: text("goko_booking_id").default(""),
  ratePlan: text("rate_plan").default(""),
  holdExpiresAt: text("hold_expires_at").default(""),
  cancelledAt: text("cancelled_at").default(""),
  cancelledBy: text("cancelled_by").default(""),
  checkedInAt: text("checked_in_at").default(""),
  checkedInBy: text("checked_in_by").default(""),
  checkedOutAt: text("checked_out_at").default(""),
  checkedOutBy: text("checked_out_by").default(""),
  noShowPmsStatus: text("no_show_pms_status").notNull().default("not_required"),
  noShowPmsError: text("no_show_pms_error").notNull().default(""),
  noShowPmsAttemptedAt: text("no_show_pms_attempted_at").notNull().default(""),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_bookings_checkin").on(table.checkinDate),
  index("idx_bookings_created").on(table.createdAt),
  index("idx_bookings_platform").on(table.platform),
  index("idx_bookings_status").on(table.status),
  index("idx_bookings_ref").on(table.bookingRef),
  index("idx_bookings_goko_id").on(table.gokoBookingId),
]);

// --- Food Ordering ---

export const menuCategories = sqliteTable("menu_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nameKannada: text("name_kannada").default(""),
  icon: text("icon").notNull().default("🍽️"),
  description: text("description").default(""),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  trackInventoryDefault: integer("track_inventory_default").notNull().default(0),
  discountExempt: integer("discount_exempt").notNull().default(0),
  ...syncColumnsWithDelete,
});

export const menuItems = sqliteTable("menu_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id").notNull().references(() => menuCategories.id),
  name: text("name").notNull(),
  nameKannada: text("name_kannada").default(""),
  description: text("description").default(""),
  price: integer("price").notNull().default(0),
  priceText: text("price_text").default(""),
  tags: text("tags").notNull().default("[]"),
  ingredients: text("ingredients").notNull().default("[]"),
  imageUrl: text("image_url").default(""),
  isAvailable: integer("is_available").notNull().default(1),
  displayOrder: integer("display_order").notNull().default(0),
  trackInventory: integer("track_inventory").notNull().default(0),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_menu_items_category").on(table.categoryId),
  index("idx_menu_items_available").on(table.isAvailable),
]);

export const foodOrders = sqliteTable("food_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderNumber: text("order_number").notNull().unique(),
  idempotencyKey: text("idempotency_key"),
  guestType: text("guest_type").notNull().default("walkin"),
  checkinId: integer("checkin_id").references(() => checkins.id),
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone").notNull().default(""),
  roomInfo: text("room_info").default(""),
  tableNumber: text("table_number").default(""),
  specialInstructions: text("special_instructions").default(""),
  subtotal: integer("subtotal").notNull().default(0),
  tax: integer("tax").notNull().default(0),
  total: integer("total").notNull().default(0),
  status: text("status").notNull().default("placed"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  paymentMethod: text("payment_method").default(""),
  paidBy: text("paid_by").default(""),
  cashReceived: integer("cash_received").default(0),
  changeGiven: integer("change_given").default(0),
  discount: integer("discount").notNull().default(0),
  discountReason: text("discount_reason").default(""),
  discountBy: text("discount_by").default(""),
  cancelledReason: text("cancelled_reason").default(""),
  cancelledAt: text("cancelled_at").default(""),
  createdBy: text("created_by").notNull().default("guest"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_food_orders_checkin").on(table.checkinId),
  index("idx_food_orders_status").on(table.status),
  index("idx_food_orders_payment").on(table.paymentStatus),
  index("idx_food_orders_created").on(table.createdAt),
  uniqueIndex("idx_food_orders_idempotency").on(table.idempotencyKey),
]);

export const foodOrderItems = sqliteTable("food_order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => foodOrders.id),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItems.id),
  itemName: text("item_name").notNull(),
  itemPrice: integer("item_price").notNull().default(0),
  quantity: integer("quantity").notNull().default(1),
  lineTotal: integer("line_total").notNull().default(0),
  status: text("status").notNull().default("active"),
  ...syncColumns,
}, (table) => [
  index("idx_food_order_items_order").on(table.orderId),
]);

export const orderModifications = sqliteTable("order_modifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => foodOrders.id),
  action: text("action").notNull(),
  itemId: integer("item_id"),
  oldValue: text("old_value").default(""),
  newValue: text("new_value").default(""),
  reason: text("reason").default(""),
  modifiedBy: text("modified_by").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_order_mods_order").on(table.orderId),
]);

// --- QR Code History ---

export const qrHistory = sqliteTable("qr_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  config: text("config").notNull(),
  previewDataUrl: text("preview_data_url").default(""),
  createdBy: text("created_by").default(""),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_qr_history_created").on(table.createdAt),
]);

// --- Accounts Module ---

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nickname: text("nickname").default(""),
  bankName: text("bank_name").default(""),
  accountType: text("account_type").notNull().default("savings"),
  accountNumber: text("account_number").default(""),
  ifscCode: text("ifsc_code").default(""),
  isDefault: integer("is_default").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  openingBalance: integer("opening_balance").notNull().default(0),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_accounts_active").on(table.isActive),
]);

export const vendors = sqliteTable("vendors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").default(""),
  contactPhone: text("contact_phone").default(""),
  notes: text("notes").default(""),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_vendors_active").on(table.isActive),
  index("idx_vendors_category").on(table.category),
]);

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role").default(""),
  phone: text("phone").default(""),
  salary: integer("salary").notNull().default(0),
  salaryFrequency: text("salary_frequency").notNull().default("monthly"),
  bankAccount: text("bank_account").default(""),
  attendanceStartDate: text("attendance_start_date").notNull().default(""),
  employmentEndDate: text("employment_end_date").notNull().default(""),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_employees_active").on(table.isActive),
]);

export const salaryPayments = sqliteTable("salary_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  amount: integer("amount").notNull(),
  month: text("month").notNull(),
  accountId: integer("account_id").references(() => accounts.id),
  paymentMethod: text("payment_method").notNull().default("cash"),
  paidAt: text("paid_at").notNull(),
  notes: text("notes").default(""),
  payType: text("pay_type").notNull().default("salary"),
  requestId: text("request_id").notNull().default(""),
  grossAmount: integer("gross_amount").notNull().default(0),
  attendanceDeduction: integer("attendance_deduction").notNull().default(0),
  netPayable: integer("net_payable").notNull().default(0),
  paidLeaveUnits: integer("paid_leave_units").notNull().default(0),
  unpaidLeaveUnits: integer("unpaid_leave_units").notNull().default(0),
  calculationSnapshot: text("calculation_snapshot").notNull().default(""),
  createdBy: text("created_by").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_salary_employee").on(table.employeeId),
  index("idx_salary_month").on(table.month),
]);

export const employeeAttendance = sqliteTable("employee_attendance", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  date: text("date").notNull(),
  status: text("status").notNull().default("present"),
  comment: text("comment").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  uniqueIndex("idx_employee_attendance_day").on(table.employeeId, table.date),
  index("idx_employee_attendance_date").on(table.date),
]);

export const employeeAttendanceHistory = sqliteTable("employee_attendance_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  date: text("date").notNull(),
  oldStatus: text("old_status").notNull().default("present"),
  newStatus: text("new_status").notNull(),
  oldComment: text("old_comment").notNull().default(""),
  newComment: text("new_comment").notNull().default(""),
  action: text("action").notNull(),
  performedBy: text("performed_by").notNull(),
  performedAt: text("performed_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_employee_attendance_history_employee").on(table.employeeId),
  index("idx_employee_attendance_history_date").on(table.date),
]);

export const employeeLeavePolicy = sqliteTable("employee_leave_policy", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").references(() => employees.id),
  effectiveMonth: text("effective_month").notNull(),
  monthlyCreditUnits: integer("monthly_credit_units").notNull().default(4),
  carryCapUnits: integer("carry_cap_units").notNull().default(24),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_employee_leave_policy_month").on(table.effectiveMonth),
  index("idx_employee_leave_policy_employee").on(table.employeeId),
]);

export const employeeCompensationHistory = sqliteTable("employee_compensation_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  effectiveMonth: text("effective_month").notNull(),
  salary: integer("salary").notNull(),
  salaryFrequency: text("salary_frequency").notNull().default("monthly"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  uniqueIndex("idx_employee_comp_month").on(table.employeeId, table.effectiveMonth),
]);

export const dailyIncome = sqliteTable("daily_income", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  accountId: integer("account_id").references(() => accounts.id),
  type: text("type").notNull().default("cash"),
  amount: integer("amount").notNull(),
  source: text("source").notNull().default("stay"),
  sourceDetail: text("source_detail").default(""),
  description: text("description").default(""),
  foodRevenueAuto: integer("food_revenue_auto").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_daily_income_date").on(table.date),
  index("idx_daily_income_account").on(table.accountId),
]);

/** Immutable automatic online guest-receipt journal. Amounts are paise. */
export const guestReceipts = sqliteTable("guest_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptId: text("receipt_id").notNull().unique(),
  sourceType: text("source_type").notNull(), // food_order | booking
  sourceId: integer("source_id").notNull(),
  kind: text("kind").notNull(), // food | stay | ota_prepaid | refund | reversal
  accountId: integer("account_id").notNull().references(() => accounts.id),
  amount: integer("amount").notNull(), // positive receipt, negative reversal/refund
  businessDate: text("business_date").notNull(),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_guest_receipts_date_account").on(table.businessDate, table.accountId),
  index("idx_guest_receipts_source").on(table.sourceType, table.sourceId),
]);

export const dailyLedger = sqliteTable("daily_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  accountId: integer("account_id").references(() => accounts.id),
  openingBalance: integer("opening_balance").notNull().default(0),
  openingAdjusted: integer("opening_adjusted").notNull().default(0),
  totalIncome: integer("total_income").notNull().default(0),
  totalExpense: integer("total_expense").notNull().default(0),
  expectedClosing: integer("expected_closing").notNull().default(0),
  actualClosing: integer("actual_closing"),
  isReconciled: integer("is_reconciled").notNull().default(0),
  reconciledBy: text("reconciled_by").default(""),
  reconciledAt: text("reconciled_at").default(""),
  notes: text("notes").default(""),
  ...syncColumns,
}, (table) => [
  index("idx_daily_ledger_date").on(table.date),
  index("idx_daily_ledger_account").on(table.accountId),
  uniqueIndex("idx_daily_ledger_date_account_unique").on(table.date, table.accountId),
]);

// --- Expenses ---

export const expenses = sqliteTable("expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  amount: integer("amount").notNull(),
  category: text("category").notNull(),
  customCategory: text("custom_category").default(""),
  purpose: text("purpose").notNull().default(""),
  billImageLink: text("bill_image_link").default(""),
  vendorId: integer("vendor_id"),
  accountId: integer("account_id"),
  paymentMethod: text("payment_method").default("cash"),
  mainCategory: text("main_category").default("stay_expense"),
  subCategory: text("sub_category").default(""),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").default(""),
  createdMonth: text("created_month").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_expenses_month").on(table.createdMonth),
  index("idx_expenses_created").on(table.createdAt),
  index("idx_expenses_created_by").on(table.createdBy),
]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  keyP256dh: text("key_p256dh").notNull(),
  keyAuth: text("key_auth").notNull(),
  userLabel: text("user_label").default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_push_endpoint").on(table.endpoint),
]);

// --- Sync Infrastructure (not synced themselves) ---

export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  direction: text("direction").notNull(),
  status: text("status").notNull().default("started"),
  recordsPulled: integer("records_pulled").notNull().default(0),
  recordsPushed: integer("records_pushed").notNull().default(0),
  conflictsFound: integer("conflicts_found").notNull().default(0),
  errorMessage: text("error_message").default(""),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at").default(""),
  details: text("details").default(""),
});

export const syncConflicts = sqliteTable("sync_conflicts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableName: text("table_name").notNull(),
  syncId: text("sync_id").notNull(),
  conflictType: text("conflict_type").notNull().default("update_update"),
  cloudData: text("cloud_data").notNull().default("{}"),
  piData: text("pi_data").notNull().default("{}"),
  cloudUpdatedAt: text("cloud_updated_at").default(""),
  piUpdatedAt: text("pi_updated_at").default(""),
  resolved: integer("resolved").notNull().default(0),
  resolution: text("resolution").default(""),
  resolvedAt: text("resolved_at").default(""),
  resolvedBy: text("resolved_by").default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_sync_conflicts_unresolved").on(table.resolved),
  index("idx_sync_conflicts_table").on(table.tableName),
]);

// --- Review Funnel ---

export const reviewRequests = sqliteTable("review_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  checkinId: integer("checkin_id").notNull(),
  guestName: text("guest_name").notNull(),
  guestContact: text("guest_contact").notNull(),
  propertyId: text("property_id").default("goko_hostel"),
  bookingId: text("booking_id").default(""),
  whatsappSentCount: integer("whatsapp_sent_count").default(0),
  whatsappLastSentAt: text("whatsapp_last_sent_at"),
  rating: integer("rating"),
  ratedAt: text("rated_at"),
  redirectedToGoogle: integer("redirected_to_google").default(0),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_review_requests_checkin").on(table.checkinId),
  index("idx_review_requests_created").on(table.createdAt),
  index("idx_review_requests_property").on(table.propertyId),
]);

export const reviewFeedback = sqliteTable("review_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reviewRequestId: integer("review_request_id").notNull().references(() => reviewRequests.id),
  rating: integer("rating").notNull(),
  improvementAreas: text("improvement_areas").notNull().default("[]"),
  comments: text("comments").default(""),
  submittedAt: text("submitted_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_review_feedback_request").on(table.reviewRequestId),
  index("idx_review_feedback_submitted").on(table.submittedAt),
]);

export const syncIdMap = sqliteTable("sync_id_map", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableName: text("table_name").notNull(),
  syncId: text("sync_id").notNull(),
  localId: integer("local_id").notNull(),
  remoteId: integer("remote_id"),
}, (table) => [
  uniqueIndex("idx_sync_id_map_unique").on(table.tableName, table.syncId),
  index("idx_sync_id_map_lookup").on(table.tableName, table.localId),
]);

// --- Channel Manager (Aiosell Integration) ---

export const channelConfig = sqliteTable("channel_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull().default("aiosell"),
  hotelCode: text("hotel_code").notNull(),
  pmsId: text("pms_id").notNull(),
  apiBaseUrl: text("api_base_url").notNull(),
  apiUsername: text("api_username").notNull(),
  apiPassword: text("api_password").notNull(),
  webhookSecret: text("webhook_secret").default(""),
  bookingEngineUrl: text("booking_engine_url").default(""),
  isActive: integer("is_active").notNull().default(0),
  autoPushInventory: integer("auto_push_inventory").notNull().default(1),
  autoPushRates: integer("auto_push_rates").notNull().default(0),
  autoPushRateRestrictions: integer("auto_push_rate_restrictions").notNull().default(0),
  autoPushInvRestrictions: integer("auto_push_inv_restrictions").notNull().default(0),
  lastSyncAt: text("last_sync_at").default(""),
  createdAt: text("created_at").notNull(),
});

export const roomTypeMapping = sqliteTable("room_type_mapping", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dormId: integer("dorm_id").notNull().references(() => dorms.id),
  dormName: text("dorm_name").notNull(),
  channelRoomCode: text("channel_room_code").notNull(),
  totalInventory: integer("total_inventory").notNull(),
  isActive: integer("is_active").notNull().default(1),
});

export const ratePlanMapping = sqliteTable("rate_plan_mapping", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomMappingId: integer("room_mapping_id").notNull().references(() => roomTypeMapping.id),
  ratePlanCode: text("rate_plan_code").notNull(),
  ratePlanName: text("rate_plan_name").notNull(),
  isActive: integer("is_active").notNull().default(1),
});

export const dailyRates = sqliteTable("daily_rates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ratePlanId: integer("rate_plan_id").notNull().references(() => ratePlanMapping.id),
  date: text("date").notNull(),
  rate: integer("rate").notNull(),
  stopSell: integer("stop_sell").notNull().default(0),
  minimumStay: integer("minimum_stay").notNull().default(1),
  maximumStay: integer("maximum_stay"),
  closeOnArrival: integer("close_on_arrival").notNull().default(0),
  closeOnDeparture: integer("close_on_departure").notNull().default(0),
  minimumAdvanceReservation: integer("minimum_advance_reservation"),
  maximumAdvanceReservation: integer("maximum_advance_reservation"),
  adult1Rate: integer("adult1_rate"),
  adult2Rate: integer("adult2_rate"),
  childRate: integer("child_rate"),
  infantRate: integer("infant_rate"),
  extraPersonRate: integer("extra_person_rate"),
  updatedBy: text("updated_by").default(""),
  updatedAt: text("updated_at").notNull(),
  syncedAt: text("synced_at").default(""),
}, (table) => [
  uniqueIndex("idx_daily_rates_plan_date").on(table.ratePlanId, table.date),
]);

export const channelSyncLog = sqliteTable("channel_sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  direction: text("direction").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  requestPayload: text("request_payload").default(""),
  responsePayload: text("response_payload").default(""),
  errorMessage: text("error_message").default(""),
  recordsAffected: integer("records_affected").default(0),
  createdAt: text("created_at").notNull(),
  httpMethod: text("http_method").default(""),
  url: text("url").default(""),
  httpStatus: integer("http_status"),
  durationMs: integer("duration_ms"),
}, (table) => [
  index("idx_channel_sync_created").on(table.createdAt),
  index("idx_channel_sync_type").on(table.type),
]);

// --- Booking Calendar Dashboard ---

export const bookingBedAssignments = sqliteTable("booking_bed_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull().references(() => bookings.id),
  bedId: integer("bed_id").notNull().references(() => beds.id),
  dormId: integer("dorm_id").notNull().references(() => dorms.id),
  checkinDate: text("checkin_date").notNull(),
  checkoutDate: text("checkout_date").notNull(),
  status: text("status").notNull().default("assigned"),
  assignedBy: text("assigned_by").default(""),
  assignedAt: text("assigned_at").notNull(),
  inventoryPool: text("inventory_pool").notNull().default("online"),
}, (table) => [
  index("idx_bba_bed_dates").on(table.bedId, table.checkinDate, table.checkoutDate),
  index("idx_bba_booking").on(table.bookingId),
  index("idx_bba_dates").on(table.checkinDate, table.checkoutDate),
  index("idx_bba_dorm_status_dates").on(table.dormId, table.status, table.checkinDate, table.checkoutDate),
]);

export const bookingHistory = sqliteTable("booking_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull().references(() => bookings.id),
  action: text("action").notNull(),
  details: text("details").default(""),
  performedBy: text("performed_by").notNull(),
  performedAt: text("performed_at").notNull(),
}, (table) => [
  index("idx_bh_booking").on(table.bookingId),
]);

// --- Inventory & Rate Plan Management ---

export const bedTypeConfig = sqliteTable("bed_type_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dormId: integer("dorm_id").notNull().references(() => dorms.id),
  bedType: text("bed_type").notNull().default("Bunk"),
  maxOccupancy: integer("max_occupancy").notNull().default(1),
  extraPersonAllowed: integer("extra_person_allowed").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_bed_type_config_dorm").on(table.dormId),
]);

export const channels = sqliteTable("channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const channelRates = sqliteTable("channel_rates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ratePlanId: integer("rate_plan_id").notNull().references(() => ratePlanMapping.id),
  channelId: integer("channel_id").notNull().references(() => channels.id),
  date: text("date").notNull(),
  adult1Rate: integer("adult1_rate"),
  adult2Rate: integer("adult2_rate"),
  childRate: integer("child_rate"),
  infantRate: integer("infant_rate"),
  extraPersonRate: integer("extra_person_rate"),
  updatedBy: text("updated_by").default(""),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_channel_rates_plan_channel_date").on(table.ratePlanId, table.channelId, table.date),
]);

export const bedBlocks = sqliteTable("bed_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bedId: integer("bed_id").notNull().references(() => beds.id),
  dormId: integer("dorm_id").notNull().references(() => dorms.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  reason: text("reason").default(""),
  blockedBy: text("blocked_by").default(""),
  blockedAt: text("blocked_at").notNull(),
  unblockedBy: text("unblocked_by"),
  unblockedAt: text("unblocked_at"),
  isActive: integer("is_active").notNull().default(1),
}, (table) => [
  index("idx_bed_blocks_dorm_dates").on(table.dormId, table.startDate, table.endDate, table.isActive),
  index("idx_bed_blocks_bed").on(table.bedId, table.isActive),
]);

export const inventoryOverrides = sqliteTable("inventory_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dormId: integer("dorm_id").notNull().references(() => dorms.id),
  channelId: integer("channel_id").references(() => channels.id),
  date: text("date").notNull(),
  onlineAvailable: integer("online_available"),
  offlineAvailable: integer("offline_available"),
  overriddenBy: text("overridden_by").default(""),
  overriddenAt: text("overridden_at").notNull(),
}, (table) => [
  uniqueIndex("idx_inventory_overrides_dorm_channel_date").on(table.dormId, table.channelId, table.date),
]);

export const inventoryDirty = sqliteTable("inventory_dirty", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dormId: integer("dorm_id").notNull(),
  date: text("date").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_inventory_dirty_dorm_date").on(table.dormId, table.date),
]);

// Customer-facing website CMS (Cloudflare-only; not synced to Pi)
export const siteEvents = sqliteTable("site_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().default(""),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  isPast: integer("is_past").notNull().default(0),
  coverUrl: text("cover_url").notNull().default(""),
  photos: text("photos").notNull().default("[]"),
  displayOrder: integer("display_order").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(""),
}, (table) => [
  index("idx_site_events_past_order").on(table.isPast, table.displayOrder),
]);

export const siteCommunitySpaces = sqliteTable("site_community_spaces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  icon: text("icon").notNull().default("sofa"),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  photos: text("photos").notNull().default("[]"),
  displayOrder: integer("display_order").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(""),
}, (table) => [
  index("idx_site_community_spaces_order").on(table.displayOrder),
]);

export const sitePageCopy = sqliteTable("site_page_copy", {
  page: text("page").primaryKey(),
  content: text("content").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(""),
});

// Staff/volunteer Splitwise (Cloudflare-only; not synced to Pi)
export const splitMembers = sqliteTable("split_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
  kind: text("kind").notNull().default("staff"),
  userId: integer("user_id"),
  employeeId: integer("employee_id"),
  isHouse: integer("is_house").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_split_members_user").on(table.userId).where(sql`${table.userId} is not null`),
  uniqueIndex("idx_split_members_house").on(table.isHouse).where(sql`${table.isHouse} = 1`),
  index("idx_split_members_active").on(table.isActive),
]);

export const splitGroups = sqliteTable("split_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const splitGroupMembers = sqliteTable("split_group_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull(),
  memberId: integer("member_id").notNull(),
}, (table) => [
  uniqueIndex("idx_split_group_members_unique").on(table.groupId, table.memberId),
  index("idx_split_group_members_group").on(table.groupId),
]);

export const splitExpenses = sqliteTable("split_expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull(),
  description: text("description").notNull(),
  totalAmount: integer("total_amount").notNull(),
  expenseDate: text("expense_date").notNull(),
  splitMethod: text("split_method").notNull().default("equal"),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  hostelExpenseId: integer("hostel_expense_id"),
  deletedAt: text("deleted_at"),
}, (table) => [
  index("idx_split_expenses_group_date").on(table.groupId, table.expenseDate),
  uniqueIndex("idx_split_expenses_hostel").on(table.hostelExpenseId).where(sql`${table.hostelExpenseId} is not null`),
]);

export const splitExpenseShares = sqliteTable("split_expense_shares", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  expenseId: integer("expense_id").notNull(),
  memberId: integer("member_id").notNull(),
  paidAmount: integer("paid_amount").notNull().default(0),
  owedAmount: integer("owed_amount").notNull().default(0),
}, (table) => [
  uniqueIndex("idx_split_expense_shares_unique").on(table.expenseId, table.memberId),
  index("idx_split_expense_shares_expense").on(table.expenseId),
]);

export const splitSettlements = sqliteTable("split_settlements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull(),
  fromMemberId: integer("from_member_id").notNull(),
  toMemberId: integer("to_member_id").notNull(),
  amount: integer("amount").notNull(),
  method: text("method").notNull().default("other"),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  hostelExpenseId: integer("hostel_expense_id"),
  splitExpenseId: integer("split_expense_id"),
  deletedAt: text("deleted_at"),
}, (table) => [
  index("idx_split_settlements_group").on(table.groupId),
  uniqueIndex("idx_split_settlements_hostel").on(table.hostelExpenseId).where(sql`${table.hostelExpenseId} is not null`),
]);
