import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";

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

// Ephemeral cloud-only booking email verification; excluded from Pi synchronization.
export const guestBookingLookupChallenges = sqliteTable("guest_booking_lookup_challenges", {
  id: text("id").primaryKey().notNull(), requestKey: text("request_key").notNull().unique(),
  bookingId: integer("booking_id").notNull().references(() => bookings.id), codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at").notNull(), attempts: integer("attempts").notNull().default(0), used: integer("used").notNull().default(0),
}, table => [check("guest_lookup_attempts", sql`${table.attempts} BETWEEN 0 AND 5`), check("guest_lookup_used", sql`${table.used} IN (0,1)`)]);

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
  bookingResolution: text("booking_resolution").notNull().default("pending"),
  bookingLinkedRef: text("booking_linked_ref").default(""),
  bookingResolutionAt: text("booking_resolution_at").default(""),
  bookingResolutionBy: text("booking_resolution_by").default(""),
  dob: text("dob").default(""),
  dobFromId: text("dob_from_id").default(""),
  vibeMatched: integer("vibe_matched").notNull().default(0),
  createdMonth: text("created_month").notNull(),
  idempotencyKey: text("idempotency_key"),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_checkins_month").on(table.createdMonth),
  index("idx_checkins_contact").on(table.contact),
  index("idx_checkins_arrival").on(table.arrivalDate),
  index("idx_checkins_status").on(table.status),
  uniqueIndex("idx_checkins_idempotency").on(table.idempotencyKey),
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
  checkinId: integer("checkin_id").references(() => checkins.id),
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

