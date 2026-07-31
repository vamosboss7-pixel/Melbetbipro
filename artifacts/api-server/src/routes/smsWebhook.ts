import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { processSmsDeposit } from "../lib/autoDeposit";
import { bot } from "../lib/bot";

const router: IRouter = Router();

const SMS_SECRET = process.env["SMS_WEBHOOK_SECRET"] ?? "";

// POST /api/sms/forward
// Called by an SMS forwarder app (e.g. "SMS Forwarder" Android app) when a
// payment SMS arrives on the designated device.
//
// Expected body (any combination):
//   { message: "...", from: "...", secret?: "..." }
//   or
//   { sms: "...", body: "...", text: "..." }
router.post("/sms/forward", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  if (SMS_SECRET) {
    const token = (body["secret"] ?? body["token"] ?? req.headers["x-sms-secret"]) as string | undefined;
    if (token !== SMS_SECRET) {
      logger.warn({ ip: req.ip }, "SMS webhook rejected — invalid secret");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const smsText = (
    body["message"] ?? body["sms"] ?? body["body"] ?? body["text"] ?? body["msg"] ?? body["key"]
  ) as string | undefined;

  if (!smsText || typeof smsText !== "string") {
    res.status(400).json({ error: "Missing message field" });
    return;
  }

  logger.info({ smsText: smsText.slice(0, 200) }, "SMS received via webhook");

  try {
    const result = await processSmsDeposit(smsText);

    if (result.credited && result.telegramId) {
      const adminId = Number(process.env["ADMIN_TELEGRAM_ID"] ?? "0");
      try {
        await bot.api.sendMessage(
          result.telegramId,
          `✅ <b>ዲፖዚት ተረጋግጧል!</b>\n\n` +
          `💰 <b>${(result.amount ?? 0).toFixed(2)} ብር</b> ወደ Play Wallet ተጨምሯል!\n` +
          `🔖 ኮድ: <code>${result.code}</code>\n\n🎱 መጫወት ይችላሉ!`,
          { parse_mode: "HTML" },
        );
      } catch { /* notification failure is non-fatal */ }

      if (adminId) {
        try {
          await bot.api.sendMessage(
            adminId,
            `🤖 <b>Auto-deposit!</b>\n\n` +
            `👤 ID: ${result.telegramId}\n` +
            `💰 ${(result.amount ?? 0).toFixed(2)} ብር\n` +
            `🔖 ${result.code}\n✅ ቀጥታ ተቀናሷል`,
            { parse_mode: "HTML" },
          );
        } catch { /* non-fatal */ }
      }
    } else if (result.code && !result.credited) {
      logger.info({ code: result.code, amount: result.amount }, "SMS stored, waiting for bot match");
    }

    res.json({ ok: true, code: result.code, amount: result.amount, credited: result.credited });
  } catch (err) {
    logger.error({ err }, "SMS webhook processing error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
