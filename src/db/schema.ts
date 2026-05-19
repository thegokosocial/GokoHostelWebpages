import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  createdMonth: text("created_month").notNull(),
}, (table) => [
  index("idx_checkins_month").on(table.createdMonth),
  index("idx_checkins_contact").on(table.contact),
  index("idx_checkins_arrival").on(table.arrivalDate),
]);

export const dorms = sqliteTable("dorms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
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
}, (table) => [
  index("idx_history_action").on(table.action),
  index("idx_history_dorm").on(table.dormName),
]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const apiStats = sqliteTable("api_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  month: text("month").notNull().unique(),
  vision: integer("vision").notNull().default(0),
  sheets: integer("sheets").notNull().default(0),
  drive: integer("drive").notNull().default(0),
  total: integer("total").notNull().default(0),
});
