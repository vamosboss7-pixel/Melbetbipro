import { pgTable, serial, bigint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const playerAchievementsTable = pgTable(
  "player_achievements",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
    achievementId: text("achievement_id").notNull(), // e.g. "games_20", "invite_10"
    claimedAt: timestamp("claimed_at").notNull().defaultNow(),
  },
  (t) => [
    // DB-level uniqueness guarantee — prevents duplicate awards under any race condition
    uniqueIndex("player_achievements_telegram_achievement_uidx").on(
      t.telegramId,
      t.achievementId,
    ),
  ],
);

export const insertPlayerAchievementSchema = createInsertSchema(playerAchievementsTable).omit({ id: true, claimedAt: true });
export const selectPlayerAchievementSchema = createSelectSchema(playerAchievementsTable);

export type InsertPlayerAchievement = z.infer<typeof insertPlayerAchievementSchema>;
export type PlayerAchievement = typeof playerAchievementsTable.$inferSelect;
