import { pgTable, serial, bigint, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gameRoundsTable = pgTable("game_rounds", {
  id: serial("id").primaryKey(),
  roundId: text("round_id").notNull(),
  roomId: text("room_id").notNull().default("room1"), // "room1" = 10 Birr | "room2" = 5 Birr
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  cardIds: text("card_ids").notNull(), // JSON array stored as text e.g. "[12, 45]"
  stake: numeric("stake", { precision: 12, scale: 2 }).notNull().default("0"),
  result: text("result").notNull(), // "won" | "lost"
  prize: numeric("prize", { precision: 12, scale: 2 }).notNull().default("0"),
  winnersCount: integer("winners_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertGameRoundSchema = createInsertSchema(gameRoundsTable).omit({ id: true, createdAt: true });
export const selectGameRoundSchema = createSelectSchema(gameRoundsTable);

export type InsertGameRound = z.infer<typeof insertGameRoundSchema>;
export type GameRound = typeof gameRoundsTable.$inferSelect;
