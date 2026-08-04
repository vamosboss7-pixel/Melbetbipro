import { pgTable, text, bigint, timestamp, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const playersTable = pgTable("players", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  photoUrl: text("photo_url"),
  // Main balance: real deposited ETB, withdrawable.
  mainBalance: numeric("main_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  // Bonus balance: registration bonus, promo credits, and winnings earned from bonus funds.
  // Non-withdrawable until wagering requirement is met.
  bonusBalance: numeric("bonus_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  // Wagering fields — track rollover requirement before bonus can be withdrawn.
  wageringRequired: numeric("wagering_required", { precision: 12, scale: 2 }).notNull().default("0.00"),
  wageringCompleted: numeric("wagering_completed", { precision: 12, scale: 2 }).notNull().default("0.00"),
  hasActiveWagering: boolean("has_active_wagering").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  invitedBy: bigint("invited_by", { mode: "number" }),
  totalInviteBonus: numeric("total_invite_bonus", { precision: 12, scale: 2 }).notNull().default("0.00"),
  role: text("role").notNull().default("player"),
  agentBalance: numeric("agent_balance", { precision: 12, scale: 2 }).notNull().default("0.00"),
  hasClaimedChannelBonus: boolean("has_claimed_channel_bonus").notNull().default(false),
  // Balance preference: which balance to deduct from first when paying stakes.
  // 'main_first' (default) = deduct mainBalance first, then bonusBalance for remainder.
  // 'bonus_first' = deduct bonusBalance first, then mainBalance for remainder.
  preferredBalance: text("preferred_balance").notNull().default("main_first"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlayerSchema = createInsertSchema(playersTable).omit({
  createdAt: true,
  updatedAt: true,
});

export const selectPlayerSchema = createSelectSchema(playersTable);

export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
