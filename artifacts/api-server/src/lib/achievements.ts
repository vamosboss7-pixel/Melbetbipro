/**
 * Achievement definitions and auto-award logic.
 * Bonuses are credited to bonusBalance (subject to wagering requirement before withdrawal).
 *
 * Concurrency safety:
 * - DB-level uniqueness: player_achievements has a unique index on
 *   (telegram_id, achievement_id), so duplicate inserts are rejected by the DB.
 * - Each award runs inside db.transaction() so the achievement row insert,
 *   balance credit, and ledger entry succeed or fail together — no partial state.
 */

import { db } from "./db";
import {
  playersTable,
  transactionsTable,
  gameRoundsTable,
  playerAchievementsTable,
} from "@workspace/db/schema";
import { eq, count, sql } from "drizzle-orm";
import { logger } from "./logger";

// ─── Achievement catalogue ────────────────────────────────────────────────────

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  type: "games" | "invites";
  threshold: number;
  rewardETB: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // ── Games played ──────────────────────────────────────────────────────────
  {
    id: "games_5",
    title: "5 ጨዋታ",
    description: "5 የቢንጎ ጨዋታ ተጫዋተዋል",
    type: "games",
    threshold: 5,
    rewardETB: 1,
  },
  {
    id: "games_20",
    title: "20 ጨዋታ",
    description: "20 የቢንጎ ጨዋታ ተጫዋተዋል",
    type: "games",
    threshold: 20,
    rewardETB: 5,
  },
  {
    id: "games_50",
    title: "50 ጨዋታ",
    description: "50 የቢንጎ ጨዋታ ተጫዋተዋል",
    type: "games",
    threshold: 50,
    rewardETB: 15,
  },
  {
    id: "games_100",
    title: "100 ጨዋታ",
    description: "100 የቢንጎ ጨዋታ ተጫዋተዋል",
    type: "games",
    threshold: 100,
    rewardETB: 30,
  },
  // ── Invites ───────────────────────────────────────────────────────────────
  {
    id: "invite_3",
    title: "3 ጓደኞች",
    description: "3 ጓደኞቻቸውን ጋብዘዋል",
    type: "invites",
    threshold: 3,
    rewardETB: 2,
  },
  {
    id: "invite_10",
    title: "10 ጓደኞች",
    description: "10 ጓደኞቻቸውን ጋብዘዋል",
    type: "invites",
    threshold: 10,
    rewardETB: 5,
  },
  {
    id: "invite_25",
    title: "25 ጓደኞች",
    description: "25 ጓደኞቻቸውን ጋብዘዋል",
    type: "invites",
    threshold: 25,
    rewardETB: 15,
  },
];

// ─── Auto-award helper ────────────────────────────────────────────────────────

/**
 * Check all un-claimed achievements for a player and auto-award any that are
 * now unlocked.
 *
 * Concurrency safety:
 * - Each award runs in its own db.transaction() so the INSERT, balance UPDATE,
 *   and ledger INSERT succeed or fail as one unit.
 * - The DB-level unique index on (telegram_id, achievement_id) rejects any
 *   duplicate that slips through under concurrent calls (error code 23505).
 *   We catch that specific error and skip silently — it is not an actual
 *   failure, just a harmless race.
 *
 * Returns list of newly awarded achievement IDs (empty if nothing new).
 */
