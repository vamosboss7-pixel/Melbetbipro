import { pgTable, serial, bigint, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pendingWithdrawalsTable = pgTable("pending_withdrawals", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  firstName: text("first_name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  phone: text("phone").notNull(),
  accountName: text("account_name").notNull().default(""),
  status: text("status").notNull().default("pending"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPendingWithdrawalSchema = createInsertSchema(pendingWithdrawalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectPendingWithdrawalSchema = createSelectSchema(pendingWithdrawalsTable);

export type InsertPendingWithdrawal = z.infer<typeof insertPendingWithdrawalSchema>;
export type PendingWithdrawal = typeof pendingWithdrawalsTable.$inferSelect;
