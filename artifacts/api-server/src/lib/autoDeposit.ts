import { db } from "./db";
import {
  autoDepositsTable,
  depositCodeAttemptsTable,
  playersTable,
  transactionsTable,
} from "@workspace/db/schema";
import { eq, and, gte, count } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { appSettings } from "./settings";

// ── Transaction code extraction ───────────────────────────────────────────────
const CODE_PATTERNS: RegExp[] = [
  // English patterns
  /Tele[Tt]ran\s*ID[:\s]+([A-Z0-9]+)/i,
  /TeleBirr\s*(?:Ref|ID)[:\s#]+([A-Z0-9]+)/i,
  /Txn\s*ID[:\s]+([A-Z0-9]+)/i,
  /TrxnID[:\s]+([A-Z0-9]+)/i,
  /transaction\s+number\s+is\s+([A-Z0-9]{6,})/i,
  /Transaction\s*(?:ID|No\.?|Code)[:\s]+([A-Z0-9]+)/i,
  /Trans\.?\s*Ref[:\s]+([A-Z0-9]+)/i,
  /Ref\s*No\.?[:\s]+([A-Z0-9]+)/i,
  /Receipt\s*No\.?[:\s]+([A-Z0-9]+)/i,
  /Confirmation\s*Code[:\s]+([A-Z0-9]+)/i,
  /Reference[:\s]+([A-Z0-9]+)/i,
  /Token[:\s]+([A-Z0-9]+)/i,
  /ID[:\s]+([A-Z0-9]{8,20})/i,
  // Amharic patterns (ኢትዮጵያ ባንኮች)
  /የሂሳብ\s*እንቅስቃሴ\s*ቁጥርዎ\s+([A-Z0-9]+)/,
  /የግብይት\s*ቁጥርዎ\s+([A-Z0-9]+)/,
  /ግብይት\s*ቁጥር[:\s።]+([A-Z0-9]+)/,
  /ማጣቀሻ\s*ቁጥር[:\s።]+([A-Z0-9]+)/,
  /የልውውጥ\s*ቁጥር[:\s።]+([A-Z0-9]+)/,
  /ልውውጥ\s*ቁጥር[:\s።]+([A-Z0-9]+)/,
  /ደረሰኝ\s*ቁጥር[:\s።]+([A-Z0-9]+)/,
  /የማጣቀሻ\s*ቁጥር[:\s።]+([A-Z0-9]+)/,
  /ቁጥርዎ\s+([A-Z0-9]{6,})/,
  /ኮድ[:\s።]+([A-Z0-9]{6,})/,
  /^([A-Z0-9]{8,20})$/im,
];

export function extractTransactionCode(text: string): string | null {
  for (const pattern of CODE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].toUpperCase().trim();
  }
  return null;
}

const AMOUNT_PATTERNS: RegExp[] = [
  /ETB\s*([\d,]+(?:\.\d{1,2})?)/i,
  /([\d,]+(?:\.\d{1,2})?)\s*ETB/i,
  /([\d,]+(?:\.\d{1,2})?)\s*birr/i,
  /ብር\s*([\d,]+(?:\.\d{1,2})?)/,
  /([\d,]+(?:\.\d{1,2})?)\s*ብር/,
  /amount[:\s]+([\d,]+(?:\.\d{1,2})?)/i,
  /received\s+([\d,]+(?:\.\d{1,2})?)/i,
  /sent\s+([\d,]+(?:\.\d{1,2})?)/i,
  // Amharic amount patterns
  /ተቀብለዋል[:\s።]*([\d,]+(?:\.\d{1,2})?)/,
  /ተላልፏል[:\s።]*([\d,]+(?:\.\d{1,2})?)/,
  /ተላኩ[:\s።]*([\d,]+(?:\.\d{1,2})?)/,
  /ቀሪ\s*ሂሳብ[:\s።]*([\d,]+(?:\.\d{1,2})?)/,
  /መጠን[:\s።]*([\d,]+(?:\.\d{1,2})?)/,
  /የተላከ\s*መጠን[:\s።]*([\d,]+(?:\.\d{1,2})?)/,
  /የተቀበሉት\s*መጠን[:\s።]*([\d,]+(?:\.\d{1,2})?)/,
];

export function extractAmount(text: string): number | null {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return parseFloat(match[1].replace(/,/g, ""));
  }
  return null;
}

