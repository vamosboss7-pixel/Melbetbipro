import { InputFile, InlineKeyboard } from "grammy";
import { db } from "./db";
import { scheduledBroadcastsTable } from "@workspace/db/schema";
import { and, eq, lte } from "drizzle-orm";
import { playersTable } from "@workspace/db/schema";
import { bot } from "./bot";
import { logger } from "./logger";

function getPlayNowKeyboard(): InlineKeyboard | null {
  const miniAppUrl = process.env["MINI_APP_URL"] ?? process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (!miniAppUrl) return null;
  const appUrl = `https://${miniAppUrl}`;
  return new InlineKeyboard().add({ text: "🎮 ጨዋታ ጀምር", web_app: { url: appUrl } });
}

async function fireBroadcast(id: number, message: string, imageData: string | null) {
  const players = await db.select({ telegramId: playersTable.telegramId }).from(playersTable);
  let sent = 0, failed = 0;
  const kb = getPlayNowKeyboard();
  const replyMarkup = kb ? kb : undefined;
  for (const p of players) {
    try {
      if (imageData) {
        await bot.api.sendPhoto(
          p.telegramId,
          new InputFile(Buffer.from(imageData, "base64"), "broadcast.jpg"),
          { caption: message, parse_mode: "HTML", reply_markup: replyMarkup },
        );
      } else {
        await bot.api.sendMessage(p.telegramId, message, { parse_mode: "HTML", reply_markup: replyMarkup });
      }
      sent++;
    } catch {
      failed++;
    }
  }
  logger.info({ id, sent, failed }, "Scheduled broadcast sent");
}

export function startAutoScheduleCron() {
  setInterval(async () => {
    try {
      const now = new Date();
      const pending = await db
        .select()
        .from(scheduledBroadcastsTable)
        .where(and(
          eq(scheduledBroadcastsTable.isSent, false),
          lte(scheduledBroadcastsTable.scheduledAt, now),
        ));

      for (const bc of pending) {
        try {
          await fireBroadcast(bc.id, bc.message, bc.imageUrl ?? null);
          if (bc.isDaily) {
            const nextAt = new Date(bc.scheduledAt);
            nextAt.setDate(nextAt.getDate() + 1);
            await db.update(scheduledBroadcastsTable)
              .set({ isSent: false, scheduledAt: nextAt, sentAt: now })
              .where(eq(scheduledBroadcastsTable.id, bc.id));
          } else {
            await db.update(scheduledBroadcastsTable)
              .set({ isSent: true, sentAt: now })
              .where(eq(scheduledBroadcastsTable.id, bc.id));
          }
        } catch (err) {
          logger.error({ err, id: bc.id }, "Failed to fire scheduled broadcast");
        }
      }
    } catch (err) {
      logger.error({ err }, "AutoSchedule cron error");
    }
  }, 30_000);
}
