import { pgTable, serial, text, bigint, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const depositCodeAttemptsTable = pgTable("deposit_code_attempts", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  transactionCode: text("transaction_code").notNull(),
  isValid: boolean("is_valid").notNull().default(false),
  attemptCount: integer("attempt_count").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDepositCodeAttemptSchema = createInsertSchema(depositCodeAttemptsTable).omit({
  id: true,
  createdAt: true,
});
export const selectDepositCodeAttemptSchema = createSelectSchema(depositCodeAttemptsTable);

export type InsertDepositCodeAttempt = z.infer<typeof insertDepositCodeAttemptSchema>;
export type DepositCodeAttempt = typeof depositCodeAttemptsTable.$inferSelect;
