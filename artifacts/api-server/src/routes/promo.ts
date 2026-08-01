import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "../lib/db";
import { playersTable, transactionsTable, promoCodesTable, promoCodeUsagesTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { bot } from "../lib/bot";

const router: IRouter = Router();

// POST /api/promo/redeem
router.post("/promo/redeem", async (req: Request, res: Response) => {
  const { telegramId, code, gameType } = req.body as { telegramId?: number; code?: string; gameType?: string };
  if (!telegramId || !code) { res.status(400).json({ error: "telegramId and code required" }); return; }

  const trimmedCode = code.trim().toUpperCase();
  const requestedGameType = gameType ?? "bingo";

  try {
    // Find code
    const codeRows = await db
      .select()
      .from(promoCodesTable)
      .where(eq(promoCodesTable.code, trimmedCode))
      .limit(1);

    if (!codeRows.length) { res.status(404).json({ error: "ኮዱ አልተገኘም" }); return; }

    const promo = codeRows[0]!;

    if (!promo.isActive) { res.status(400).json({ error: "ይህ ፕሮሞ ኮድ አልተሰጠም" }); return; }
    if (promo.usedCount >= promo.maxUses) { res.status(400).json({ error: "ኮዱ ጥቅም ላይ ውሏል — ቦናሱ አልቋል" }); return; }
    if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
      res.status(400).json({ error: "ፕሮሞ ኮዱ ጊዜው አልቋል" }); return;
    }

    // Check if this player already used this code
    const usageRows = await db
      .select({ id: promoCodeUsagesTable.id })
      .from(promoCodeUsagesTable)
      .where(and(
        eq(promoCodeUsagesTable.promoCodeId, promo.id),
        eq(promoCodeUsagesTable.telegramId, telegramId),
      ))
      .limit(1);

    if (usageRows.length) { res.status(400).json({ error: "ይህን ኮድ ቀድሞ ተጠቅመዋል" }); return; }

    // Check player exists
    const playerRows = await db
      .select({ telegramId: playersTable.telegramId })
      .from(playersTable)
      .where(eq(playersTable.telegramId, telegramId))
      .limit(1);

    if (!playerRows.length) { res.status(404).json({ error: "ተጫዋቹ አልተገኘም" }); return; }

    const bonus = Number(promo.bonusAmount);

    // Apply bonus, record usage, insert transaction — all in sequence
    // Promo bonuses go to coins (playBalance) — not withdrawable ETB.
    await db.update(playersTable)
      .set({ playBalance: sql`${playersTable.playBalance} + ${bonus}` })
      .where(eq(playersTable.telegramId, telegramId));

    await db.update(promoCodesTable)
      .set({ usedCount: sql`${promoCodesTable.usedCount} + 1` })
      .where(eq(promoCodesTable.id, promo.id));

    await db.insert(promoCodeUsagesTable).values({
      promoCodeId: promo.id,
      telegramId,
    });

    await db.insert(transactionsTable).values({
      telegramId,
      type: "promo_bonus",
      amount: `${bonus}`,
      status: "approved",
      note: `ፕሮሞ ኮድ: ${trimmedCode}`,
    });

    // Telegram notification (non-fatal)
    try {
      await bot.api.sendMessage(
        telegramId,
        `🎉 <b>ፕሮሞ ቦነስ ደረሰዎ!</b>\n\n🏷️ ኮድ: <code>${trimmedCode}</code>\n💰 <b>${bonus.toFixed(2)} ብር</b> ወደ ዋሌትዎ ተጨምሯል!`,
        { parse_mode: "HTML" }
      );
    } catch { /* non-fatal */ }

    logger.info({ telegramId, code: trimmedCode, bonus }, "Promo code redeemed");
    res.json({ ok: true, bonus });
  } catch (err) {
    logger.error({ err }, "promo redeem error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
