import { pgTable, serial, text, numeric, bigint, timestamp } from "drizzle-orm/pg-core";

export const autoDepositsTable = pgTable("auto_deposits", {
  id: serial("id").primaryKey(),
  transactionCode: text("transaction_code").notNull().unique(),
  amount: numeric("amount", { precision: 15, scale: 2 }),
  amountRequested: numeric("amount_requested", { precision: 15, scale: 2 }),
  telegramId: bigint("telegram_id", { mode: "number" }),
  firstName: text("first_name"),
  smsRaw: text("sms_raw"),
  smsReceivedAt: timestamp("sms_received_at"),
  botReceivedAt: timestamp("bot_received_at"),
  status: text("status").notNull().default("pending"),
  creditedAt: timestamp("credited_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

