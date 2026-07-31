import { Router, type IRouter, type Request, type Response } from "express";
import { InputFile, InlineKeyboard } from "grammy";
import { db } from "../lib/db";
import { playersTable, scheduledBroadcastsTable } from "@workspace/db/schema";
import { bot } from "../lib/bot";
import { getIo } from "../lib/gameSocket";
import { logger } from "../lib/logger";
import { eq, desc } from "drizzle-orm";
import { hasValidToken } from "./admin";

function getPlayNowKeyboard(): InlineKeyboard | null {
  const miniAppUrl = process.env["MINI_APP_URL"] ?? process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (!miniAppUrl) return null;
  const appUrl = `https://${miniAppUrl}`;
  return new InlineKeyboard().add({ text: "🎮 ጨዋታ ጀምር", web_app: { url: appUrl } });
}

const router: IRouter = Router();
const ADMIN_ID = Number(process.env["ADMIN_TELEGRAM_ID"] ?? "0");

function isAdmin(telegramId: number) {
  return ADMIN_ID > 0 && telegramId === ADMIN_ID;
}

function resolveAdmin(req: Request, telegramId: number): boolean {
  return isAdmin(telegramId) || hasValidToken(req);
}

// POST /api/admin/broadcast/bot — send text+optional image to all players via bot
router.post("/admin/broadcast/bot", async (req: Request, res: Response) => {
  const { telegramId, message, imageBase64 } = req.body as { telegramId: number; message?: string; imageBase64?: string };
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!message?.trim()) { res.status(400).json({ error: "message required" }); return; }

  const players = await db.select({ telegramId: playersTable.telegramId }).from(playersTable);
  let sent = 0, failed = 0;

  const imgFile = imageBase64?.trim()
    ? new InputFile(Buffer.from(imageBase64.trim(), "base64"), "broadcast.jpg")
    : null;

  const kb = getPlayNowKeyboard();
  const replyMarkup = kb ? kb : undefined;

  for (const p of players) {
    try {
      if (imgFile) {
        await bot.api.sendPhoto(p.telegramId, new InputFile(Buffer.from(imageBase64!.trim(), "base64"), "broadcast.jpg"), { caption: message.trim(), parse_mode: "HTML", reply_markup: replyMarkup });
      } else {
        await bot.api.sendMessage(p.telegramId, message.trim(), { parse_mode: "HTML", reply_markup: replyMarkup });
      }
      sent++;
    } catch {
      failed++;
    }
  }

  logger.info({ sent, failed }, "Bot broadcast sent");
  res.json({ sent, failed, total: players.length });
});

// POST /api/admin/broadcast/inapp — emit popup to all connected clients via socket
router.post("/admin/broadcast/inapp", (req: Request, res: Response) => {
  const { telegramId, message, durationSeconds } = req.body as { telegramId: number; message?: string; durationSeconds?: number };
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!message?.trim()) { res.status(400).json({ error: "message required" }); return; }

  const duration = Math.max(3, Math.min(300, Number(durationSeconds) || 10));
  const io = getIo();
  if (!io) { res.status(503).json({ error: "Socket not ready" }); return; }

  io.emit("broadcast_popup", { message: message.trim(), durationSeconds: duration });
  logger.info({ message: message.trim(), durationSeconds: duration }, "In-app popup broadcast sent");
  res.json({ ok: true });
});

// POST /api/admin/broadcast/schedule — schedule a bot broadcast
router.post("/admin/broadcast/schedule", async (req: Request, res: Response) => {
  const { telegramId, message, imageBase64, scheduledAt, isDaily } = req.body as {
    telegramId: number; message?: string; imageBase64?: string; scheduledAt?: string; isDaily?: boolean;
  };
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!message?.trim()) { res.status(400).json({ error: "message required" }); return; }
  if (!scheduledAt) { res.status(400).json({ error: "scheduledAt required" }); return; }

  const date = new Date(scheduledAt);
  if (isNaN(date.getTime())) { res.status(400).json({ error: "Invalid scheduledAt date" }); return; }

  try {
    const inserted = await db.insert(scheduledBroadcastsTable).values({
      message: message.trim(),
      imageUrl: imageBase64?.trim() || null,
      scheduledAt: date,
      isDaily: !!isDaily,
    }).returning();
    logger.info({ id: inserted[0]?.id, scheduledAt: date, isDaily }, "Broadcast scheduled");
    res.json({ ok: true, broadcast: inserted[0] });
  } catch (err) {
    logger.error({ err }, "schedule broadcast error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/broadcast/scheduled — list upcoming scheduled broadcasts
router.get("/admin/broadcast/scheduled", async (req: Request, res: Response) => {
  const telegramId = Number(req.query["telegramId"]);
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }

  try {
    const rows = await db
      .select()
      .from(scheduledBroadcastsTable)
      .where(eq(scheduledBroadcastsTable.isSent, false))
      .orderBy(desc(scheduledBroadcastsTable.scheduledAt))
      .limit(20);
    res.json({ broadcasts: rows });
  } catch (err) {
    logger.error({ err }, "list scheduled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/broadcast/schedule/:id — cancel scheduled broadcast
router.delete("/admin/broadcast/schedule/:id", async (req: Request, res: Response) => {
  const telegramId = Number(req.body?.telegramId ?? req.query["telegramId"]);
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params["id"]);

  try {
    await db.delete(scheduledBroadcastsTable).where(eq(scheduledBroadcastsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete scheduled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
