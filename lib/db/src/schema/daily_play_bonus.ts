import { pgTable, serial, bigint, date, timestamp } from "drizzle-orm/pg-core";
import { uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Tracks per-player daily claims for the 10 ETB free play bonus.
// One row per (telegram_id, claim_date). Inserted on first claim; duplicate
// attempts are rejected by the unique index.
export const dailyPlayBonusClaimsTable = pgTable(
  "daily_play_bonus_claims",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    claimDate: date("claim_date").notNull(),
    claimedAt: timestamp("claimed_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dpb_player_date_uniq").on(t.telegramId, t.claimDate)],
);

export const insertDailyPlayBonusClaimSchema = createInsertSchema(
  dailyPlayBonusClaimsTable,
).omit({ id: true, claimedAt: true });

export type InsertDailyPlayBonusClaim = z.infer<typeof insertDailyPlayBonusClaimSchema>;
export type DailyPlayBonusClaim = typeof dailyPlayBonusClaimsTable.$inferSelect;