export async function checkAndAwardAchievements(
  telegramId: number,
): Promise<string[]> {
  try {
    // 1. Which achievements has this player already claimed?
    const claimedRows = await db
      .select({ achievementId: playerAchievementsTable.achievementId })
      .from(playerAchievementsTable)
      .where(eq(playerAchievementsTable.telegramId, telegramId));
    const claimed = new Set(claimedRows.map((r) => r.achievementId));

    const unclaimed = ACHIEVEMENTS.filter((a) => !claimed.has(a.id));
    if (unclaimed.length === 0) return [];

    // 2. Fetch current progress counts (only what we need)
    const needsGames = unclaimed.some((a) => a.type === "games");
    const needsInvites = unclaimed.some((a) => a.type === "invites");

    const [gamesCount, invitesCount] = await Promise.all([
      needsGames
        ? db
            .select({ cnt: count() })
            .from(gameRoundsTable)
            .where(eq(gameRoundsTable.telegramId, telegramId))
            .then((r) => Number(r[0]?.cnt ?? 0))
        : Promise.resolve(0),
      needsInvites
        ? db
            .select({ cnt: count() })
            .from(playersTable)
            .where(eq(playersTable.invitedBy, telegramId))
            .then((r) => Number(r[0]?.cnt ?? 0))
        : Promise.resolve(0),
    ]);

    // 3. Determine which achievements are newly unlocked
    const toAward = unclaimed.filter((a) => {
      if (a.type === "games") return gamesCount >= a.threshold;
      if (a.type === "invites") return invitesCount >= a.threshold;
      return false;
    });

    if (toAward.length === 0) return [];

    // 4. Grant each achievement atomically inside its own transaction.
    //    If a duplicate unique-constraint violation occurs (concurrent request
    //    already inserted this achievement_id), skip it silently.
    const awardedIds: string[] = [];
    for (const ach of toAward) {
      try {
        await db.transaction(async (tx) => {
          // Insert achievement record first — will throw 23505 if duplicate
          await tx.insert(playerAchievementsTable).values({
            telegramId,
            achievementId: ach.id,
          });

          // Credit bonusBalance — achievement rewards are bonus ETB
          await tx
            .update(playersTable)
            .set({
              bonusBalance: sql`${playersTable.bonusBalance} + ${ach.rewardETB}`,
            })
            .where(eq(playersTable.telegramId, telegramId));

          // Ledger entry
          await tx.insert(transactionsTable).values({
            telegramId,
            type: "achievement_bonus",
            amount: `${ach.rewardETB}`,
            status: "approved",
            note: `Achievement: ${ach.title} — ${ach.rewardETB} ብር play credit`,
          });
        });

        awardedIds.push(ach.id);
        logger.info(
          { telegramId, achievementId: ach.id, reward: ach.rewardETB },
          "Achievement awarded",
        );
      } catch (err: unknown) {
        // 23505 = unique_violation — another concurrent request already awarded this
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          logger.info(
            { telegramId, achievementId: ach.id },
            "Achievement already awarded by concurrent request — skipping",
          );
          continue;
        }
        // Any other error is unexpected — log and skip to avoid partial state
        logger.warn(
          { err, telegramId, achievementId: ach.id },
          "Achievement grant failed (skipped)",
        );
      }
    }

    return awardedIds;
  } catch (err) {
    logger.error({ err, telegramId }, "checkAndAwardAchievements failed");
    return [];
  }
}

// ─── Progress snapshot ────────────────────────────────────────────────────────

export interface AchievementProgress {
  id: string;
  title: string;
  description: string;
  type: "games" | "invites";
  threshold: number;
  rewardETB: number;
  progress: number;
  claimed: boolean;
}

export async function getAchievementsWithProgress(
  telegramId: number,
): Promise<AchievementProgress[]> {
  const [claimedRows, gamesCountResult, invitesCountResult] = await Promise.all([
    db
      .select({ achievementId: playerAchievementsTable.achievementId })
      .from(playerAchievementsTable)
      .where(eq(playerAchievementsTable.telegramId, telegramId)),
    db
      .select({ cnt: count() })
      .from(gameRoundsTable)
      .where(eq(gameRoundsTable.telegramId, telegramId)),
    db
      .select({ cnt: count() })
      .from(playersTable)
      .where(eq(playersTable.invitedBy, telegramId)),
  ]);

  const claimed = new Set(claimedRows.map((r) => r.achievementId));
  const gamesCount = Number(gamesCountResult[0]?.cnt ?? 0);
  const invitesCount = Number(invitesCountResult[0]?.cnt ?? 0);

  return ACHIEVEMENTS.map((a) => ({
    ...a,
    progress: a.type === "games" ? gamesCount : invitesCount,
    claimed: claimed.has(a.id),
  }));
}
