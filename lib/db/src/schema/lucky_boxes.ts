import { pgTable, serial, text, numeric, integer, bigint, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const luckyBoxSessionsTable = pgTable("lucky_box_sessions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  imageBase64: text("image_base64"),
  totalBoxes: integer("total_boxes").notNull(),
  amountPerBox: numeric("amount_per_box", { precision: 12, scale: 2 }).notNull(),
  claimedCount: integer("claimed_count").notNull().default(0),
  status: text("status").notNull().default("active"),
  channelMessageId: bigint("channel_message_id", { mode: "number" }),
  createdBy: bigint("created_by", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const luckyBoxClaimsTable = pgTable("lucky_box_claims", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  boxNumber: integer("box_number").notNull(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  firstName: text("first_name").notNull(),
  username: text("username"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  claimedAt: timestamp("claimed_at").notNull().defaultNow(),
});

export const insertLuckyBoxSessionSchema = createInsertSchema(luckyBoxSessionsTable).omit({ id: true, claimedCount: true, channelMessageId: true, createdAt: true });
export const selectLuckyBoxSessionSchema = createSelectSchema(luckyBoxSessionsTable);

export type InsertLuckyBoxSession = z.infer<typeof insertLuckyBoxSessionSchema>;
export type LuckyBoxSession = typeof luckyBoxSessionsTable.$inferSelect;
export type LuckyBoxClaim = typeof luckyBoxClaimsTable.$inferSelect;
