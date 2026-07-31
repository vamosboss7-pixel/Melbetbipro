import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const scheduledBroadcastsTable = pgTable("scheduled_broadcasts", {
  id: serial("id").primaryKey(),
  message: text("message").notNull(),
  imageUrl: text("image_url"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  isDaily: boolean("is_daily").notNull().default(false),
  isSent: boolean("is_sent").notNull().default(false),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ScheduledBroadcast = typeof scheduledBroadcastsTable.$inferSelect;
