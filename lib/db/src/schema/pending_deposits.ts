import { pgTable, serial, bigint, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pendingDepositsTable = pgTable("pending_deposits", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  firstName: text("first_name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "approved" | "rejected"
  confirmationText: text("confirmation_text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPendingDepositSchema = createInsertSchema(pendingDepositsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectPendingDepositSchema = createSelectSchema(pendingDepositsTable);

export type InsertPendingDeposit = z.infer<typeof insertPendingDepositSchema>;
export type PendingDeposit = typeof pendingDepositsTable.$inferSelect;
