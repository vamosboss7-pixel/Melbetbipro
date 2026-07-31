import { pgTable, serial, bigint, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const promoterApplicationsTable = pgTable("promoter_applications", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  firstName: text("first_name").notNull(),
  fullName: text("full_name").notNull(),
  gender: text("gender").notNull(),
  telegramUsername: text("telegram_username").notNull(),
  socialMediaPlatforms: text("social_media_platforms").notNull(),
  followerCount: text("follower_count").notNull(),
  message: text("message"),
  status: text("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPromoterApplicationSchema = createInsertSchema(promoterApplicationsTable).omit({
  id: true,
  status: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const selectPromoterApplicationSchema = createSelectSchema(promoterApplicationsTable);

export type InsertPromoterApplication = z.infer<typeof insertPromoterApplicationSchema>;
export type PromoterApplication = typeof promoterApplicationsTable.$inferSelect;
