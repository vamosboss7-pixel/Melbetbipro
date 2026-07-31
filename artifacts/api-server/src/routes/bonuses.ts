/**
 * Bonus routes:
 *   GET  /api/player/checkin-status   — streak info + whether claimable today
 *   POST /api/player/checkin          — claim daily check-in bonus
 *   GET  /api/player/achievements     — achievement list with progress + auto-award
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "../lib/db";
import {
  playersTable,
  transactionsTable,
  dailyCheckinsTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  checkAndAwardAchievements,
  getAchievementsWithProgress,
} from "../lib/achievements";

const router: IRouter = Router();

// ─── Daily check-in bonus schedule ────────────────────────────────────────────
// Indexed 0-based (streak day 1 → index 0).
// After 7 consecutive days the streak wraps back to day 1.
const CHECKIN_REWARDS = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0];

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Return reward for a given 1-based streak day (clamps to schedule length). */
function rewardForStreakDay(streakDay: number): number {
  const idx = Math.min(streakDay, CHECKIN_REWARDS.length) - 1;
  return CHECKIN_REWARDS[idx]!;
}

// ─── GET /api/player/checkin-status ──────────────────────────────────────────

router.get("/player/checkin-status", async (req: Request, res: Response) => {
  const telegramId = Number(req.query["telegramId"]);
  if (!telegramId || isNaN(telegramId)) {
    res.status(400).json({ error: "telegramId is required" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(dailyCheckinsTable)
      .where(eq(dailyCheckinsTable.telegramId, telegramId))
      .limit(1);

    const today = todayUTC();
    const yesterday = yesterdayUTC();

    if (rows.length === 0) {
      res.json({
        currentStreak: 0,
        lastCheckinDate: null,
        canClaimToday: true,
        nextStreakDay: 1,
        nextRewardETB: rewardForStreakDay(1),
        schedule: CHECKIN_REWARDS,
      });
      return;
    }

    const row = rows[0]!;
    const lastDate = row.lastCheckinDate;

    const claimedToday = lastDate === today;
    const claimedYesterday = lastDate === yesterday;

    let nextStreakDay: number;
    if (claimedToday) {
      nextStreakDay = row.currentStreak;
    } else if (claimedYesterday) {
      nextStreakDay = row.currentStreak < CHECKIN_REWARDS.length
        ? row.currentStreak + 1
        : 1;
    } else {
      nextStreakDay = 1;
    }

    res.json({
      currentStreak: row.currentStreak,
      lastCheckinDate: lastDate ?? null,
      canClaimToday: !claimedToday,
      nextStreakDay,
      nextRewardETB: rewardForStreakDay(nextStreakDay),
      schedule: CHECKIN_REWARDS,
    });
  } catch (err) {
    logger.error({ err }, "checkin-status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/player/checkin ─────────────────────────────────────────────────

router.post("/player/checkin", async (req: Request, res: Response) => {
  const telegramId = Number((req.body as Record<string, unknown>)["telegramId"]);
  if (!telegramId || isNaN(telegramId)) {
    res.status(400).json({ error: "telegramId is required" });
    return;
  }

  try {
    const today = todayUTC();
    const yesterday = yesterdayUTC();

    // All claim logic runs inside a single transaction with row-level locking.
    // The SELECT FOR UPDATE on the checkin row prevents concurrent requests from
    // both passing the "already claimed" guard and issuing double credits.
    const result = await db.transaction(async (tx) => {
      // Lock the player's checkin row (or do nothing if no row yet — new player
      // case is handled by the INSERT below which also serialises via the
      // unique constraint on telegram_id).
      const rows = await tx.execute(
        sql`SELECT * FROM daily_checkins WHERE telegram_id = ${telegramId} LIMIT 1 FOR UPDATE`,
      );

      type CheckinRow = {
        current_streak: number;
        last_checkin_date: string | null;
      };

      const existing = (rows.rows[0] as CheckinRow | undefined) ?? null;

      // Guard: already claimed today?
      if (existing?.last_checkin_date === today) {
        return { alreadyClaimed: true } as const;
      }

      // Compute new streak
      const isConsecutive = existing?.last_checkin_date === yesterday;
      const prevStreak = existing?.current_streak ?? 0;
      let newStreak: number;
      if (isConsecutive) {
        newStreak = prevStreak + 1;
        if (newStreak > CHECKIN_REWARDS.length) newStreak = 1;
      } else {
        newStreak = 1;
      }

      const reward = rewardForStreakDay(newStreak);

      // Upsert check-in record
      if (existing) {
        await tx
          .update(dailyCheckinsTable)
          .set({ currentStreak: newStreak, lastCheckinDate: today, updatedAt: new Date() })
          .where(eq(dailyCheckinsTable.telegramId, telegramId));
      } else {
        await tx.insert(dailyCheckinsTable).values({
          telegramId,
          currentStreak: newStreak,
          lastCheckinDate: today,
        });
      }

      // Credit playBalance (non-withdrawable) atomically inside same transaction
      await tx
        .update(playersTable)
        .set({ playBalance: sql`${playersTable.playBalance} + ${reward}` })
        .where(eq(playersTable.telegramId, telegramId));

      // Ledger entry
      await tx.insert(transactionsTable).values({
        telegramId,
        type: "checkin_bonus",
        amount: `${reward}`,
        status: "approved",
        note: `ቀን ${newStreak} Check-in bonus — ${reward} ብር play credit`,
      });

      return { alreadyClaimed: false, newStreak, reward } as const;
    });

    if (result.alreadyClaimed) {
      res.status(409).json({ error: "already_claimed", message: "ዛሬ አስቀድሞ ወሰዱ" });
      return;
    }

    logger.info({ telegramId, streak: result.newStreak, reward: result.reward }, "Daily check-in claimed");

    res.json({
      ok: true,
      newStreak: result.newStreak,
      rewardETB: result.reward,
      message: `✅ Day ${result.newStreak} bonus: ${result.reward} ብር play credit ተሰጥቷዎት!`,
    });
  } catch (err) {
    logger.error({ err }, "checkin claim error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/player/achievements ────────────────────────────────────────────

router.get("/player/achievements", async (req: Request, res: Response) => {
  const telegramId = Number(req.query["telegramId"]);
  if (!telegramId || isNaN(telegramId)) {
    res.status(400).json({ error: "telegramId is required" });
    return;
  }

  try {
    // Auto-award any newly unlocked achievements before responding
    const newlyAwarded = await checkAndAwardAchievements(telegramId);

    const progress = await getAchievementsWithProgress(telegramId);

    res.json({ achievements: progress, newlyAwarded });
  } catch (err) {
    logger.error({ err }, "achievements error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
