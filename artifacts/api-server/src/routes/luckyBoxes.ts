import { Router, type IRouter, type Request, type Response } from "express";
import { InputFile } from "grammy";
import { db } from "../lib/db";
import {
  luckyBoxSessionsTable,
  luckyBoxClaimsTable,
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { bot, getBotUsername, buildBoxKeyboard, buildResultsMessage } from "../lib/bot";
import { hasValidToken } from "./admin";

const router: IRouter = Router();
const ADMIN_ID = Number(process.env["ADMIN_TELEGRAM_ID"] ?? "0");
const CHANNEL_ID = process.env["LUCKY_BOX_CHANNEL_ID"] ?? process.env["ANNOUNCEMENT_CHANNEL_ID"] ?? "";

function isAdmin(telegramId: number) {
  return ADMIN_ID > 0 && telegramId === ADMIN_ID;
}

function resolveAdmin(req: Request, telegramId: number): boolean {
  return isAdmin(telegramId) || hasValidToken(req);
}

// POST /api/admin/lucky-boxes — create session
router.post("/admin/lucky-boxes", async (req: Request, res: Response) => {
  const { telegramId, title, description, imageBase64, totalBoxes, amountPerBox } = req.body as {
    telegramId: number; title?: string; description?: string;
    imageBase64?: string; totalBoxes?: number; amountPerBox?: number;
  };
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!title?.trim()) { res.status(400).json({ error: "title required" }); return; }
  if (!totalBoxes || totalBoxes < 1 || totalBoxes > 50) { res.status(400).json({ error: "totalBoxes must be 1–50" }); return; }
  if (!amountPerBox || amountPerBox < 1) { res.status(400).json({ error: "amountPerBox required" }); return; }

  try {
    const inserted = await db.insert(luckyBoxSessionsTable).values({
      title: title.trim(),
      description: description?.trim() ?? null,
      imageBase64: imageBase64?.trim() || null,
      totalBoxes,
      amountPerBox: `${amountPerBox}`,
      createdBy: telegramId,
    }).returning();
    res.json({ ok: true, session: inserted[0] });
  } catch (err) {
    logger.error({ err }, "create lucky box error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/lucky-boxes — list sessions
router.get("/admin/lucky-boxes", async (req: Request, res: Response) => {
  const telegramId = Number(req.query["telegramId"]);
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }
  try {
    const sessions = await db.select({
      id: luckyBoxSessionsTable.id,
      title: luckyBoxSessionsTable.title,
      description: luckyBoxSessionsTable.description,
      totalBoxes: luckyBoxSessionsTable.totalBoxes,
      amountPerBox: luckyBoxSessionsTable.amountPerBox,
      claimedCount: luckyBoxSessionsTable.claimedCount,
      status: luckyBoxSessionsTable.status,
      channelMessageId: luckyBoxSessionsTable.channelMessageId,
      createdAt: luckyBoxSessionsTable.createdAt,
    }).from(luckyBoxSessionsTable).orderBy(desc(luckyBoxSessionsTable.createdAt)).limit(30);
    res.json({ sessions });
  } catch (err) {
    logger.error({ err }, "list lucky boxes error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/lucky-boxes/:id/claims — get claims for session
router.get("/admin/lucky-boxes/:id/claims", async (req: Request, res: Response) => {
  const telegramId = Number(req.query["telegramId"]);
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params["id"]);
  try {
    const claims = await db.select().from(luckyBoxClaimsTable)
      .where(eq(luckyBoxClaimsTable.sessionId, id))
      .orderBy(luckyBoxClaimsTable.boxNumber);
    res.json({ claims });
  } catch (err) {
    logger.error({ err }, "list lucky box claims error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/lucky-boxes/:id/post-channel — post to channel
router.post("/admin/lucky-boxes/:id/post-channel", async (req: Request, res: Response) => {
  const { telegramId } = req.body as { telegramId: number };
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!CHANNEL_ID) { res.status(400).json({ error: "LUCKY_BOX_CHANNEL_ID not configured" }); return; }

  const id = Number(req.params["id"]);
  try {
    const rows = await db.select().from(luckyBoxSessionsTable)
      .where(eq(luckyBoxSessionsTable.id, id)).limit(1);
    if (!rows.length) { res.status(404).json({ error: "Session not found" }); return; }
    const session = rows[0]!;

    const claims = await db.select().from(luckyBoxClaimsTable)
      .where(eq(luckyBoxClaimsTable.sessionId, id));

    const keyboard = buildBoxKeyboard(session.totalBoxes, claims, id, Number(session.amountPerBox));

    const captionLines: string[] = [];
    captionLines.push(`🎁 <b>${session.title}</b>`);
    if (session.description) captionLines.push(`\n${session.description}`);
    captionLines.push(`\n\n📦 <b>${session.totalBoxes} ቦክስ</b> — እያንዳንዱ <b>${Number(session.amountPerBox).toFixed(0)} ብር</b>`);
    captionLines.push(`\n👇 <b>ቦክስ ነኩ — ኩፖን ወደ ዋሌትዎ ይጠቀምሩ!</b>`);
    const caption = captionLines.join("");

    let sentMsgId: number;

    if (session.imageBase64?.trim()) {
      const imgBuf = Buffer.from(session.imageBase64.trim(), "base64");
      const sent = await bot.api.sendPhoto(CHANNEL_ID, new InputFile(imgBuf, "lucky-box.jpg"), {
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      sentMsgId = sent.message_id;
    } else {
      const sent = await bot.api.sendMessage(CHANNEL_ID, caption, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      sentMsgId = sent.message_id;
    }

    await db.update(luckyBoxSessionsTable)
      .set({ channelMessageId: sentMsgId })
      .where(eq(luckyBoxSessionsTable.id, id));

    logger.info({ id, sentMsgId }, "Lucky box posted to channel");
    res.json({ ok: true, messageId: sentMsgId });
  } catch (err) {
    logger.error({ err }, "post lucky box to channel error");
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/admin/lucky-boxes/:id — delete session
router.delete("/admin/lucky-boxes/:id", async (req: Request, res: Response) => {
  const telegramId = Number(req.body?.telegramId ?? req.query["telegramId"]);
  if (!resolveAdmin(req, telegramId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const id = Number(req.params["id"]);
  try {
    await db.delete(luckyBoxClaimsTable).where(eq(luckyBoxClaimsTable.sessionId, id));
    await db.delete(luckyBoxSessionsTable).where(eq(luckyBoxSessionsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete lucky box error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