// Test gateway evidence is intentionally excluded from Cloudflare/Pi sync.
// Internal hold primitive: not exposed to guests or synchronized to Pi.
export const nativeInventoryHolds = sqliteTable("native_inventory_holds", {
  id: text("id").primaryKey(), requestKey: text("request_key").notNull().unique(),
  requestHash: text("request_hash").notNull(), ownerHash: text("owner_hash").notNull(),
  bedIds: text("bed_ids").notNull(), checkinDate: text("checkin_date").notNull(), checkoutDate: text("checkout_date").notNull(),
  expiresAt: integer("expires_at").notNull(), state: text("state").notNull().default("held"), createdAt: integer("created_at").notNull(),
  /** When set, hold insert may overlap this booking's own assignments (guest amend). */
  excludeBookingId: integer("exclude_booking_id"),
}, (t) => [index("idx_native_hold_dates").on(t.state, t.checkinDate, t.checkoutDate, t.expiresAt),
  check("native_hold_beds", sql`json_valid(${t.bedIds}) AND json_type(${t.bedIds}) = 'array' AND json_array_length(${t.bedIds}) BETWEEN 1 AND 4`),
  check("native_hold_dates", sql`${t.checkoutDate} > ${t.checkinDate}`),
  check("native_hold_state", sql`${t.state} IN ('held','released')`),
  check("native_hold_expiry", sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + 900`),
]);

export const nativeAcceptedQuotes = sqliteTable("native_accepted_quotes", {
  id: text("id").primaryKey().notNull(),
  holdId: text("hold_id").notNull().unique().references(() => nativeInventoryHolds.id),
  quoteJson: text("quote_json").notNull(), acceptedAt: integer("accepted_at").notNull(),
}, (t) => [check("native_quote_json", sql`json_valid(${t.quoteJson}) AND json_type(${t.quoteJson}) = 'object'`)]);

export const gatewayPreviewAttempts = sqliteTable("gateway_preview_attempts", {
  id: text("id").primaryKey(), requestKey: text("request_key").notNull().unique(),
  environment: text("environment").notNull().default("test"), keyId: text("key_id").notNull(),
  receipt: text("receipt").notNull().unique(), amountPaise: integer("amount_paise").notNull().default(100),
  orderId: text("order_id").unique(), state: text("state").notNull().default("creating"),
  checkoutStartedAt: text("checkout_started_at"),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [
  check("gateway_preview_test_only", sql`${t.environment} = 'test'`),
  check("gateway_preview_test_key", sql`${t.keyId} LIKE 'rzp_test_%'`),
  check("gateway_preview_fixed_amount", sql`${t.amountPaise} = 100`),
  check("gateway_preview_attempt_state", sql`${t.state} IN ('creating','order_unknown','created')`),
]);
export const gatewayPreviewPayments = sqliteTable("gateway_preview_payments", {
  id: text("id").primaryKey(), attemptId: text("attempt_id").notNull().references(() => gatewayPreviewAttempts.id),
  amountPaise: integer("amount_paise").notNull(), status: text("status").notNull(),
  captured: integer("captured").notNull().default(0), refundedPaise: integer("refunded_paise").notNull().default(0),
  verifiedAt: text("verified_at").notNull(),
}, (t) => [index("idx_gateway_preview_payments_attempt").on(t.attemptId),
  check("gateway_preview_payment_amount", sql`${t.amountPaise} = 100`),
  check("gateway_preview_payment_status", sql`${t.status} IN ('created','authorized','captured','refunded','failed')`),
  check("gateway_preview_captured_flag", sql`${t.captured} IN (0,1)`),
  check("gateway_preview_refunded_amount", sql`${t.refundedPaise} BETWEEN 0 AND 100`),
]);
export const gatewayPreviewRefunds = sqliteTable("gateway_preview_refunds", {
  paymentId: text("payment_id").primaryKey().references(() => gatewayPreviewPayments.id),
  id: text("id").notNull().unique(), receipt: text("receipt").notNull().unique(), providerId: text("provider_id").unique(),
  state: text("state").notNull().default("submitting"), createdBy: text("created_by").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [check("gateway_preview_refund_state", sql`${t.state} IN ('submitting','unknown','pending','processed','failed')`)]);
export const gatewayPreviewWebhooks = sqliteTable("gateway_preview_webhooks", {
  eventId: text("event_id").primaryKey(), payloadHash: text("payload_hash").notNull(), eventType: text("event_type").notNull(),
  orderId: text("order_id"), paymentId: text("payment_id"), attemptId: text("attempt_id"),
  state: text("state").notNull().default("received"), receivedAt: text("received_at").notNull(), updatedAt: text("updated_at").notNull(),
  refundId: text("refund_id"),
}, (t) => [index("idx_gateway_preview_webhooks_state").on(t.state, t.receivedAt),
  check("gateway_preview_webhook_state", sql`${t.state} IN ('received','retry','processed','ignored')`),
]);

// Guest checkout ledger — Cloudflare-only; excluded from Pi sync allowlist by omission.
export const nativeBookingCheckouts = sqliteTable("native_booking_checkouts", {
  id: text("id").primaryKey(),
  requestKey: text("request_key").notNull().unique(),
  requestHash: text("request_hash").notNull(),
  ownerHash: text("owner_hash").notNull(),
  guestAccessHash: text("guest_access_hash").notNull(),
  bookingId: integer("booking_id"),
  holdId: text("hold_id"),
  acceptedQuoteId: text("accepted_quote_id"),
  /** When set, this checkout amends an existing fulfilled website booking (same bookingId). */
  amendsCheckoutId: text("amends_checkout_id"),
  paymentChoice: text("payment_choice").notNull(),
  environment: text("environment").notNull().default("test"),
  state: text("state").notNull().default("preparing"),
  razorpayOrderId: text("razorpay_order_id").unique(),
  razorpayKeyId: text("razorpay_key_id"),
  receipt: text("receipt").unique(),
  dueNowPaise: integer("due_now_paise").notNull(),
  checkoutStartedAt: text("checkout_started_at"),
  closureReason: text("closure_reason"),
  guestName: text("guest_name").notNull(),
  guestEmail: text("guest_email").notNull(),
  guestPhone: text("guest_phone").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  index("idx_native_checkout_state").on(t.state, t.updatedAt),
  index("idx_native_checkout_booking").on(t.bookingId),
  index("idx_native_checkout_amends").on(t.amendsCheckoutId),
  check("native_checkout_choice", sql`${t.paymentChoice} IN ('advance','full','property')`),
  check("native_checkout_env", sql`${t.environment} IN ('test','live')`),
  check("native_checkout_state", sql`${t.state} IN ('preparing','order_unknown','ready','claimed','captured','fulfilled','captured_unfulfilled','cancelled','expired')`),
  check("native_checkout_test_key", sql`${t.environment} != 'test' OR (${t.razorpayKeyId} IS NULL OR ${t.razorpayKeyId} LIKE 'rzp_test_%')`),
  check("native_checkout_due", sql`${t.dueNowPaise} = 0 OR ${t.dueNowPaise} >= 100`),
  check("native_checkout_closure", sql`${t.closureReason} IS NULL OR ${t.closureReason} IN ('guest_cancelled','hold_expired','cannot_fulfil')`),
]);
export const nativeBookingPayments = sqliteTable("native_booking_payments", {
  id: text("id").primaryKey(),
  checkoutId: text("checkout_id").notNull().references(() => nativeBookingCheckouts.id),
  amountPaise: integer("amount_paise").notNull(),
  status: text("status").notNull(),
  captured: integer("captured").notNull().default(0),
  refundedPaise: integer("refunded_paise").notNull().default(0),
  feePaise: integer("fee_paise"),
  taxPaise: integer("tax_paise"),
  verifiedAt: text("verified_at").notNull(),
}, (t) => [
  index("idx_native_booking_payments_checkout").on(t.checkoutId),
  check("native_payment_amount", sql`${t.amountPaise} >= 100`),
  check("native_payment_status", sql`${t.status} IN ('created','authorized','captured','refunded','failed')`),
  check("native_payment_captured", sql`${t.captured} IN (0,1)`),
  check("native_payment_refunded", sql`${t.refundedPaise} >= 0 AND ${t.refundedPaise} <= ${t.amountPaise}`),
  check("native_payment_fee", sql`${t.feePaise} IS NULL OR ${t.feePaise} >= 0`),
  check("native_payment_tax", sql`${t.taxPaise} IS NULL OR ${t.taxPaise} >= 0`),
]);
export const nativeBookingRefunds = sqliteTable("native_booking_refunds", {
  paymentId: text("payment_id").primaryKey().references(() => nativeBookingPayments.id),
  id: text("id").notNull().unique(),
  receipt: text("receipt").notNull().unique(),
  providerId: text("provider_id").unique(),
  amountPaise: integer("amount_paise").notNull(),
  state: text("state").notNull().default("submitting"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  check("native_refund_amount", sql`${t.amountPaise} >= 100`),
  check("native_refund_state", sql`${t.state} IN ('submitting','unknown','pending','processed','failed')`),
]);
export const nativeBookingWebhooks = sqliteTable("native_booking_webhooks", {
  eventId: text("event_id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  eventType: text("event_type").notNull(),
  orderId: text("order_id"),
  paymentId: text("payment_id"),
  refundId: text("refund_id"),
  checkoutId: text("checkout_id"),
  state: text("state").notNull().default("received"),
  receivedAt: text("received_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  index("idx_native_booking_webhooks_state").on(t.state, t.receivedAt),
  check("native_webhook_state", sql`${t.state} IN ('received','retry','processed','ignored')`),
]);

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

/** Server-side staff sessions. Deliberately excluded from Cloudflare/Pi sync. */
export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  username: text("username").notNull(),
  role: text("role").notNull(),
  displayName: text("display_name").notNull(),
  permissions: text("permissions").notNull().default("{}"),
  scope: text("scope").notNull().default("admin"),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  revokedAt: text("revoked_at"),
});

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  taskType: text("task_type").notNull().default("general"),
  category: text("category").notNull().default(""),
  priority: text("priority").notNull().default("normal"),
  dueDate: text("due_date").default(""),
  assigneeUserId: integer("assignee_user_id").references(() => users.id),
  status: text("status").notNull().default("todo"),
  note: text("note").notNull().default(""),
  attachments: text("attachments").notNull().default("[]"),
  followerUsernames: text("follower_usernames").notNull().default("[]"),
  completedAt: text("completed_at").default(""),
  completedBy: text("completed_by").default(""),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_tasks_assignee").on(table.assigneeUserId),
  index("idx_tasks_status").on(table.status),
  index("idx_tasks_due_date").on(table.dueDate),
]);

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
  // Explicit channel payment terms/currency. `currency` may be defaulted for legacy UI and
  // must never be used to infer that an OTA supplied INR.
  otaPaymentTerms: text("ota_payment_terms"),
  otaCurrency: text("ota_currency"),
  paymentOverride: integer("payment_override").notNull().default(0),
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
  bookingCycle: integer("booking_cycle").notNull().default(1),

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

export const bookingContactMethods = sqliteTable("booking_contact_methods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull().references(() => bookings.id),
  type: text("type").notNull(),
  value: text("value").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  label: text("label").notNull().default(""),
  origin: text("origin").notNull().default("custom"),
  isPrimary: integer("is_primary").notNull().default(0),
  position: integer("position").notNull().default(0),
  deletedAt: text("deleted_at"),
  ...syncColumns,
}, (table) => [
  index("idx_booking_contacts_booking").on(table.bookingId, table.deletedAt),
  uniqueIndex("idx_booking_contacts_value").on(table.bookingId, table.type, table.normalizedValue, table.deletedAt),
  check("booking_contact_type", sql`${table.type} IN ('phone','email')`),
  check("booking_contact_origin", sql`${table.origin} IN ('pms','custom')`),
]);

/** Append-only Goko-collected payments for OTA postpaid stays. Amounts are paise. */
export const bookingPaymentEvents = sqliteTable("booking_payment_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().unique(),
  bookingId: integer("booking_id").notNull().references(() => bookings.id),
  bookingCycle: integer("booking_cycle").notNull(),
  eventType: text("event_type").notNull(), // collection | refund | correction
  amountPaise: integer("amount_paise").notNull(),
  cashPaise: integer("cash_paise").notNull().default(0),
  onlinePaise: integer("online_paise").notNull().default(0),
  unknownPaise: integer("unknown_paise").notNull().default(0),
  cashTenderPaise: integer("cash_tender_paise").notNull().default(0),
  changePaise: integer("change_paise").notNull().default(0),
  accountId: integer("account_id").references(() => accounts.id),
  currency: text("currency").notNull().default("INR"),
  otaPaymentTerms: text("ota_payment_terms").notNull(),
  businessDate: text("business_date"),
  isOpening: integer("is_opening").notNull().default(0),
  correctsEventId: text("corrects_event_id"),
  guestNameSnapshot: text("guest_name_snapshot").notNull(),
  bookingRefSnapshot: text("booking_ref_snapshot").notNull().default(""),
  platformSnapshot: text("platform_snapshot").notNull().default(""),
  checkinDateSnapshot: text("checkin_date_snapshot").notNull(),
  checkoutDateSnapshot: text("checkout_date_snapshot").notNull().default(""),
  note: text("note").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_booking_payment_events_cycle").on(table.bookingId, table.bookingCycle),
  index("idx_booking_payment_events_date").on(table.businessDate),
  index("idx_booking_payment_events_account_date").on(table.accountId, table.businessDate),
  uniqueIndex("idx_booking_payment_events_sync_id").on(table.syncId),
]);

/** Immutable stay/guest context archived before an OTA booking row is reused. */
export const bookingCycleSnapshots = sqliteTable("booking_cycle_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  snapshotId: text("snapshot_id").notNull().unique(),
  bookingId: integer("booking_id").notNull().references(() => bookings.id),
  bookingCycle: integer("booking_cycle").notNull(),
  guestName: text("guest_name").notNull(),
  contact: text("contact").notNull().default(""),
  bookingRef: text("booking_ref").notNull().default(""),
  platform: text("platform").notNull().default(""),
  checkinDate: text("checkin_date").notNull(),
  checkoutDate: text("checkout_date").notNull().default(""),
  status: text("status").notNull(),
  bookingCreatedAt: text("booking_created_at").notNull().default(""),
  checkedInAt: text("checked_in_at").notNull().default(""),
  checkedOutAt: text("checked_out_at").notNull().default(""),
  persons: integer("persons").notNull().default(1),
  roomType: text("room_type").notNull().default(""),
  amountBeforeTaxPaise: integer("amount_before_tax_paise").notNull().default(0),
  amountTaxPaise: integer("amount_tax_paise").notNull().default(0),
  amountTotalPaise: integer("amount_total_paise").notNull().default(0),
  amountPaidPaise: integer("amount_paid_paise").notNull().default(0),
  amountRefundedPaise: integer("amount_refunded_paise").notNull().default(0),
  paymentStatus: text("payment_status").notNull().default("unknown"),
  paymentMethod: text("payment_method").notNull().default(""),
  cashReceivedPaise: integer("cash_received_paise").notNull().default(0),
  refundMethod: text("refund_method").notNull().default(""),
  refundCashPaise: integer("refund_cash_paise").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  otaCurrency: text("ota_currency"),
  otaPaymentTerms: text("ota_payment_terms"),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  uniqueIndex("idx_booking_cycle_snapshots_booking_cycle").on(table.bookingId, table.bookingCycle),
  uniqueIndex("idx_booking_cycle_snapshots_sync_id").on(table.syncId),
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
  priceOnRequest: integer("price_on_request").notNull().default(0),
  indicativeMinPrice: integer("indicative_min_price").notNull().default(0),
  indicativeMaxPrice: integer("indicative_max_price").notNull().default(0),
  priceBasis: text("price_basis").notNull().default("per portion"),
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
  amountPaid: integer("amount_paid").notNull().default(0),
  amountRefunded: integer("amount_refunded").notNull().default(0),
  refundMethod: text("refund_method").notNull().default(""),
  refundCash: integer("refund_cash").notNull().default(0),
  refundedAt: text("refunded_at").notNull().default(""),
  refundedBy: text("refunded_by").notNull().default(""),
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
  pricingStatus: text("pricing_status").notNull().default("fixed"),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("active"),
  ...syncColumns,
}, (table) => [
  index("idx_food_order_items_order").on(table.orderId),
]);

/** Opaque My Bills share links — Cloudflare-only, not Pi-synced. */
export const foodBillShareTokens = sqliteTable("food_bill_share_tokens", {
  token: text("token").primaryKey(),
  phone: text("phone").notNull(),
  checkinId: integer("checkin_id"),
  walkinNameKey: text("walkin_name_key"),
  expiresAt: text("expires_at").notNull(),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_food_bill_share_phone").on(table.phone),
  index("idx_food_bill_share_expires").on(table.expiresAt),
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

/** Idempotent, atomic batches of food-order edits. The request body is retained
 * so a safe retry can return success without applying the batch twice. */
export const foodOrderEditBatches = sqliteTable("food_order_edit_batches", {
  operationId: text("operation_id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => foodOrders.id),
  requestJson: text("request_json").notNull(),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_food_order_edit_batches_order").on(table.orderId, table.createdAt),
]);

/** Append-only manual food payment/refund journal. Amounts are paise. */
export const foodPaymentEvents = sqliteTable("food_payment_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().unique(),
  orderId: integer("order_id").notNull().references(() => foodOrders.id),
  eventType: text("event_type").notNull(), // refund | correction
  amountPaise: integer("amount_paise").notNull(),
  cashPaise: integer("cash_paise").notNull().default(0),
  onlinePaise: integer("online_paise").notNull().default(0),
  accountId: integer("account_id").references(() => accounts.id),
  note: text("note").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_food_payment_events_order").on(table.orderId, table.createdAt),
  index("idx_food_payment_events_account_date").on(table.accountId, table.createdAt),
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
  isVirtual: integer("is_virtual").notNull().default(0),
  platformKey: text("platform_key").default(""),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_accounts_active").on(table.isActive),
  index("idx_accounts_virtual").on(table.isVirtual),
]);

/** Configurable channel rules. Amounts in dependent financial tables are paise. */
export const platformPaymentProfiles = sqliteTable("platform_payment_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platformKey: text("platform_key").notNull().unique(),
  displayName: text("display_name").notNull(),
  defaultPaymentMode: text("default_payment_mode").notNull().default("unknown"),
  virtualAccountId: integer("virtual_account_id").notNull().references(() => accounts.id),
  currency: text("currency").notNull().default("INR"),
  taxTreatment: text("tax_treatment").notNull().default("tax_charged_not_withheld"),
  deductionPolicy: text("deduction_policy").notNull().default("{}"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  ...syncColumnsWithDelete,
}, (table) => [index("idx_platform_profiles_active").on(table.isActive)]);

/** Immutable booking-side receivable/reversal journal. All amounts are paise. */
export const platformReceivableEntries = sqliteTable("platform_receivable_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: integer("booking_id").notNull().references(() => bookings.id),
  bookingCycle: integer("booking_cycle").notNull().default(1),
  platformKey: text("platform_key").notNull(),
  eventKey: text("event_key").notNull().unique(),
  entryType: text("entry_type").notNull(), // recognition | adjustment | reversal
  grossPaise: integer("gross_paise").notNull().default(0),
  taxChargedPaise: integer("tax_charged_paise").notNull().default(0),
  taxWithheldPaise: integer("tax_withheld_paise").notNull().default(0),
  commissionPaise: integer("commission_paise").notNull().default(0),
  tdsPaise: integer("tds_paise").notNull().default(0),
  tcsPaise: integer("tcs_paise").notNull().default(0),
  otherDeductionsPaise: integer("other_deductions_paise").notNull().default(0),
  expectedNetPaise: integer("expected_net_paise").notNull().default(0),
  recognitionDate: text("recognition_date").notNull(),
  reason: text("reason").notNull().default(""),
  sourcePayload: text("source_payload").notNull().default(""),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_platform_receivables_booking").on(table.bookingId, table.bookingCycle),
  index("idx_platform_receivables_platform").on(table.platformKey, table.recognitionDate),
]);

/** A real bank payout header; the actual bank date drives reconciliation. */
export const platformSettlements = sqliteTable("platform_settlements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platformKey: text("platform_key").notNull(),
  bankAccountId: integer("bank_account_id").notNull().references(() => accounts.id),
  receiptId: text("receipt_id").notNull().unique(),
  payoutDate: text("payout_date").notNull(),
  actualAmountPaise: integer("actual_amount_paise").notNull(),
  reference: text("reference").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [index("idx_platform_settlements_date").on(table.payoutDate, table.platformKey)]);

/** Allocation of a payout to one booking-cycle receivable. */
export const platformSettlementAllocations = sqliteTable("platform_settlement_allocations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  settlementId: integer("settlement_id").notNull().references(() => platformSettlements.id),
  bookingId: integer("booking_id").notNull().references(() => bookings.id),
  bookingCycle: integer("booking_cycle").notNull().default(1),
  allocationKey: text("allocation_key").notNull().unique(),
  allocatedPaise: integer("allocated_paise").notNull(),
  varianceType: text("variance_type").notNull().default("none"),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_platform_allocations_settlement").on(table.settlementId),
  index("idx_platform_allocations_booking").on(table.bookingId, table.bookingCycle),
]);

/** Cloudflare-only allocation of a Razorpay payout to a direct website payment. */
export const gatewaySettlementAllocations = sqliteTable("gateway_settlement_allocations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  settlementId: integer("settlement_id").notNull().references(() => platformSettlements.id),
  paymentId: text("payment_id").notNull().references(() => nativeBookingPayments.id),
  allocationKey: text("allocation_key").notNull().unique(),
  allocatedPaise: integer("allocated_paise").notNull(),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  index("idx_gateway_allocations_settlement").on(t.settlementId),
  index("idx_gateway_allocations_payment").on(t.paymentId),
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
  idempotencyKey: text("idempotency_key"),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_daily_income_date").on(table.date),
  index("idx_daily_income_account").on(table.accountId),
  index("idx_daily_income_account_date").on(table.accountId, table.date),
  uniqueIndex("idx_daily_income_idempotency").on(table.idempotencyKey),
]);

/** Immutable automatic online guest-receipt journal. Amounts are paise. */
export const guestReceipts = sqliteTable("guest_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptId: text("receipt_id").notNull().unique(),
  operationId: text("operation_id"),
  sourceType: text("source_type").notNull(), // food_order | booking | platform_settlement
  sourceId: integer("source_id").notNull(),
  kind: text("kind").notNull(), // food | stay | ota_prepaid | refund | reversal | platform_settlement
  accountId: integer("account_id").notNull().references(() => accounts.id),
  amount: integer("amount").notNull(), // positive receipt, negative reversal/refund
  businessDate: text("business_date").notNull(),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  bookingEventId: text("booking_event_id"),
  guestNameSnapshot: text("guest_name_snapshot"),
  bookingRefSnapshot: text("booking_ref_snapshot"),
  platformSnapshot: text("platform_snapshot"),
  checkinDateSnapshot: text("checkin_date_snapshot"),
  checkoutDateSnapshot: text("checkout_date_snapshot"),
  bookingCycleSnapshot: integer("booking_cycle_snapshot"),
  ...syncColumns,
}, (table) => [
  index("idx_guest_receipts_date_account").on(table.businessDate, table.accountId),
  index("idx_guest_receipts_account_date").on(table.accountId, table.businessDate),
  index("idx_guest_receipts_source").on(table.sourceType, table.sourceId),
  index("idx_guest_receipts_operation").on(table.operationId),
]);

/** Append-only cash portions of ordinary food and room payments. Amounts are signed paise. */
export const cashPaymentEvents = sqliteTable("cash_payment_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().unique(),
  operationId: text("operation_id").notNull(),
  sourceType: text("source_type").notNull(), // food_order | booking
  sourceId: integer("source_id").notNull(),
  eventType: text("event_type").notNull(), // collection | refund | correction
  amountPaise: integer("amount_paise").notNull(), // signed; refunds/correction reversals are negative
  businessDate: text("business_date").notNull(),
  correctsEventId: text("corrects_event_id"),
  guestNameSnapshot: text("guest_name_snapshot").notNull().default(""),
  referenceSnapshot: text("reference_snapshot").notNull().default(""),
  note: text("note").notNull().default(""),
  actor: text("actor").notNull(),
  createdAt: text("created_at").notNull(),
  ...syncColumns,
}, (table) => [
  index("idx_cash_payment_events_operation").on(table.operationId),
  index("idx_cash_payment_events_date").on(table.businessDate),
  index("idx_cash_payment_events_source").on(table.sourceType, table.sourceId),
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
  taskId: integer("task_id").references(() => tasks.id),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").default(""),
  expenseDate: text("expense_date").notNull().default(""),
  createdMonth: text("created_month").notNull(),
  idempotencyKey: text("idempotency_key"),
  ...syncColumnsWithDelete,
}, (table) => [
  index("idx_expenses_month").on(table.createdMonth),
  index("idx_expenses_created").on(table.createdAt),
  index("idx_expenses_expense_date").on(table.expenseDate),
  index("idx_expenses_account_date").on(table.accountId, table.expenseDate),
  index("idx_expenses_created_by").on(table.createdBy),
  uniqueIndex("idx_expenses_task_unique").on(table.taskId),
  uniqueIndex("idx_expenses_idempotency").on(table.idempotencyKey),
]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  keyP256dh: text("key_p256dh").notNull(),
  keyAuth: text("key_auth").notNull(),
  userLabel: text("user_label").default(""),
  mutedNotificationTypes: text("muted_notification_types").notNull().default("[]"),
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

export const siteRoomContent = sqliteTable("site_room_content", {
  dormId: integer("dorm_id").primaryKey().references(() => dorms.id, { onDelete: "cascade" }),
  publicName: text("public_name").notNull().default(""),
  description: text("description").notNull().default(""),
  amenities: text("amenities").notNull().default("[]"),
  roomPhotos: text("room_photos").notNull().default("[]"),
  washroomPhotos: text("washroom_photos").notNull().default("[]"),
  updatedAt: text("updated_at").notNull().default(""),
});

export const sitePropertyContent = sqliteTable("site_property_content", {
  id: integer("id").primaryKey(),
  exteriorPhotos: text("exterior_photos").notNull().default("[]"),
  commonPhotos: text("common_photos").notNull().default("[]"),
  washroomPhotos: text("washroom_photos").notNull().default("[]"),
  updatedAt: text("updated_at").notNull().default(""),
});

/** Hero video library (Cloudflare-only; not synced to Pi). */
export const siteHeroVideos = sqliteTable("site_hero_videos", {
  id: text("id").primaryKey(),
  slot: text("slot").notNull(),
  label: text("label").notNull().default(""),
  url: text("url").notNull(),
  posterUrl: text("poster_url").notNull().default(""),
  bytes: integer("bytes").notNull().default(0),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
}, (table) => [
  index("idx_site_hero_videos_slot").on(table.slot),
]);

/** Per-page hero assignment (desktop + mobile library ids or builtin:* sentinels). */
export const sitePageHeroes = sqliteTable("site_page_heroes", {
  page: text("page").primaryKey(),
  desktopVideoId: text("desktop_video_id").notNull().default(""),
  mobileVideoId: text("mobile_video_id").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});

export const quickLinkSections = sqliteTable("quick_link_sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_quick_link_sections_order").on(table.displayOrder)]);

export const quickLinks = sqliteTable("quick_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sectionId: integer("section_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  url: text("url").notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_quick_links_section_order").on(table.sectionId, table.displayOrder),
]);

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
  idempotencyKey: text("idempotency_key"),
}, (table) => [
  index("idx_split_expenses_group_date").on(table.groupId, table.expenseDate),
  uniqueIndex("idx_split_expenses_hostel").on(table.hostelExpenseId).where(sql`${table.hostelExpenseId} is not null`),
  uniqueIndex("idx_split_expenses_idempotency").on(table.idempotencyKey),
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
