import { pgTable, serial, bigint, integer, numeric, timestamp, boolean, text, uniqueIndex } from "drizzle-orm/pg-core";

// One active row per 10-game batch
export const jackpotBatchesTable = pgTable("jackpot_batches", {
  id: serial("id").primaryKey(),
  batchNumber: integer("batch_number").notNull(),
  gameCount: integer("game_count").notNull().default(0),
  jackpotPool: numeric("jackpot_pool", { precision: 12, scale: 2 }).notNull().default("0.00"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Cumulative points per player per batch
// Points formula (Option A + Streak):
//   participation = cards × 4
//   win bonus     = cards × 3  (if winner)
//   streak bonus  = min(streakCount, 8)  (+1 per consecutive game, max 8)
// UNIQUE(batch_id, telegram_id) enforces one row per player per batch — safe for upsert.
export const jackpotPointsTable = pgTable("jackpot_points", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  batchNumber: integer("batch_number").notNull(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  firstName: text("first_name").notNull(),
  points: integer("points").notNull().default(0),
  streakCount: integer("streak_count").notNull().default(1),
  lastGameCount: integer("last_game_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("jackpot_points_batch_player_uidx").on(t.batchId, t.telegramId),
]);

// One row per completed round — prevents double-processing on crash/retry.
// INSERT succeeds exactly once; a conflicting retry rolls back immediately.
export const jackpotRoundLogTable = pgTable("jackpot_round_log", {
  roundId: text("round_id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  gameCount: integer("game_count").notNull(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});

export type JackpotBatch = typeof jackpotBatchesTable.$inferSelect;
export type JackpotPoints = typeof jackpotPointsTable.$inferSelect;
export type JackpotRoundLog = typeof jackpotRoundLogTable.$inferSelect;
