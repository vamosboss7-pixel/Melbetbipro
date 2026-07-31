import { pgTable, serial, bigint, integer, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailyCheckinsTable = pgTable("daily_checkins", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  currentStreak: integer("current_streak").notNull().default(0),
  lastCheckinDate: date("last_checkin_date"), // ISO date string "YYYY-MM-DD"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDailyCheckinSchema = createInsertSchema(dailyCheckinsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectDailyCheckinSchema = createSelectSchema(dailyCheckinsTable);

export type InsertDailyCheckin = z.infer<typeof insertDailyCheckinSchema>;
export type DailyCheckin = typeof dailyCheckinsTable.$inferSelect;