// ── Credit a player balance (pure DB) ────────────────────────────────────────
export async function creditPlayerBalance(
  telegramId: number,
  amount: number,
  note: string,
): Promise<void> {
  await db.update(playersTable).set({
    balance: sql`${playersTable.balance} + ${amount}`,
    playBalance: sql`${playersTable.playBalance} + ${amount}`,
  }).where(eq(playersTable.telegramId, telegramId));

  await db.insert(transactionsTable).values({
    telegramId,
    type: "deposit",
    amount: `${amount}`,
    status: "approved",
    note,
  });
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
const MAX_FAILURES = 5;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function trackDepositAttempt(
  telegramId: number,
  transactionCode: string,
  isValid: boolean,
): Promise<number> {
  await db.insert(depositCodeAttemptsTable).values({
    telegramId, transactionCode, isValid,
  });

  if (isValid) return 0;

  const since = new Date(Date.now() - WINDOW_MS);
  const result = await db
    .select({ cnt: count() })
    .from(depositCodeAttemptsTable)
    .where(and(
      eq(depositCodeAttemptsTable.telegramId, telegramId),
      eq(depositCodeAttemptsTable.isValid, false),
      gte(depositCodeAttemptsTable.createdAt, since),
    ));

  return result[0]?.cnt ?? 0;
}

export async function getRecentFailureCount(telegramId: number): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS);
  const result = await db
    .select({ cnt: count() })
    .from(depositCodeAttemptsTable)
    .where(and(
      eq(depositCodeAttemptsTable.telegramId, telegramId),
      eq(depositCodeAttemptsTable.isValid, false),
      gte(depositCodeAttemptsTable.createdAt, since),
    ));
  return result[0]?.cnt ?? 0;
}

// ── Auto-deposit reconciliation ───────────────────────────────────────────────
export type BotDepositResult =
  | { status: "credited"; amount: number }
  | { status: "pending" }
  | { status: "duplicate" }
  | { status: "failed" };

export async function processBotDeposit(
  telegramId: number,
  firstName: string,
  amountRequested: number,
  transactionCode: string,
): Promise<BotDepositResult> {
  try {
    const existing = await db
      .select()
      .from(autoDepositsTable)
      .where(eq(autoDepositsTable.transactionCode, transactionCode))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0]!;
      if (row.status === "credited") return { status: "duplicate" };

      if (row.status === "pending_sms") {
        const creditAmount = Number(row.amount ?? amountRequested);
        await db.update(autoDepositsTable).set({
          telegramId,
          firstName,
          amountRequested: `${amountRequested}`,
          botReceivedAt: new Date(),
          status: "credited",
          creditedAt: new Date(),
        }).where(eq(autoDepositsTable.id, row.id));

        await creditPlayerBalance(telegramId, creditAmount, `Auto-deposit: ${transactionCode}`);
        logger.info({ telegramId, creditAmount, transactionCode }, "Auto deposit credited (bot matched)");
        return { status: "credited", amount: creditAmount };
      }

      return { status: "pending" };
    }

    try {
      await db.insert(autoDepositsTable).values({
        transactionCode,
        amountRequested: `${amountRequested}`,
        telegramId,
        firstName,
        botReceivedAt: new Date(),
        status: "pending_bot",
      });
    } catch {
      return { status: "duplicate" };
    }

    return { status: "pending" };
  } catch (err) {
    logger.error({ err, transactionCode }, "processBotDeposit error");
    return { status: "failed" };
  }
}

export async function processSmsDeposit(smsText: string): Promise<{
  code: string | null;
  amount: number | null;
  credited: boolean;
  telegramId?: number;
}> {
  const code = extractTransactionCode(smsText);
  const amount = extractAmount(smsText);

  if (!code) {
    logger.warn({ smsText: smsText.slice(0, 100) }, "Could not extract code from SMS");
    return { code: null, amount, credited: false };
  }

  try {
    const existing = await db
      .select()
      .from(autoDepositsTable)
      .where(eq(autoDepositsTable.transactionCode, code))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0]!;
      if (row.status === "credited") {
        return { code, amount, credited: true, telegramId: row.telegramId ?? undefined };
      }

      if (row.status === "pending_bot" && row.telegramId) {
        const creditAmount = amount ?? Number(row.amountRequested ?? 0);
        await db.update(autoDepositsTable).set({
          amount: `${creditAmount}`,
          smsRaw: smsText,
          smsReceivedAt: new Date(),
          status: "credited",
          creditedAt: new Date(),
        }).where(eq(autoDepositsTable.id, row.id));

        await creditPlayerBalance(row.telegramId, creditAmount, `Auto-deposit: ${code}`);
        logger.info({ telegramId: row.telegramId, creditAmount, code }, "Auto deposit credited (SMS matched)");
        return { code, amount: creditAmount, credited: true, telegramId: row.telegramId };
      }

      await db.update(autoDepositsTable).set({
        smsRaw: smsText,
        smsReceivedAt: new Date(),
        amount: amount ? `${amount}` : null,
      }).where(eq(autoDepositsTable.id, row.id));

      return { code, amount, credited: false };
    }

    await db.insert(autoDepositsTable).values({
      transactionCode: code,
      amount: amount ? `${amount}` : null,
      smsRaw: smsText,
      smsReceivedAt: new Date(),
      status: "pending_sms",
    }).onConflictDoNothing();

    return { code, amount, credited: false };
  } catch (err) {
    logger.error({ err, code }, "processSmsDeposit error");
    return { code, amount, credited: false };
  }
}

export { MAX_FAILURES };
