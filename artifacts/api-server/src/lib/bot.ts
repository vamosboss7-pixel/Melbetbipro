import { Bot, InlineKeyboard, InputFile } from "grammy";
import { logger } from "./logger";
import { db } from "./db";
import {
  playersTable,
  pendingDepositsTable,
  pendingWithdrawalsTable,
  transactionsTable,
  promoCodesTable,
  promoCodeUsagesTable,
  depositCodeAttemptsTable,
  luckyBoxSessionsTable,
  luckyBoxClaimsTable,
  type LuckyBoxClaim,
} from "@workspace/db/schema";
import { eq, desc, sql, and, gte, count } from "drizzle-orm";
import { appSettings } from "./settings";
import {
  extractTransactionCode,
  processBotDeposit,
  trackDepositAttempt,
  getRecentFailureCount,
  MAX_FAILURES,
} from "./autoDeposit";

const token = process.env["TELEGRAM_BOT_TOKEN"] ?? "placeholder:MISSING";
const botReady = !!process.env["TELEGRAM_BOT_TOKEN"];
if (!botReady) {
  console.warn("[bot] TELEGRAM_BOT_TOKEN not set — bot commands will be disabled");
}

// Detect whether we should use long-polling (dev) or webhook (deployed).
// riker.replit.dev and *.replit.dev are dev-only proxies that Telegram cannot reach.
const _botDomain = (
  process.env["WEBHOOK_DOMAIN"] ??
  process.env["RAILWAY_PUBLIC_DOMAIN"] ??
  process.env["RENDER_EXTERNAL_HOSTNAME"] ??
  process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim() ??
  ""
);
export const USE_POLLING = !_botDomain || _botDomain.includes("riker.replit.dev") || _botDomain.includes(".replit.dev");

const ADMIN_ID = 8228419622;
const MAIN_ADMIN_TELEGRAM_ID = Number(process.env["MAIN_ADMIN_TELEGRAM_ID"] ?? "0");
const CHANNEL_ID = process.env["ANNOUNCEMENT_CHANNEL_ID"] ?? "";
const LUCKY_BOX_CHANNEL_ID = process.env["LUCKY_BOX_CHANNEL_ID"] ?? CHANNEL_ID;
const BONUS_CHANNEL_USERNAME = process.env["BONUS_CHANNEL_USERNAME"] ?? "@melkameBingoAgents";
const CHANNEL_JOIN_BONUS = 5;

// Comma-separated list of channel IDs/@usernames users MUST join to register
// e.g. "@MelkamBingoOfficial,@MelkamBingoNews"
// ANNOUNCEMENT_CHANNEL_ID is always included automatically if set.
const _extraChannels: string[] = (process.env["REQUIRED_CHANNEL_IDS"] ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);

export const bot = new Bot(token);

// Build the full list after bot is created so CHANNEL_ID is resolved.
// ANNOUNCEMENT_CHANNEL_ID is always mandatory; REQUIRED_CHANNEL_IDS adds extras.
function buildRequiredChannels(): string[] {
  const all = new Set<string>();
  if (CHANNEL_ID) all.add(CHANNEL_ID);
  for (const ch of _extraChannels) all.add(ch);
  return [...all];
}

// ── Channel membership check ──────────────────────────────────────────────────
export async function checkChannelMembership(userId: number): Promise<{ ok: boolean; missing: string[] }> {
  if (!botReady) return { ok: true, missing: [] };
  const required = buildRequiredChannels();
  if (!required.length) return { ok: true, missing: [] };
  const missing: string[] = [];
  for (const ch of required) {
    try {
      const member = await bot.api.getChatMember(ch, userId);
      if (["left", "kicked"].includes(member.status)) missing.push(ch);
    } catch {
      // Treat API errors as "not joined" (fail-closed) so the gate is enforced.
      // Fix: make the bot an admin of the channel so membership can be checked.
      logger.warn({ ch }, "Could not check channel membership — treating as not joined (make bot admin of channel to fix)");
      missing.push(ch);
    }
  }
  return { ok: missing.length === 0, missing };
}

function channelJoinUrl(ch: string): string {
  if (ch.startsWith("@")) return `https://t.me/${ch.slice(1)}`;
  return `https://t.me/c/${ch.replace("-100", "")}`;
}

// ── Channel announcement helper ───────────────────────────────────────────────
export async function postToChannel(message: string): Promise<void> {
  if (!CHANNEL_ID || !botReady) return;
  try {
    await bot.api.sendMessage(CHANNEL_ID, message, { parse_mode: "HTML" });
  } catch (err) {
    logger.warn({ err }, "Failed to post to announcement channel");
  }
}

export async function postToChannelWithButton(
  message: string,
  buttonText: string,
  buttonUrl: string,
): Promise<void> {
  if (!CHANNEL_ID || !botReady) return;
  try {
    await bot.api.sendMessage(CHANNEL_ID, message, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: buttonText, url: buttonUrl }]],
      },
    });
  } catch (err) {
    logger.warn({ err }, "Failed to post to announcement channel");
  }
}

// ── Pending referral store ─────────────────────────────────────────────────────
// When a user clicks t.me/bot?start=ref_X, we store the referrer here BEFORE
// the mini app opens. This is more reliable than URL query params, which some
// Telegram clients strip from web_app URLs.
export const pendingReferrals = new Map<number, number>(); // newUserId → referrerId

// Cache bot username for invite links
let _botUsername: string | null = null;
export async function getBotUsername(): Promise<string | null> {
  if (_botUsername) return _botUsername;
  if (!botReady) return null;
  try {
    const me = await bot.api.getMe();
    _botUsername = me.username ?? null;
    return _botUsername;
  } catch {
    return null;
  }
}

// ── Session state machines ────────────────────────────────────────────────────
type DepositStep = "amount" | "confirm";
type WithdrawStep = "amount" | "phone" | "accountName";

const depositSessions = new Map<number, { step: DepositStep; amount: number }>();
const withdrawSessions = new Map<number, { step: WithdrawStep; amount: number; phone: string; accountName: string }>();
const promoSessions = new Set<number>(); // waiting for promo code input
const adminPasswordSessions = new Set<number>(); // waiting for admin password input

// Support ticket system
// supportSessions: users who clicked Support and are about to type their message
const supportSessions = new Set<number>();
// supportMsgToUser: maps the forwarded message_id (in admin chat) → original user telegram_id
// Allows admin to reply to the forwarded message and have the bot route it back to the user
const supportMsgToUser = new Map<number, number>();


// ── /start ────────────────────────────────────────────────────────────────────
bot.command("start", async (ctx) => {
  const user = ctx.from;
  if (!user) return;

  try {
  // Parse start param FIRST so we can store the referral before any early returns
  const startParam = ctx.match?.trim() ?? "";
  const forwardParam = (startParam.startsWith("ref_") || startParam.startsWith("agentlink_")) ? startParam : null;

  // Store referral server-side BEFORE channel check — if we return early (channel
  // gate), the referral must already be saved so it isn't lost when the user
  // eventually passes the gate and re-opens the bot.
  if (startParam.startsWith("ref_")) {
    const referrerId = Number(startParam.slice(4));
    if (!isNaN(referrerId) && referrerId > 0 && referrerId !== user.id) {
      pendingReferrals.set(user.id, referrerId);
      // Auto-clean after 2 hours in case mini app is never opened
      setTimeout(() => { pendingReferrals.delete(user.id); }, 2 * 60 * 60 * 1000);
      logger.info({ userId: user.id, referrerId }, "Pending referral stored");
    }
  }

  // ── Channel membership gate ──
  const membership = await checkChannelMembership(user.id);
  if (!membership.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const joinRows: any[][] = membership.missing.map(ch => [{ text: `📢 ቻናሉን ይቀላቀሉ`, url: channelJoinUrl(ch) }]);
    joinRows.push([{ text: "✅ ቀላቀልኩ — ቀጥል", callback_data: `chk_${user.id}` }]);
    await ctx.reply(
      `👋 ሰላም ${user.first_name}!\n\n` +
      `🔒 <b>ጨዋታ ለመጀመር ቅድሚያ ቻናሎቻችንን ይቀላቀሉ:</b>\n\n` +
      membership.missing.map(ch => `• ${ch}`).join("\n") +
      `\n\nከተቀላቀሉ በኋላ ✅ ቁልፉን ይጫኑ።`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: joinRows } }
    );
    return;
  }

  // ── Upsert player into DB on /start ──────────────────────────────────────────
  // This ensures the player exists in the DB even before they open the Mini App.
  // New database migrations require re-registration of all users.
  try {
    const existing = await db
      .select({ telegramId: playersTable.telegramId })
      .from(playersTable)
      .where(eq(playersTable.telegramId, user.id))
      .limit(1);

    if (existing.length === 0) {
      // Resolve referrer from pending store
      const pendingReferrerId = pendingReferrals.get(user.id) ?? null;
      let validReferrer: number | null = null;
      if (pendingReferrerId) {
        const refRows = await db
          .select({ telegramId: playersTable.telegramId })
          .from(playersTable)
          .where(eq(playersTable.telegramId, pendingReferrerId))
          .limit(1);
        if (refRows.length > 0) validReferrer = pendingReferrerId;
        pendingReferrals.delete(user.id);
      }

      await db.insert(playersTable).values({
        id: user.id,
        telegramId: user.id,
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        username: user.username ?? null,
        photoUrl: null,
        invitedBy: validReferrer ?? undefined,
        role: "player",
      });
      logger.info({ telegramId: user.id, invitedBy: validReferrer }, "New player registered via /start");

      // Grant agent join bonus if referrer is an agent
      if (validReferrer) {
        void grantAgentJoinBonus(validReferrer, user.first_name);
      }

      // Grant registration bonus if enabled
      if (appSettings.getBool("registerBonusEnabled")) {
        const bonusAmount = appSettings.getNum("registerBonusAmount");
        if (bonusAmount > 0) {
          await db.update(playersTable).set({
            balance: sql`${playersTable.balance} + ${bonusAmount}`,
          }).where(eq(playersTable.telegramId, user.id));
          await db.insert(transactionsTable).values({
            telegramId: user.id,
            type: "register_bonus",
            amount: `${bonusAmount}`,
            status: "approved",
            note: "የምዝገባ ቦነስ",
          });
        }
      }
    } else {
      // Update name/username in case they changed
      await db.update(playersTable).set({
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        username: user.username ?? null,
        updatedAt: new Date(),
      }).where(eq(playersTable.telegramId, user.id));
      logger.info({ telegramId: user.id }, "Existing player profile refreshed via /start");
    }
  } catch (err) {
    logger.error({ err, telegramId: user.id }, "Failed to upsert player on /start");
  }

  // Remove any lingering persistent reply keyboard silently
  try {
    const rmMsg = await ctx.reply("\u200B", { reply_markup: { remove_keyboard: true } });
    await bot.api.deleteMessage(ctx.chat.id, rmMsg.message_id);
  } catch { /* non-fatal */ }

  const miniAppUrl = (process.env["MINI_APP_URL"] ?? _botDomain)?.trim() || null;
  const appUrl = miniAppUrl ? `https://${miniAppUrl}` : null;

  const playUrl = appUrl
    ? (forwardParam ? `${appUrl}?startapp=${forwardParam}` : appUrl)
    : null;

  // Join Channel URL — hardcoded to official channel
  const joinChannelUrl = "https://t.me/melkambingo";

  // Build inline keyboard matching app layout
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const startKb: any[][] = [
    [
      ...(playUrl ? [{ text: "🎮 Play Game (ካፈት)", web_app: { url: playUrl } }] : [{ text: "🎮 Play Game (ካፈት)", callback_data: `cmd_noplay_${user.id}` }]),
    ],
    [
      { text: "🏦 Add Funds (ገቢ)", callback_data: `cmd_deposit_${user.id}` },
      { text: "💵 Cash Out (ወጪ)", callback_data: `cmd_withdraw_${user.id}` },
    ],
    [
      { text: "📊 My Balance (ቀሪ ሂሳብ)", callback_data: `cmd_balance_${user.id}` },
      { text: "🤝 Refer & Earn (ይጋብዙ)", callback_data: `cmd_invite_${user.id}` },
    ],
    [
      { text: "📜 How to Play (መመሪያ)", callback_data: `cmd_howtoplay_${user.id}` },
      { text: "🎧 Support (እርዳታ)", callback_data: `cmd_support_${user.id}` },
    ],
    [
      { text: "👤 Register (መመዝገቢያ)", callback_data: `cmd_register_${user.id}` },
    ],
    [
      { text: "🎟 Promo Code", callback_data: `cmd_promo_${user.id}` },
      { text: "🔄 Transfer", callback_data: `cmd_transfer_${user.id}` },
    ],
    [
      { text: "📣 Join Channel", url: joinChannelUrl },
      { text: "📢 Bonus Group", callback_data: `cmd_channel_bonus_${user.id}` },
    ],
    // Admin button — only visible to the designated main admin
    ...(MAIN_ADMIN_TELEGRAM_ID > 0 && user.id === MAIN_ADMIN_TELEGRAM_ID
      ? [[{ text: "🔐 Admin Panel", callback_data: `cmd_admin_${user.id}` }]]
      : []),
  ];

  // Full welcome text (for plain text messages — up to 4096 chars)
  const welcomeText =
    `🎱 <b>እንኳን ወደ Melbet BINGO መጡ!</b>\n\n` +
    `🎮 <b>ለጀማሪዎች — እንዴት ይጀምሩ?</b>\n` +
    `1️⃣ <b>👤 Register</b> — አካዉንት ይክፈቱ\n` +
    `2️⃣ <b>🏦 Add Funds</b> — ከ10ብር ጀምሮ ያስገቡ\n` +
    `3️⃣ <b>🎮 Play Game</b> — ጨዋታ ይጀምሩ!\n\n` +
    `📋 <b>ሌሎች አማራጮች</b>\n` +
    `📊 <b>My Balance</b> — ቀሪ ሂሳብ ያሳያሉ\n` +
    `💵 <b>Cash Out</b> — ገንዘብ ያውጡ\n` +
    `🤝 <b>Refer & Earn</b> — ጓደኛ ጋብዙ (5% ቦነስ)\n` +
    `🎟 <b>Promo Code</b> — ፕሮሞ ኮድ ያስገቡ\n` +
    `🔄 <b>Transfer</b> — ወደ ሌላ ላኩ\n` +
    `📣 <b>Join Channel</b> — ቻናሉን ይቀላቀሉ\n` +
    `🎧 <b>Support</b> — እርዳታ ይጠይቁ\n\n` +
    `👇 ከታቹ ቁልፍ ይምረጡ`;

  // Short caption for photo messages (Telegram limit: 1024 chars)
  const welcomeCaption =
    `🎱 <b>እንኳን ወደ Melbet BINGO መጡ!</b>\n\n` +
    `1️⃣ 👤 Register — አካዉንት ይክፈቱ\n` +
    `2️⃣ 🏦 Add Funds — ከ10ብር ጀምሮ ያስገቡ\n` +
    `3️⃣ 🎮 Play Game — ጨዋታ ይጀምሩ!\n\n` +
    `👇 ከታቹ ቁልፍ ይምረጡ`;

  // Send welcome photo from DB setting (Base64) or env-var Telegram file_id, fallback to text.
  const welcomeImgBase64 = appSettings.get("welcomeImageBase64");
  const welcomeImageId = process.env["BOT_WELCOME_IMAGE_ID"] ?? "";
  try {
    if (welcomeImgBase64) {
      const buf = Buffer.from(welcomeImgBase64, "base64");
      await ctx.replyWithPhoto(new InputFile(buf, "welcome.jpg"), {
        caption: welcomeCaption,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: startKb },
      });
    } else if (welcomeImageId) {
      await ctx.replyWithPhoto(welcomeImageId, {
        caption: welcomeCaption,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: startKb },
      });
    } else {
      await ctx.reply(welcomeText, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: startKb },
      });
    }
  } catch {
    // Fallback to text if photo send fails
    await ctx.reply(welcomeText, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: startKb },
    });
  }

  logger.info({ telegramId: user.id, forwardParam }, "User started bot");

  } catch (startErr) {
    logger.error({ err: startErr, telegramId: user.id }, "/start handler error — sending fallback");
    try {
      const fallbackKb = [
        [{ text: "🎮 Play Game (ካፈት)", callback_data: `cmd_noplay_${user.id}` }],
        [
          { text: "🏦 Add Funds (ገቢ)", callback_data: `cmd_deposit_${user.id}` },
          { text: "💵 Cash Out (ወጪ)", callback_data: `cmd_withdraw_${user.id}` },
        ],
        [
          { text: "📊 My Balance (ቀሪ ሂሳብ)", callback_data: `cmd_balance_${user.id}` },
          { text: "🤝 Refer & Earn (ይጋብዙ)", callback_data: `cmd_invite_${user.id}` },
        ],
        [
          { text: "📜 How to Play (መመሪያ)", callback_data: `cmd_howtoplay_${user.id}` },
          { text: "🎧 Support (እርዳታ)", callback_data: `cmd_support_${user.id}` },
        ],
        [{ text: "👤 Register (መመዝገቢያ)", callback_data: `cmd_register_${user.id}` }],
        [
          { text: "🎟 Promo Code", callback_data: `cmd_promo_${user.id}` },
          { text: "🔄 Transfer", callback_data: `cmd_transfer_${user.id}` },
        ],
        [
          { text: "📣 Join Channel", url: "https://t.me/melkambingo" },
          { text: "📢 Bonus Group", callback_data: `cmd_channel_bonus_${user.id}` },
        ],
      ];
      await ctx.reply(
        `🎱 <b>እንኳን ወደ Melbet BINGO መጡ!</b>\n\n👇 ቁልፍ ይምረጡ`,
        { parse_mode: "HTML", reply_markup: { inline_keyboard: fallbackKb } }
      );
    } catch { /* non-fatal */ }
  }
});

// ── Membership re-check callback ──────────────────────────────────────────────
bot.callbackQuery(/^chk_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery("⏳ እያረጋገጠ ነው...");

  const membership = await checkChannelMembership(userId);
  if (!membership.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const joinRows: any[][] = membership.missing.map(ch => [{ text: `📢 ቻናሉን ይቀላቀሉ`, url: channelJoinUrl(ch) }]);
    joinRows.push([{ text: "✅ ቀላቀልኩ — ቀጥል", callback_data: `chk_${userId}` }]);
    await ctx.editMessageText(
      `⚠️ አሁንም ቻናሉን አልተቀላቀሉም።\n\n` +
      membership.missing.map(ch => `• ${ch}`).join("\n") +
      `\n\nቀላቅለው እንደገና ✅ ይጫኑ።`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: joinRows } }
    );
    return;
  }

  await ctx.editMessageText("✅ አመሰግናለሁ! አሁን /start ን ይጫኑ ወደ ጨዋታ ለመግባት።");
});

// ── Inline button callbacks for /start menu ───────────────────────────────────
bot.callbackQuery(/^cmd_deposit_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  depositSessions.set(userId, { step: "amount", amount: 0 });
  withdrawSessions.delete(userId);
  await ctx.reply(`ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ`);
});

bot.callbackQuery(/^cmd_withdraw_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  try {
    const rows = await db.select().from(playersTable).where(eq(playersTable.telegramId, userId)).limit(1);
    if (!rows.length) { await ctx.reply("❌ አካዉንት አልተገኘም። /start ን ይጫኑ።"); return; }
    const balance = Number(rows[0]!.balance);
    const playBalance = Number(rows[0]!.playBalance);
    const withdrawable = Math.max(balance - playBalance, 0);
    const effectiveWithdrawable = Math.max(withdrawable - 10, 0);
    if (effectiveWithdrawable < 100) {
      await ctx.reply(
        `⚠️ ለማውጣት ቢያንስ <b>100 ብር</b> ማውጣት የሚቻል ባላንስ ያስፈልጋል።\n\n` +
        `💳 ጠቅላላ ባላንስ: <b>${balance.toFixed(2)} ብር</b>\n` +
        `🎮 Play Wallet: <b>${playBalance.toFixed(2)} ብር</b>\n` +
        `💸 ማውጣት የሚቻል: <b>${effectiveWithdrawable.toFixed(2)} ብር</b>\n\n` +
        `📌 ዲፖዚት የተደረገ እና ቦነስ ያለ ባላንስ ዊዝድሮው ማድረግ አይቻልም።\n` +
        `📌 ከዊዝድሮው በኋላ ቢያንስ 10 ብር አካውንት ውስጥ መቅረት አለበት።`,
        { parse_mode: "HTML" }
      );
      return;
    }
    depositSessions.delete(userId);
    withdrawSessions.set(userId, { step: "amount", amount: 0, phone: "", accountName: "" });
    await ctx.reply(
      `💸 ማውጣት የሚፈልጉትን መጠን ያስጊቡ:\n\n` +
      `💳 ጠቅላላ ባላንስ: <b>${balance.toFixed(2)} ብር</b>\n` +
      `💸 ማውጣት የሚቻል: <b>${effectiveWithdrawable.toFixed(2)} ብር</b>\n\n` +
      `⚠️ ቢያንስ 100 ብር ማውጣት ይቻላል\n` +
      `📌 ከዊዝድሮው በኋላ ቢያንስ 10 ብር አካውንት ውስጥ ይቀራል`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "cmd_withdraw callback error");
    await ctx.reply("❌ ስህተት ተፈጥሯል።");
  }
});

bot.callbackQuery(/^cmd_balance_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  try {
    const rows = await db.select().from(playersTable).where(eq(playersTable.telegramId, userId)).limit(1);
    if (!rows.length) { await ctx.reply("❌ አካዉንት አልተገኘም። /start ን ይጫኑ።"); return; }
    const balance = Number(rows[0]!.balance);
    const playBalance = Number(rows[0]!.playBalance);
    const withdrawable = Math.max(balance - playBalance, 0);
    const isAgent = rows[0]!.role === "agent";
    const agentBalance = Number(rows[0]!.agentBalance);
    await ctx.reply(
      `💳 <b>ባላንስ ዝርዝር</b>\n\n` +
      `🏦 ዋና ዋሌት (ጠቅላላ): <b>${balance.toFixed(2)} ብር</b>\n` +
      `🎮 Play Wallet: <b>${playBalance.toFixed(2)} ብር</b>\n` +
      `💸 ማውጣት የሚቻል: <b>${withdrawable.toFixed(2)} ብር</b>` +
      (isAgent ? `\n\n💼 <b>Agent Wallet: ${agentBalance.toFixed(2)} ብር</b>` : "") +
      `\n\n📌 ዲፖዚት/ቦነስ ዊዝድሮው አይቻልም።`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "cmd_balance callback error");
    await ctx.reply("❌ ስህተት ተፈጥሯል።");
  }
});

bot.callbackQuery(/^cmd_invite_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const botUsername = await getBotUsername();
  if (!botUsername) { await ctx.reply("❌ ሊንክ ማምጣት አልተቻለም።"); return; }
  const inviteLink = `https://t.me/${botUsername}?start=ref_${userId}`;
  const firstName = ctx.from.first_name ?? "ወዳጆ";
  const shareText = `🎁 ${firstName} ወደ Melbet BINGO ወዳጅ ዘመድ ይጋበዙ እና ሸልማቶችን ያግኙ!\n\n${inviteLink}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(`🎁 ${firstName} ወደ Melbet BINGO ወዳጅ ዘመድ ይጋበዙ እና ሸልማቶችን ያግኙ!`)}`;
  await ctx.reply(shareText, {
    reply_markup: {
      inline_keyboard: [[{ text: "🔗 ሊንኩን ላክ (Share Link)", url: shareUrl }]],
    },
  });
});

// ── Register button ────────────────────────────────────────────────────────────
bot.callbackQuery(/^cmd_register_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  try {
    const rows = await db.select({
      firstName: playersTable.firstName,
      balance: playersTable.balance,
      createdAt: playersTable.createdAt,
    }).from(playersTable).where(eq(playersTable.telegramId, userId)).limit(1);

    if (rows.length) {
      await ctx.reply(
        `✅ <b>ተመዝግበዋል!</b>\n\n` +
        `👤 ስም: <b>${rows[0]!.firstName}</b>\n` +
        `💳 ባላንስ: <b>${Number(rows[0]!.balance).toFixed(2)} ብር</b>\n\n` +
        `🎮 ጨዋታ ለመጀመር <b>Play</b> ቁልፍ ይጫኑ!`,
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.reply(
        `📝 <b>ምዝገባ</b>\n\n` +
        `ምዝገባ ለማጠናቀቅ /start ን እንደገና ይጫኑ።`,
        { parse_mode: "HTML" }
      );
    }
  } catch (err) {
    logger.error({ err }, "cmd_register callback error");
    await ctx.reply("❌ ስህተት ተፈጥሯል።");
  }
});

// ── Shared promo code redemption helper ────────────────────────────────────────
async function redeemPromoCode(telegramId: number, rawCode: string): Promise<string> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return "❌ ኮዱን ያስጊቡ። ምሳሌ: /promo SAVE20";
  const codeRows = await db.select().from(promoCodesTable).where(eq(promoCodesTable.code, code)).limit(1);
  if (!codeRows.length) return "❌ ኮዱ አልተገኘም። እንደገና ያረጋግጡ።";
  const promo = codeRows[0]!;
  if (!promo.isActive) return "❌ ይህ ፕሮሞ ኮድ አሁን ንቁ አይደለም።";
  if (promo.usedCount >= promo.maxUses) return "❌ ኮዱ ጥቅም ላይ ውሏል — ቦናሱ አልቋል።";
  if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) return "❌ ፕሮሞ ኮዱ ጊዜው አልቋል።";
  const usageRows = await db.select({ id: promoCodeUsagesTable.id }).from(promoCodeUsagesTable)
    .where(and(eq(promoCodeUsagesTable.promoCodeId, promo.id), eq(promoCodeUsagesTable.telegramId, telegramId))).limit(1);
  if (usageRows.length) return "❌ ይህን ኮድ ቀድሞ ተጠቅመዋል።";
  const playerRows = await db.select({ telegramId: playersTable.telegramId }).from(playersTable)
    .where(eq(playersTable.telegramId, telegramId)).limit(1);
  if (!playerRows.length) return "❌ አካውንት አልተገኘም። /start ይጫኑ።";
  const bonus = Number(promo.bonusAmount);
  await db.update(playersTable).set({ balance: sql`${playersTable.balance} + ${bonus}` }).where(eq(playersTable.telegramId, telegramId));
  await db.update(promoCodesTable).set({ usedCount: sql`${promoCodesTable.usedCount} + 1` }).where(eq(promoCodesTable.id, promo.id));
  await db.insert(promoCodeUsagesTable).values({ promoCodeId: promo.id, telegramId });
  await db.insert(transactionsTable).values({ telegramId, type: "promo_bonus", amount: `${bonus}`, status: "approved", note: `ፕሮሞ ኮድ: ${code}` });
  logger.info({ telegramId, code, bonus }, "Promo code redeemed");
  return `🎉 <b>ፕሮሞ ቦነስ ደረሰዎ!</b>\n\n🏷️ ኮድ: <code>${code}</code>\n💰 <b>${bonus.toFixed(2)} ብር</b> ወደ ዋሌትዎ ተጨምሯል!`;
}

// ── /promo command — direct code entry: /promo CODE ───────────────────────────
bot.command("promo", async (ctx) => {
  const user = ctx.from;
  if (!user) return;
  const arg = ctx.match?.trim() ?? "";
  if (!arg) {
    // No code given — start the session flow
    promoSessions.add(user.id);
    depositSessions.delete(user.id);
    withdrawSessions.delete(user.id);
    await ctx.reply(`🎟 <b>ፕሮሞ ኮድ ያስገቡ:</b>\n\n<i>ኮዱን ጽፈው ይላኩ — ወይም /promo CODE ብለው ቀጥታ ያስጊቡ</i>`, { parse_mode: "HTML" });
    return;
  }
  try {
    const msg = await redeemPromoCode(user.id, arg);
    await ctx.reply(msg, { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ err }, "promo command error");
    await ctx.reply("❌ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።");
  }
});

// ── Promo code button ──────────────────────────────────────────────────────────
bot.callbackQuery(/^cmd_promo_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  promoSessions.add(userId);
  depositSessions.delete(userId);
  withdrawSessions.delete(userId);
  await ctx.reply(`🎟 <b>ፕሮሞ ኮድ ያስገቡ:</b>\n\n<i>ኮዱን ጽፈው ይላኩ — ወይም /promo CODE ብለው ቀጥታ ያስጊቡ</i>`, { parse_mode: "HTML" });
});

// ── Support button ─────────────────────────────────────────────────────────────
bot.callbackQuery(/^cmd_support_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  const supportUsername = (process.env["SUPPORT_USERNAME"] ?? "").replace(/^@/, "");
  if (!supportUsername) {
    await ctx.reply("❌ Support username አልተዋቀረም። እንደገና ይሞክሩ።");
    return;
  }
  const supportUrl = `https://t.me/${supportUsername}`;
  await ctx.reply(
    `🎧 <b>Support (እርዳታ)</b>\n\nቡድናችን ለእርዳታ ዝግጁ ነው። ከዚህ ላይ ይጫኑ:`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "💬 Support ይክፈቱ", url: supportUrl }]],
      },
    }
  );
  logger.info({ telegramId: userId, supportUsername }, "User directed to support username");
});


// ── Admin Panel button ────────────────────────────────────────────────────────
bot.callbackQuery(/^cmd_admin_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  // Extra guard: only the designated main admin may proceed
  if (MAIN_ADMIN_TELEGRAM_ID <= 0 || userId !== MAIN_ADMIN_TELEGRAM_ID) {
    return ctx.answerCallbackQuery({ text: "❌ አልተፈቀደም", show_alert: true });
  }
  await ctx.answerCallbackQuery();
  adminPasswordSessions.add(userId);
  depositSessions.delete(userId);
  withdrawSessions.delete(userId);
  promoSessions.delete(userId);
  supportSessions.delete(userId);
  await ctx.reply(
    `🔐 <b>Admin Panel</b>\n\nፓስወርድ ያስገቡ:`,
    { parse_mode: "HTML" }
  );
});

// ── How to Play button ────────────────────────────────────────────────────────
bot.callbackQuery(/^cmd_howtoplay_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `📜 <b>የMelbet ቢንጎ ጨዋታ ህጎች</b>\n\n` +
    `🃏 <b>መጫወቻ ካርድ</b>\n\n` +
    `1. ጨዋታውን ለመጀመር ከሚመጣልን ከ1-500 የመጫወቻ ካርድ ውስጥ አንዱን እንመርጣለን።\n\n` +
    `2. የመጫወቻ ካርዱ ላይ በቀይ ቀለም የተመረጡ ቁጥሮች የሚያሳዩት መጫወቻ ካርድ በሌላ ተጫዋች መመረጡን ነው።\n\n` +
    `3. የመጫወቻ ካርድ ስንነካው ከታች በኩል ካርድ ቁጥሩ የሚይዘዉን መጫወቻ ካርድ ያሳየናል።\n\n` +
    `4. ወደ ጨዋታው ለመግባት የምንፈልገዉን ካርድ ከመረጥን ለምዝገባ የተሰጠው ሰኮንድ ዜሮ ሲሆን ቀጥታ ወደ ጨዋታ ያስገባናል።\n\n` +
    `🎮 <b>ጨዋታ</b>\n\n` +
    `1. ወደ ጨዋታው ስንገባ በመረጥነው የካርድ ቁጥር መሰረት የመጫወቻ ካርድ እናገኛለን።\n\n` +
    `2. ጨዋታው ሲጀመር የተለያዪ ቁጥሮች ከ1 እስከ 75 መጥራት ይጀምራል።\n\n` +
    `3. የሚጠራው ቁጥር የኛ መጫወቻ ካርድ ውስጥ ካለ ራሱ auto ማርክ ያረግልናል።\n\n` +
    `🏆 <b>አሸናፊ</b>\n\n` +
    `1. ቁጥሮቹ ሲጠሩ ወደጎን ወይም ወደታች ወይም ወደሁለቱም አግዳሚ ወይም አራቱን ማእዘናት 1 መስመር ከሰራልን እናሸንፋለን።\n\n` +
    `2. ሁለት ወይም ከዚያ በላይ ተጫዋቾች እኩል ቢያሸንፉ ደራሹ ለቁጥራቸው ይካፈላል።`,
    { parse_mode: "HTML" }
  );
});

// ── No play URL (fallback) ─────────────────────────────────────────────────────
bot.callbackQuery(/^cmd_noplay_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery({ text: "⚠️ Mini App አሁን ዝግጁ አይደለም።", show_alert: true });
});

// ── Transfer button ────────────────────────────────────────────────────────────
// Simple peer-to-peer balance transfer via Telegram username or ID
const transferSessions = new Map<number, { step: "target" | "amount"; target: string; targetId: number }>();

bot.callbackQuery(/^cmd_transfer_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  transferSessions.set(userId, { step: "target", target: "", targetId: 0 });
  await ctx.reply(
    `🔄 <b>ቶከን ማስተላለፍ</b>\n\n` +
    `🔄 ባላንስ ሊያስተላልፉለት የሚፈልጉትን ተጫዋቸ @username ወይም Telegram ID ያስገቡ ።`,
    { parse_mode: "HTML" }
  );
});

// ── Channel Join Bonus ────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleChannelBonusCheck(ctx: any) {
  const userId = ctx.from.id;
  await ctx.answerCallbackQuery();

  // 1. Check Telegram membership
  let isMember = false;
  try {
    const member = await bot.api.getChatMember(BONUS_CHANNEL_USERNAME, userId);
    isMember = ["member", "administrator", "creator"].includes(member.status);
  } catch {
    // Channel not found or bot not admin — treat as not member
  }

  if (!isMember) {
    await ctx.reply(
      `❌ ቦነሱን ለማግኘት እባክዎን አዲሱን ቴሌግራም ቻናላችንን ይቀላቀሉ!`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 ቻናሉን ይቀላቀሉ", url: `https://t.me/${BONUS_CHANNEL_USERNAME.replace("@", "")}` }],
            [{ text: "🔄 አባል ሆኛለሁ ቼክ አድርግ (Verify)", callback_data: `cmd_channel_verify_${userId}` }],
          ],
        },
      }
    );
    return;
  }

  // 2. Check if bonus already claimed
  const rows = await db
    .select({ hasClaimedChannelBonus: playersTable.hasClaimedChannelBonus })
    .from(playersTable)
    .where(eq(playersTable.telegramId, userId))
    .limit(1);

  if (!rows.length) {
    await ctx.reply("❌ አካውንት አልተገኘም። /start ን ይሞክሩ።");
    return;
  }

  if (rows[0]!.hasClaimedChannelBonus) {
    await ctx.reply("⚠️ ይህንን የቻናል ቦነስ ቀደም ብለው ወስደዋል።");
    return;
  }

  // 3. Award bonus
  await db
    .update(playersTable)
    .set({
      balance: sql`${playersTable.balance} + ${CHANNEL_JOIN_BONUS}`,
      playBalance: sql`${playersTable.playBalance} + ${CHANNEL_JOIN_BONUS}`,
      hasClaimedChannelBonus: true,
    })
    .where(eq(playersTable.telegramId, userId));

  await db.insert(transactionsTable).values({
    telegramId: userId,
    type: "channel_bonus",
    amount: `${CHANNEL_JOIN_BONUS}`,
    status: "approved",
    note: "የቻናል ቦነስ",
  });

  await ctx.reply(
    `🎉 እንኳን ደስ አለዎት! ቻናላችንን ስለተቀላቀሉ የ ${CHANNEL_JOIN_BONUS} ብር ቦነስ ተጨምሮልዎታል።`
  );
}

bot.callbackQuery(/^cmd_channel_bonus_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== Number(ctx.match[1])) return ctx.answerCallbackQuery();
  await handleChannelBonusCheck(ctx);
});

bot.callbackQuery(/^cmd_channel_verify_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== Number(ctx.match[1])) return ctx.answerCallbackQuery();
  await handleChannelBonusCheck(ctx);
});

// ── /invite ───────────────────────────────────────────────────────────────────
bot.command("invite", async (ctx) => {
  const user = ctx.from;
  if (!user) return;
  const botUsername = await getBotUsername();
  if (!botUsername) {
    await ctx.reply("❌ ሊንክ ማምጣት አልተቻለም። እንደገና ይሞክሩ።");
    return;
  }
  const inviteLink = `https://t.me/${botUsername}?start=ref_${user.id}`;
  const firstName = user.first_name ?? "ወዳጆ";
  const shareText = `🎁 ${firstName} ወደ Melbet BINGO ወዳጅ ዘመድ ይጋበዙ እና ሸልማቶችን ያግኙ!\n\n${inviteLink}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(`🎁 ${firstName} ወደ Melbet BINGO ወዳጅ ዘመድ ይጋበዙ እና ሸልማቶችን ያግኙ!`)}`;
  await ctx.reply(shareText, {
    reply_markup: {
      inline_keyboard: [[{ text: "🔗 ሊንኩን ላክ (Share Link)", url: shareUrl }]],
    },
  });
});

// ── /balance ──────────────────────────────────────────────────────────────────
bot.command("balance", async (ctx) => {
  const user = ctx.from;
  if (!user) return;
  try {
    const rows = await db.select().from(playersTable).where(eq(playersTable.telegramId, user.id)).limit(1);
    if (!rows.length) { await ctx.reply("❌ አካዉንት አልተገኘም። /start ን ይጫኑ።"); return; }
    const balance = Number(rows[0]!.balance);
    const playBalance = Number(rows[0]!.playBalance);
    const withdrawable = Math.max(balance - playBalance, 0);
    const isAgent = rows[0]!.role === "agent";
    const agentBalance = Number(rows[0]!.agentBalance);
    await ctx.reply(
      `💳 <b>ባላንስ ዝርዝር</b>\n\n` +
      `🏦 ዋና ዋሌት (ጠቅላላ): <b>${balance.toFixed(2)} ብር</b>\n` +
      `🎮 Play Wallet: <b>${playBalance.toFixed(2)} ብር</b>\n` +
      `💸 ማውጣት የሚቻል: <b>${withdrawable.toFixed(2)} ብር</b>` +
      (isAgent ? `\n\n💼 <b>Agent Wallet: ${agentBalance.toFixed(2)} ብር</b>` : "") +
      `\n\n📌 ዲፖዚት/ቦነስ ዊዝድሮው አይቻልም።`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "balance command error");
    await ctx.reply("❌ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።");
  }
});

// ── /agentbalance ─────────────────────────────────────────────────────────────
bot.command("agentbalance", async (ctx) => {
  const user = ctx.from;
  if (!user) return;
  try {
    const rows = await db.select({
      role: playersTable.role,
      agentBalance: playersTable.agentBalance,
      inviteCount: sql<number>`(SELECT COUNT(*) FROM players WHERE invited_by = ${user.id})`,
    }).from(playersTable).where(eq(playersTable.telegramId, user.id)).limit(1);
    if (!rows.length) { await ctx.reply("❌ አካዉንት አልተገኘም። /start ን ይጫኑ።"); return; }
    if (rows[0]!.role !== "agent") {
      await ctx.reply("⛔ ይህ ትዕዛዝ ለ<b>Agents</b> ብቻ ነው።\n\nAgent ለመሆን admin ያነጋግሩ።", { parse_mode: "HTML" });
      return;
    }
    const agentBalance = Number(rows[0]!.agentBalance);
    const inviteCount = Number(rows[0]!.inviteCount ?? 0);
    await ctx.reply(
      `💼 <b>Agent Wallet</b>\n\n` +
      `💰 Agent Balance: <b>${agentBalance.toFixed(2)} ብር</b>\n` +
      `👥 ያጋበዟቸው ተጫዋቾች: <b>${inviteCount}</b>\n\n` +
      `📌 Agent balance ለ withdrawal Admin ያነጋግሩ።`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "agentbalance command error");
    await ctx.reply("❌ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።");
  }
});

// ── /deposit ──────────────────────────────────────────────────────────────────
bot.command("deposit", async (ctx) => {
  const user = ctx.from;
  if (!user) return;
  depositSessions.set(user.id, { step: "amount", amount: 0 });
  withdrawSessions.delete(user.id);
  await ctx.reply(`ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ`);
});

// ── /withdraw ─────────────────────────────────────────────────────────────────
bot.command("withdraw", async (ctx) => {
  const user = ctx.from;
  if (!user) return;

  try {
    const rows = await db.select().from(playersTable).where(eq(playersTable.telegramId, user.id)).limit(1);
    if (!rows.length) { await ctx.reply("❌ አካዉንት አልተገኘም። /start ን ይጫኑ።"); return; }
    const balance = Number(rows[0]!.balance);
    const playBalance = Number(rows[0]!.playBalance);
    const withdrawable = Math.max(balance - playBalance, 0);
    const effectiveWithdrawable = Math.max(withdrawable - 10, 0);
    if (effectiveWithdrawable < 100) {
      await ctx.reply(
        `⚠️ ለማውጣት ቢያንስ <b>100 ብር</b> ማውጣት የሚቻል ባላንስ ያስፈልጋል።\n\n` +
        `💳 ጠቅላላ ባላንስ: <b>${balance.toFixed(2)} ብር</b>\n` +
        `🎮 Play Wallet: <b>${playBalance.toFixed(2)} ብር</b>\n` +
        `💸 ማውጣት የሚቻል: <b>${effectiveWithdrawable.toFixed(2)} ብር</b>\n\n` +
        `📌 ዲፖዚት የተደረገ እና ቦነስ ያለ ባላንስ ዊዝድሮው ማድረግ አይቻልም።\n` +
        `📌 ከዊዝድሮው በኋላ ቢያንስ 10 ብር አካውንት ውስጥ መቅረት አለበት።`,
        { parse_mode: "HTML" }
      );
      return;
    }
    depositSessions.delete(user.id);
    withdrawSessions.set(user.id, { step: "amount", amount: 0, phone: "", accountName: "" });
    await ctx.reply(
      `💸 ማውጣት የሚፈልጉትን መጠን ያስጊቡ:\n\n` +
      `💳 ጠቅላላ ባላንስ: <b>${balance.toFixed(2)} ብር</b>\n` +
      `🎮 Play Wallet: <b>${playBalance.toFixed(2)} ብር</b>\n` +
      `💸 ማውጣት የሚቻል: <b>${effectiveWithdrawable.toFixed(2)} ብር</b>\n\n` +
      `⚠️ ቢያንስ 100 ብር ማውጣት ይቻላል\n` +
      `📌 ከዊዝድሮው በኋላ ቢያንስ 10 ብር አካውንት ውስጥ ይቀራል`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "withdraw command error");
    await ctx.reply("❌ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።");
  }
});

// ── /pending — Admin only: pending deposits ───────────────────────────────────
bot.command("pending", async (ctx) => {
  const user = ctx.from;
  if (!user || user.id !== ADMIN_ID) return;
  try {
    const deposits = await db
      .select()
      .from(pendingDepositsTable)
      .where(eq(pendingDepositsTable.status, "pending"))
      .orderBy(desc(pendingDepositsTable.createdAt))
      .limit(20);
    if (!deposits.length) { await ctx.reply("✅ አሁን የሚጠባበቅ deposit የለም።"); return; }
    for (const dep of deposits) {
      const kb = new InlineKeyboard().text("✅ አፀድቅ", `approve_${dep.id}`).text("❌ ሰርዝ", `reject_${dep.id}`);
      await ctx.reply(
        `📥 <b>Deposit #${dep.id}</b>\n👤 ${dep.firstName} (${dep.telegramId})\n💰 <b>${Number(dep.amount).toFixed(0)} ብር</b>\n` +
        (dep.confirmationText ? `📝 Confirmation:\n<code>${dep.confirmationText}</code>` : ""),
        { parse_mode: "HTML", reply_markup: kb }
      );
    }
  } catch (err) { logger.error({ err }, "pending command error"); }
});

// ── /pendingwithdraw — Admin only: pending withdrawals ────────────────────────
bot.command("pendingwithdraw", async (ctx) => {
  const user = ctx.from;
  if (!user || user.id !== ADMIN_ID) return;
  try {
    const withdrawals = await db
      .select()
      .from(pendingWithdrawalsTable)
      .where(eq(pendingWithdrawalsTable.status, "pending"))
      .orderBy(desc(pendingWithdrawalsTable.createdAt))
      .limit(20);
    if (!withdrawals.length) { await ctx.reply("✅ አሁን የሚጠባበቅ withdraw የለም።"); return; }
    for (const w of withdrawals) {
      const kb = new InlineKeyboard().text("✅ ልከዋለሁ", `approvew_${w.id}`).text("❌ ሰርዝ", `rejectw_${w.id}`);
      await ctx.reply(
        `📤 <b>Withdrawal #${w.id}</b>\n👤 ${w.firstName} (${w.telegramId})\n💸 <b>${Number(w.amount).toFixed(0)} ብር</b>\n📞 Telebirr: <code>${w.phone}</code>\n🏷 አካውንት ሆልደር: <b>${w.accountName || "—"}</b>`,
        { parse_mode: "HTML", reply_markup: kb }
      );
    }
  } catch (err) { logger.error({ err }, "pendingwithdraw command error"); }
});

// ── /banned — Admin only: list currently banned players ───────────────────────
bot.command("banned", async (ctx) => {
  const user = ctx.from;
  if (!user || user.id !== ADMIN_ID) return;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        telegramId: depositCodeAttemptsTable.telegramId,
        failCount: count(),
      })
      .from(depositCodeAttemptsTable)
      .where(and(
        eq(depositCodeAttemptsTable.isValid, false),
        gte(depositCodeAttemptsTable.createdAt, since),
      ))
      .groupBy(depositCodeAttemptsTable.telegramId)
      .having(({ failCount }) => gte(failCount, MAX_FAILURES));

    if (!rows.length) {
      await ctx.reply("✅ አሁን ምንም banned ተጫዋቾች የሉም።");
      return;
    }

    const lines = rows.map(r => `👤 <code>${r.telegramId}</code> — ${r.failCount} ስህተት`).join("\n");
    await ctx.reply(
      `🚫 <b>ባነድ ተጫዋቾች (${rows.length})</b>\n\n${lines}\n\n` +
      `<i>ለ unban: /unban &lt;telegramId&gt;</i>`,
      { parse_mode: "HTML" }
    );
  } catch (err) { logger.error({ err }, "banned command error"); }
});

// ── /makeagent — Admin only: promote a user to agent role ─────────────────────
bot.command("makeagent", async (ctx) => {
  const user = ctx.from;
  if (!user || user.id !== ADMIN_ID) return;
  const parts = ctx.message?.text?.split(" ") ?? [];
  const targetId = Number(parts[1]);
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("❌ አጠቃቀም: /makeagent <telegramId>");
    return;
  }
  try {
    const rows = await db.select({ firstName: playersTable.firstName, role: playersTable.role })
      .from(playersTable).where(eq(playersTable.telegramId, targetId)).limit(1);
    if (!rows.length) { await ctx.reply("❌ ተጫዋቹ አልተገኘም።"); return; }
    if (rows[0]!.role === "agent") { await ctx.reply(`ℹ️ <code>${targetId}</code> አስቀድሞ Agent ነው።`, { parse_mode: "HTML" }); return; }
    await db.update(playersTable).set({ role: "agent" }).where(eq(playersTable.telegramId, targetId));
    await ctx.reply(`✅ <code>${targetId}</code> (${rows[0]!.firstName}) ወደ <b>Agent</b> ተሸጋሚ ሆኗል።`, { parse_mode: "HTML" });
    try {
      await bot.api.sendMessage(targetId,
        `🎉 <b>Agent ሆነዋል!</b>\n\nAgent ስለሆኑ፦\n` +
        `• ጓደኞቻቸው ሲቀላቀሉ <b>5 ብር</b> ወደ Agent Wallet\n` +
        `• ጓደኞቻቸው ዲፖዚት ባደረጉ ቁጥር <b>5%</b> commission\n\n` +
        `💼 Agent balance ለማየት: /agentbalance`,
        { parse_mode: "HTML" }
      );
    } catch { /* non-fatal */ }
    logger.info({ targetId, adminId: user.id }, "User promoted to agent");
  } catch (err) { logger.error({ err }, "makeagent command error"); await ctx.reply("❌ ስህተት ተፈጥሯል።"); }
});

// ── /removeagent — Admin only: demote agent back to player ────────────────────
bot.command("removeagent", async (ctx) => {
  const user = ctx.from;
  if (!user || user.id !== ADMIN_ID) return;
  const parts = ctx.message?.text?.split(" ") ?? [];
  const targetId = Number(parts[1]);
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("❌ አጠቃቀም: /removeagent <telegramId>");
    return;
  }
  try {
    const rows = await db.select({ firstName: playersTable.firstName, role: playersTable.role })
      .from(playersTable).where(eq(playersTable.telegramId, targetId)).limit(1);
    if (!rows.length) { await ctx.reply("❌ ተጫዋቹ አልተገኘም።"); return; }
    if (rows[0]!.role !== "agent") { await ctx.reply(`ℹ️ <code>${targetId}</code> Agent አይደለም።`, { parse_mode: "HTML" }); return; }
    await db.update(playersTable).set({ role: "player" }).where(eq(playersTable.telegramId, targetId));
    await ctx.reply(`✅ <code>${targetId}</code> (${rows[0]!.firstName}) Agent role ተወግዷል።`, { parse_mode: "HTML" });
    logger.info({ targetId, adminId: user.id }, "User demoted from agent");
  } catch (err) { logger.error({ err }, "removeagent command error"); await ctx.reply("❌ ስህተት ተፈጥሯል።"); }
});

// ── /unban — Admin only: unban a player by clearing their failed attempts ──────
bot.command("unban", async (ctx) => {
  const user = ctx.from;
  if (!user || user.id !== ADMIN_ID) return;
  const parts = ctx.message?.text?.split(" ") ?? [];
  const targetId = Number(parts[1]);
  if (!targetId || isNaN(targetId)) {
    await ctx.reply("❌ አጠቃቀም: /unban <telegramId>");
    return;
  }
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.delete(depositCodeAttemptsTable).where(and(
      eq(depositCodeAttemptsTable.telegramId, targetId),
      eq(depositCodeAttemptsTable.isValid, false),
      gte(depositCodeAttemptsTable.createdAt, since),
    ));
    await ctx.reply(`✅ ተጫዋች <code>${targetId}</code> ተፈቷል። አሁን deposit ኮድ ማስገባት ይችላሉ።`, { parse_mode: "HTML" });
    try {
      await bot.api.sendMessage(targetId, "✅ <b>Account ተፈቷል!</b>\n\nደረሰዎ — አሁን deposit ኮድ ማስገባት ይችላሉ።", { parse_mode: "HTML" });
    } catch { /* player may have blocked bot */ }
  } catch (err) { logger.error({ err }, "unban command error"); }
});

// ── Shared: grant agent join bonus (5 ETB to agentBalance) ───────────────────
export async function grantAgentJoinBonus(referrerTelegramId: number, newUserFirstName: string): Promise<void> {
  try {
    const referrerRows = await db.select({
      role: playersTable.role,
      firstName: playersTable.firstName,
    }).from(playersTable).where(eq(playersTable.telegramId, referrerTelegramId)).limit(1);

    const referrer = referrerRows[0];
    if (!referrer || referrer.role !== "agent") return;

    const JOIN_BONUS = 5;

    await db.update(playersTable).set({
      agentBalance: sql`${playersTable.agentBalance} + ${JOIN_BONUS}`,
    }).where(eq(playersTable.telegramId, referrerTelegramId));

    await db.insert(transactionsTable).values({
      telegramId: referrerTelegramId,
      type: "agent_join_bonus",
      amount: `${JOIN_BONUS}`,
      status: "approved",
      note: `Agent join bonus — ${newUserFirstName} joined via your link`,
    });

    try {
      await bot.api.sendMessage(
        referrerTelegramId,
        `🎉 <b>Agent Join Bonus!</b>\n\n👤 ${newUserFirstName} joined via your link\n💰 <b>${JOIN_BONUS.toFixed(2)} ብር</b> ወደ Agent Wallet ተጨምሯል!`,
        { parse_mode: "HTML" },
      );
    } catch { /* non-fatal */ }

    logger.info({ referrerTelegramId, newUserFirstName }, "Agent join bonus granted");
  } catch (err) {
    logger.error({ err }, "grantAgentJoinBonus error");
  }
}

// ── Shared: grant agent deposit commission (5% to agentBalance) ───────────────
export async function grantAgentDepositCommission(depositorTelegramId: number, depositAmount: number): Promise<void> {
  try {
    const depositorRows = await db.select({
      firstName: playersTable.firstName,
      invitedBy: playersTable.invitedBy,
    }).from(playersTable).where(eq(playersTable.telegramId, depositorTelegramId)).limit(1);

    const invitedBy = depositorRows[0]?.invitedBy;
    const depositorName = depositorRows[0]?.firstName ?? "ተጫዋች";
    if (!invitedBy) return;

    const referrerRows = await db.select({
      role: playersTable.role,
    }).from(playersTable).where(eq(playersTable.telegramId, invitedBy)).limit(1);

    if (!referrerRows[0] || referrerRows[0].role !== "agent") return;

    const commission = Math.floor(depositAmount * 5) / 100;
    if (commission <= 0) return;

    await db.update(playersTable).set({
      agentBalance: sql`${playersTable.agentBalance} + ${commission}`,
    }).where(eq(playersTable.telegramId, invitedBy));

    await db.insert(transactionsTable).values({
      telegramId: invitedBy,
      type: "agent_commission",
      amount: `${commission}`,
      status: "approved",
      note: `5% commission — ${depositorName} deposited ${depositAmount} ብር`,
    });

    try {
      await bot.api.sendMessage(
        invitedBy,
        `💼 <b>Agent Commission!</b>\n\n👤 ${depositorName} ${depositAmount.toFixed(2)} ብር ዲፖዚት አደረገ\n💰 <b>${commission.toFixed(2)} ብር (5%)</b> ወደ Agent Wallet ተጨምሯል!`,
        { parse_mode: "HTML" },
      );
    } catch { /* non-fatal */ }

    logger.info({ invitedBy, depositorTelegramId, commission }, "Agent deposit commission granted");
  } catch (err) {
    logger.error({ err }, "grantAgentDepositCommission error");
  }
}

// ── Shared: grant invite bonus (%) to referrer on every deposit ───────────────
async function grantInviteBonus(depositorTelegramId: number, depositAmount: number) {
  if (!appSettings.getBool("inviteBonusEnabled")) return;
  const percent = appSettings.getNum("inviteBonusPercent");
  if (percent <= 0) return;

  try {
    const depositorRows = await db.select({
      firstName: playersTable.firstName,
      invitedBy: playersTable.invitedBy,
    }).from(playersTable).where(eq(playersTable.telegramId, depositorTelegramId)).limit(1);

    const invitedBy = depositorRows[0]?.invitedBy;
    const depositorName = depositorRows[0]?.firstName ?? "ተጫዋች";
    if (!invitedBy) return;

    const bonus = Math.floor((depositAmount * percent) / 100 * 100) / 100;
    if (bonus <= 0) return;

    // ── Credit inviter ────────────────────────────────────────────────────────
    await db.update(playersTable).set({
      playBalance: sql`${playersTable.playBalance} + ${bonus}`,
      totalInviteBonus: sql`${playersTable.totalInviteBonus} + ${bonus}`,
    }).where(eq(playersTable.telegramId, invitedBy));

    await db.insert(transactionsTable).values({
      telegramId: invitedBy,
      type: "invite_bonus",
      amount: `${bonus}`,
      status: "approved",
      note: `የጥሪ ቦነስ — ${percent}% of ${depositAmount} ብር (${depositorName})`,
    });

    // ── Notify inviter ────────────────────────────────────────────────────────
    try {
      await bot.api.sendMessage(
        invitedBy,
        `🎉 <b>የጥሪ ቦነስ ደረሰዎ!</b>\n\n` +
        `👥 ${depositorName} ዲፖዚት አደረገ\n` +
        `💰 <b>${bonus.toFixed(2)} ብር</b> ወደ Play Wallet ተጨምሯል!`,
        { parse_mode: "HTML" }
      );
    } catch { /* non-fatal */ }

    logger.info({ invitedBy, depositorTelegramId, bonus, percent }, "Invite bonus granted to referrer");
  } catch (err) {
    logger.error({ err }, "grantInviteBonus error");
  }
}

// ── Deposit callbacks ─────────────────────────────────────────────────────────
bot.callbackQuery(/^approve_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery("❌ አልተፈቀደም");
  const depositId = Number(ctx.match[1]);
  try {
    const rows = await db.select().from(pendingDepositsTable).where(eq(pendingDepositsTable.id, depositId)).limit(1);
    if (!rows.length || rows[0]!.status !== "pending") return ctx.answerCallbackQuery("⚠️ Already processed");
    const dep = rows[0]!;
    await db.update(pendingDepositsTable).set({ status: "approved", updatedAt: new Date() }).where(eq(pendingDepositsTable.id, depositId));
    await db.update(playersTable).set({
      balance: sql`${playersTable.balance} + ${dep.amount}`,
      playBalance: sql`${playersTable.playBalance} + ${dep.amount}`,
    }).where(eq(playersTable.telegramId, dep.telegramId));
    await db.insert(transactionsTable).values({ telegramId: dep.telegramId, type: "deposit", amount: dep.amount, status: "approved", note: `Deposit #${dep.id} approved` });
    await bot.api.sendMessage(dep.telegramId, `✅ Your Deposit of <b>${Number(dep.amount).toFixed(0)} ETB</b> is Approved.\n🧾 Ref: #${dep.id}`, { parse_mode: "HTML" });
    await ctx.editMessageText(((ctx as any).message?.text ?? "") + "\n\n✅ <b>APPROVED</b>", { parse_mode: "HTML" });
    await ctx.answerCallbackQuery("✅ ተፈቅዷል!");
    logger.info({ depositId }, "Deposit approved");
    void grantInviteBonus(dep.telegramId, Number(dep.amount));
    void grantAgentDepositCommission(dep.telegramId, Number(dep.amount));
    void grantDepositorBonus(dep.telegramId, Number(dep.amount));
  } catch (err) { logger.error({ err }); await ctx.answerCallbackQuery("❌ ስህተት ተፈጥሯል"); }
});

bot.callbackQuery(/^reject_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery("❌ አልተፈቀደም");
  const depositId = Number(ctx.match[1]);
  try {
    const rows = await db.select().from(pendingDepositsTable).where(eq(pendingDepositsTable.id, depositId)).limit(1);
    if (!rows.length || rows[0]!.status !== "pending") return ctx.answerCallbackQuery("⚠️ Already processed");
    const dep = rows[0]!;
    await db.update(pendingDepositsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(pendingDepositsTable.id, depositId));
    await bot.api.sendMessage(dep.telegramId, `❌ <b>ዲፖዚት ተሰርዟል።</b>\n\nየ ${Number(dep.amount).toFixed(0)} ብር ጥያቄ አልተፈቀደም።`, { parse_mode: "HTML" });
    await ctx.editMessageText(((ctx as any).message?.text ?? "") + "\n\n❌ <b>REJECTED</b>", { parse_mode: "HTML" });
    await ctx.answerCallbackQuery("❌ ተሰርዟል");
  } catch (err) { logger.error({ err }); await ctx.answerCallbackQuery("❌ ስህተት ተፈጥሯል"); }
});

// ── Withdrawal callbacks ──────────────────────────────────────────────────────
bot.callbackQuery(/^approvew_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery("❌ አልተፈቀደም");
  const wId = Number(ctx.match[1]);
  try {
    const rows = await db.select().from(pendingWithdrawalsTable).where(eq(pendingWithdrawalsTable.id, wId)).limit(1);
    if (!rows.length || rows[0]!.status !== "pending") return ctx.answerCallbackQuery("⚠️ Already processed");
    const w = rows[0]!;
    // Balance already deducted at request time — just mark approved
    await db.update(pendingWithdrawalsTable).set({ status: "approved", updatedAt: new Date() }).where(eq(pendingWithdrawalsTable.id, wId));
    await bot.api.sendMessage(
      w.telegramId,
      `✅ <b>ዊዝድሮው ተልኳል!</b>\n\n💸 ${Number(w.amount).toFixed(0)} ብር ወደ Telebirr <code>${w.phone}</code> ተልኳል።\n\nጨዋታ ይቀጥሉ! 🎱`,
      { parse_mode: "HTML" }
    );
    await ctx.editMessageText(((ctx as any).message?.text ?? "") + "\n\n✅ <b>SENT & APPROVED</b>", { parse_mode: "HTML" });
    await ctx.answerCallbackQuery("✅ ተልኳል!");
    logger.info({ wId }, "Withdrawal approved");
  } catch (err) { logger.error({ err }); await ctx.answerCallbackQuery("❌ ስህተት ተፈጥሯል"); }
});

bot.callbackQuery(/^rejectw_(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery("❌ አልተፈቀደም");
  const wId = Number(ctx.match[1]);
  try {
    const rows = await db.select().from(pendingWithdrawalsTable).where(eq(pendingWithdrawalsTable.id, wId)).limit(1);
    if (!rows.length || rows[0]!.status !== "pending") return ctx.answerCallbackQuery("⚠️ Already processed");
    const w = rows[0]!;
    await db.update(pendingWithdrawalsTable).set({ status: "rejected", updatedAt: new Date() }).where(eq(pendingWithdrawalsTable.id, wId));
    // Refund the amount back to the player's balance
    await db.update(playersTable).set({ balance: sql`${playersTable.balance} + ${w.amount}` }).where(eq(playersTable.telegramId, w.telegramId));
    await db.insert(transactionsTable).values({ telegramId: w.telegramId, type: "withdrawal_refund", amount: w.amount, status: "approved", note: `Withdrawal #${w.id} rejected — refunded` });
    await bot.api.sendMessage(
      w.telegramId,
      `❌ <b>ዊዝድሮው ተሰርዟል።</b>\n\nየ ${Number(w.amount).toFixed(0)} ብር ጥያቄ አልተፈቀደም።\n💰 <b>${Number(w.amount).toFixed(0)} ብር ወደ ዋሌትዎ ተመልሷል።</b>`,
      { parse_mode: "HTML" }
    );
    await ctx.editMessageText(((ctx as any).message?.text ?? "") + "\n\n❌ <b>REJECTED & REFUNDED</b>", { parse_mode: "HTML" });
    await ctx.answerCallbackQuery("❌ ተሰርዟል — ብር ተመልሷል");
  } catch (err) { logger.error({ err }); await ctx.answerCallbackQuery("❌ ስህተት ተፈጥሯል"); }
});

// Payment method selection for deposit
bot.callbackQuery(/^method_telebirr_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  const session = depositSessions.get(userId);
  if (!session) return ctx.answerCallbackQuery("⏱️ Session expired. /deposit ን ይጫኑ።");
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `የሚያጋጥማቹ የክፍያ ችግር: @MelkamBingoSupport ላይ ፃፉልን።\n\n` +
    `1. ከታች ባለው የቴሌብር አካውንት <b>${session.amount} ብር</b> ያስገቡ\n\n` +
    `     📞 Phone: <code>${appSettings.get("telebirrNumber")}</code>\n\n` +
    `2. የከፈሉበትን አጭር የጹሁፍ መልዕክት(message) copy በማድረግ እዚ ላይ Past አድረገው ያስገቡና ይላኩት👇👇👇`,
    { parse_mode: "HTML" }
  );
});

bot.callbackQuery(/^method_cancel_(\d+)$/, async (ctx) => {
  const userId = Number(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCallbackQuery();
  depositSessions.delete(userId);
  await ctx.answerCallbackQuery("ተሰርዟል");
  await ctx.editMessageText("❌ ዲፖዚት ተሰርዟል።");
});

// ── Admin: photo → get file_id for BOT_WELCOME_IMAGE_ID ──────────────────────
bot.on("message:photo", async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return;
  const photo = ctx.message.photo.at(-1); // largest size
  if (!photo) return;
  await ctx.reply(
    `📸 <b>Photo file_id:</b>\n<code>${photo.file_id}</code>\n\nRender → Environment ላይ <b>BOT_WELCOME_IMAGE_ID</b> ን ይህን value ጨምሩ።`,
    { parse_mode: "HTML" }
  );
});

// ── Text message handler ──────────────────────────────────────────────────────
bot.on("message:text", async (ctx) => {
  const user = ctx.from;
  if (!user) return;
  const text = ctx.message.text.trim();

  // ── Admin: route reply to a forwarded support message back to the user ────────
  if (user.id === ADMIN_ID && ctx.message.reply_to_message) {
    const replyToId = ctx.message.reply_to_message.message_id;
    const targetUserId = supportMsgToUser.get(replyToId);
    if (targetUserId) {
      try {
        await bot.api.sendMessage(
          targetUserId,
          `📩 <b>Admin ምላሽ:</b>\n\n${text}`,
          { parse_mode: "HTML" }
        );
        await ctx.reply(`✅ ምላሽ ለ <code>${targetUserId}</code> ተልኳል።`, { parse_mode: "HTML" });
      } catch {
        await ctx.reply(`❌ ምላሹ ሊላክ አልቻለም — ተጠቃሚው ቦቱን አጥፍቶ ሊሆን ይችላል።`);
      }
      return;
    }
  }

  // ── Admin password session ─────────────────────────────────────────────────────
  if (adminPasswordSessions.has(user.id)) {
    adminPasswordSessions.delete(user.id);
    const adminPassword = process.env["ADMIN_PASSWORD"];
    if (!adminPassword) {
      await ctx.reply("❌ ADMIN_PASSWORD አልተዋቀረም። ቢሮ ያነጋግሩ።");
      return;
    }
    if (text !== adminPassword) {
      await ctx.reply("❌ ፓስወርድ ትክክል አይደለም።");
      return;
    }
    // Password correct — send mini-app admin page link
    const miniAppUrl = (process.env["MINI_APP_URL"] ?? _botDomain)?.trim() || null;
    const adminUrl = miniAppUrl ? `https://${miniAppUrl}/admin` : null;
    if (!adminUrl) {
      await ctx.reply("❌ MINI_APP_URL አልተዋቀረም።");
      return;
    }
    await ctx.reply(
      `✅ <b>Admin Panel</b>\n\nወደ አድሚን ገፅ ለመሄድ ከታቹ ቁልፍ ይጫኑ:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "🔐 Admin Panel ይክፈቱ", web_app: { url: adminUrl } }]],
        },
      }
    );
    logger.info({ telegramId: user.id }, "Admin authenticated via bot — admin panel link sent");
    return;
  }

  // ── Support session: user typed their support message ─────────────────────────
  if (supportSessions.has(user.id)) {
    supportSessions.delete(user.id);
    // Confirm to user immediately
    await ctx.reply(
      `✅ <b>ጥያቄዎ ደርሷል!</b>\n\nቡድናችን <b>በቅርቡ ምላሽ ይሰጥዎታል።</b> እባክዎ ትንሽ ይጠብቁ...`,
      { parse_mode: "HTML" }
    );
    // Forward message to admin and store mapping for reply routing
    if (ADMIN_ID) {
      try {
        await bot.api.sendMessage(
          ADMIN_ID,
          `🆘 <b>Support ጥያቄ</b>\n` +
          `👤 ${user.first_name}${user.last_name ? ` ${user.last_name}` : ""}${user.username ? ` (@${user.username})` : ""}\n` +
          `🆔 <code>${user.id}</code>\n\n` +
          `<i>↓ ከዚህ መልዕክት ላይ Reply ያድርጉ ምላሽ ለተጠቃሚው ለመላክ</i>`,
          { parse_mode: "HTML" }
        );
        const fwd = await bot.api.forwardMessage(ADMIN_ID, user.id, ctx.message.message_id);
        supportMsgToUser.set(fwd.message_id, user.id);
        // Auto-clean mapping after 7 days
        setTimeout(() => { supportMsgToUser.delete(fwd.message_id); }, 7 * 24 * 60 * 60 * 1000);
      } catch (err) {
        logger.warn({ err }, "Failed to forward support message to admin");
      }
    }
    logger.info({ telegramId: user.id }, "Support message forwarded to admin");
    return;
  }


  // ── Promo code input flow ──
  if (promoSessions.has(user.id)) {
    promoSessions.delete(user.id);
    try {
      const msg = await redeemPromoCode(user.id, text);
      await ctx.reply(msg, { parse_mode: "HTML" });
    } catch (err) { logger.error({ err }, "promo redeem via bot error"); await ctx.reply("❌ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።"); }
    return;
  }

  // ── Transfer flow ──
  const trSession = transferSessions.get(user.id);
  if (trSession) {
    if (trSession.step === "target") {
      // Accept @username or numeric ID
      const raw = text.trim().replace(/^@/, "");
      let targetId = 0;
      try {
        // Try numeric first
        if (/^\d+$/.test(raw)) {
          targetId = Number(raw);
        } else {
          // Look up by username
          const found = await db.select({ telegramId: playersTable.telegramId, firstName: playersTable.firstName })
            .from(playersTable).where(eq(playersTable.username, raw)).limit(1);
          if (found.length) targetId = found[0]!.telegramId;
        }
        if (!targetId) { await ctx.reply("❌ ተጫዋቹ አልተገኘም። @username ወይም Telegram ID ትክክለኛ ሆኖ ያስጊቡ:"); return; }
        if (targetId === user.id) { await ctx.reply("❌ ወደ ራስዎ ማስተላለፍ አይቻልም።"); transferSessions.delete(user.id); return; }
        const targetRows = await db.select({ firstName: playersTable.firstName })
          .from(playersTable).where(eq(playersTable.telegramId, targetId)).limit(1);
        if (!targetRows.length) { await ctx.reply("❌ ተጫዋቹ ያልተመዘገበ ነው።"); transferSessions.delete(user.id); return; }
        trSession.target = targetRows[0]!.firstName;
        trSession.targetId = targetId;
        trSession.step = "amount";
        transferSessions.set(user.id, trSession);
        await ctx.reply(
          `✅ ተቀባይ: <b>${trSession.target}</b>\n\n💰 ማስተላለፍ የሚፈልጉትን <b>መጠን (ብር)</b> ያስጊቡ:`,
          { parse_mode: "HTML" }
        );
      } catch (err) { logger.error({ err }, "transfer target lookup error"); await ctx.reply("❌ ስህተት ተፈጥሯል።"); transferSessions.delete(user.id); }
      return;
    }
    if (trSession.step === "amount") {
      const amount = Number(text);
      if (isNaN(amount) || amount < 10) { await ctx.reply("⚠️ ቢያንስ 10 ብር ያስጊቡ:"); return; }
      try {
        const senderRows = await db.select({ balance: playersTable.balance, playBalance: playersTable.playBalance })
          .from(playersTable).where(eq(playersTable.telegramId, user.id)).limit(1);
        if (!senderRows.length) { await ctx.reply("❌ አካውንት አልተገኘም።"); transferSessions.delete(user.id); return; }
        const senderBalance = Number(senderRows[0]!.balance);
        const senderPlay = Number(senderRows[0]!.playBalance);
        const withdrawable = Math.max(senderBalance - senderPlay, 0);
        if (amount > withdrawable) {
          await ctx.reply(
            `❌ በቂ ባላንስ የለም።\n💸 ማስተላለፍ የሚቻል: <b>${withdrawable.toFixed(2)} ብር</b>`,
            { parse_mode: "HTML" }
          );
          transferSessions.delete(user.id);
          return;
        }
        // Deduct from sender, credit receiver
        await db.update(playersTable).set({ balance: sql`${playersTable.balance} - ${amount}` }).where(eq(playersTable.telegramId, user.id));
        await db.update(playersTable).set({ balance: sql`${playersTable.balance} + ${amount}` }).where(eq(playersTable.telegramId, trSession.targetId));
        await db.insert(transactionsTable).values({ telegramId: user.id, type: "transfer_out", amount: `${amount}`, status: "approved", note: `Transfer to ${trSession.target} (${trSession.targetId})` });
        await db.insert(transactionsTable).values({ telegramId: trSession.targetId, type: "transfer_in", amount: `${amount}`, status: "approved", note: `Transfer from ${user.first_name} (${user.id})` });
        await ctx.reply(
          `✅ <b>ማስተላለፊያ ተጠናቅቋል!</b>\n\n💸 <b>${amount} ብር</b> ወደ <b>${trSession.target}</b> ተልኳል!`,
          { parse_mode: "HTML" }
        );
        try {
          await bot.api.sendMessage(trSession.targetId,
            `💰 <b>ብር ደረሰዎ!</b>\n\n${user.first_name} <b>${amount} ብር</b> ልኮልዎታል!\n\n🎮 ጨዋታ ይጫወቱ!`,
            { parse_mode: "HTML" }
          );
        } catch { /* non-fatal */ }
        logger.info({ from: user.id, to: trSession.targetId, amount }, "Transfer completed");
      } catch (err) { logger.error({ err }, "transfer amount error"); await ctx.reply("❌ ስህተት ተፈጥሯል።"); }
      transferSessions.delete(user.id);
      return;
    }
  }

  // ── Deposit flow ──
  const depSession = depositSessions.get(user.id);
  if (depSession) {
    if (depSession.step === "amount") {
      const amount = Number(text);
      if (isNaN(amount) || amount < 10) {
        await ctx.reply("⚠️ ቢያንስ 10 ብር ያስገቡ:");
        return;
      }
      depSession.amount = amount;
      depSession.step = "confirm";
      depositSessions.set(user.id, depSession);
      const kb = new InlineKeyboard()
        .text("📱 Telebirr", `method_telebirr_${user.id}`)
        .row()
        .text("❌ Cancel", `method_cancel_${user.id}`);
      await ctx.reply(
        `✅ <b>${amount} ብር</b> ለማስገባት:\n\n📌 ከታች የሚገኘዉ የTelebirr አካዉንት ብቻ ነዉ ሚፈቀደዉ\n🚫 ከዚህ ዉጭ አናስተናግድም`,
        { parse_mode: "HTML", reply_markup: kb }
      );
      return;
    }
    if (depSession.step === "confirm") {
      const retry = await handleDepositConfirmation(ctx as any, user.id, user.first_name, depSession.amount, text);
      if (!retry) depositSessions.delete(user.id);
      return;
    }
  }

  // ── Withdraw flow ──
  const wSession = withdrawSessions.get(user.id);
  if (wSession) {
    if (wSession.step === "amount") {
      const amount = Number(text);
      if (isNaN(amount) || amount < 100) {
        await ctx.reply("⚠️ ቢያንስ 100 ብር ያስጊቡ:");
        return;
      }
      try {
        const rows = await db.select().from(playersTable).where(eq(playersTable.telegramId, user.id)).limit(1);
        const balance = Number(rows[0]?.balance ?? 0);
        const playBalance = Number(rows[0]?.playBalance ?? 0);
        const withdrawable = Math.max(balance - playBalance, 0);
        const effectiveWithdrawable = Math.max(withdrawable - 10, 0);
        if (!rows.length || amount > effectiveWithdrawable) {
          await ctx.reply(
            `❌ ይህ መጠን ማውጣት አይቻልም።\n\n` +
            `💸 ማውጣት የሚቻል: <b>${effectiveWithdrawable.toFixed(2)} ብር</b>\n` +
            `📌 ዲፖዚት/ቦነስ ባላንስ ዊዝድሮው ማድረግ አይቻልም።\n` +
            `📌 ከዊዝድሮው በኋላ ቢያንስ 10 ብር አካውንት ውስጥ መቅረት አለበት።`,
            { parse_mode: "HTML" }
          );
          withdrawSessions.delete(user.id);
          return;
        }
      } catch { withdrawSessions.delete(user.id); return; }

      wSession.amount = amount;
      wSession.step = "phone";
      withdrawSessions.set(user.id, wSession);
      await ctx.reply(
        `✅ <b>${amount} ብር</b> ማውጣት\n\n📞 ብርዎን የሚቀበሉበት <b>Telebirr ስልክ ቁጥር</b> ያስጊቡ:`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (wSession.step === "phone") {
      const phone = text.replace(/\s/g, "");
      if (!/^(09|07|\+2519|\+2517)\d{8}$/.test(phone) && !/^\d{10,12}$/.test(phone)) {
        await ctx.reply("⚠️ ትክክለኛ ስልክ ቁጥር ያስጊቡ (ለምሳሌ: 0912345678):");
        return;
      }
      wSession.phone = phone;
      wSession.step = "accountName";
      withdrawSessions.set(user.id, wSession);
      await ctx.reply(
        `✅ ስልክ ቁጥር ተቀብሏል: <code>${phone}</code>\n\n👤 የTelebirr <b>አካውንት ሆልደር ስም</b> ያስጊቡ:\n<i>(በTelebirr ላይ ያለዉ ሙሉ ስም)</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (wSession.step === "accountName") {
      const accountName = text.trim();
      if (accountName.length < 2) {
        await ctx.reply("⚠️ ትክክለኛ ስም ያስጊቡ:");
        return;
      }
      wSession.accountName = accountName;
      await handleWithdrawRequest(ctx as any, user.id, user.first_name, wSession.amount, wSession.phone, accountName);
      withdrawSessions.delete(user.id);
      return;
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
// Returns true if the session should stay open (user must retry)
async function handleDepositConfirmation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  telegramId: number,
  firstName: string,
  amount: number,
  userText: string,
): Promise<boolean> {
  // ── 1. Extract transaction code ──
  const code = extractTransactionCode(userText);

  if (!code) {
    const failures = await trackDepositAttempt(telegramId, userText.slice(0, 50), false);
    if (failures >= MAX_FAILURES) {
      await ctx.reply(
        `🚫 <b>ዲፖዚት ተቋርጧል</b>\n\n` +
        `${MAX_FAILURES} ጊዜ ትክክለኛ ትራንዛክሽን ኮድ አልተገኘም።\n` +
        `ዳግም ለመሞከር /deposit ን ይጫኑ።\n\n` +
        `⚠️ ተደጋጋሚ ሙከራ አካዉንትዎ እንዲታገድ ሊያደርግ ይችላል።`,
        { parse_mode: "HTML" }
      );
      return false;
    }
    const remaining = MAX_FAILURES - failures;
    await ctx.reply(
      `❌ <b>ትራንዛክሽን ኮድ አልተገኘም</b>\n\n` +
      `ከ Telebirr SMS ያደረሱት ትራንዛክሽን ኮድ (TxnID / Ref No) ወይም ሙሉ SMS ይላኩ።\n\n` +
      `⚠️ ቀሪ ሙከራ: <b>${remaining}</b>${remaining === 1 ? " — ቀጣዩ ስህተት አካዉንትዎ ያቋርጠዋል!" : ""}`,
      { parse_mode: "HTML" }
    );
    return remaining > 0;
  }

  await trackDepositAttempt(telegramId, code, true);

  // ── 2. Check rate limiting ──
  const recentFails = await getRecentFailureCount(telegramId);
  if (recentFails >= MAX_FAILURES) {
    await ctx.reply(
      `🚫 <b>ዲፖዚት ታግዷል</b>\n\nጥቂት ጊዜ ከጠበቁ በኃላ እንደገና ይሞክሩ።`,
      { parse_mode: "HTML" }
    );
    return false;
  }

  // ── 3. Try auto-deposit reconciliation ──
  const autoResult = await processBotDeposit(telegramId, firstName, amount, code);

  if (autoResult.status === "credited") {
    await ctx.reply(
      `✅ <b>ዲፖዚት ተረጋግጧል!</b>\n\n` +
      `💰 <b>${autoResult.amount.toFixed(2)} ብር</b> ወደ Play Wallet ተጨምሯል!\n` +
      `🔖 ኮድ: <code>${code}</code>\n\n🎱 መጫወት ይችላሉ!`,
      { parse_mode: "HTML" }
    );
    void grantInviteBonus(telegramId, autoResult.amount);
    void grantAgentDepositCommission(telegramId, autoResult.amount);
    void grantDepositorBonus(telegramId, autoResult.amount);
    // Notify admin of the auto-credited deposit (informational — already processed)
    if (ADMIN_ID) {
      try {
        await bot.api.sendMessage(
          ADMIN_ID,
          `✅ <b>Auto Deposit ተፈቀደ #auto</b>\n` +
          `👤 ${firstName} (<code>${telegramId}</code>)\n` +
          `💰 <b>${autoResult.amount.toFixed(2)} ብር</b>\n` +
          `🔖 ኮድ: <code>${code}</code>\n\n` +
          `<i>ቴሌብር ራሱ አረጋገጠው — ምንም እርምጃ አያስፈልግም</i>`,
          { parse_mode: "HTML" }
        );
      } catch { /* non-fatal */ }
    }
    return false;
  }

  if (autoResult.status === "duplicate") {
    await ctx.reply(
      `⚠️ <b>ይህ ኮድ አስቀድሞ ጥቅም ላይ ውሏል</b>\n\n🔖 <code>${code}</code>\n\nስህተት ከሆነ አድሚንን ያነጋግሩ።`,
      { parse_mode: "HTML" }
    );
    return false;
  }

  // ── 4. Pending or failed — create manual deposit for admin review ──
  try {
    const inserted = await db.insert(pendingDepositsTable).values({
      telegramId, firstName, amount: `${amount}`, status: "pending",
      confirmationText: code,
    }).returning();
    const depId = inserted[0]!.id;

    await ctx.reply(
      `⏳ <b>ጥያቄዎ ተቀብሏል!</b>\n\n` +
      `💰 ${amount} ብር ዲፖዚት ኮድ: <code>${code}</code>\n` +
      `📋 SMS ሲደርስ ወዲያው ይረጋገጣል፤ ካልሆነ አድሚን ያረጋግጣሉ።\n` +
      `✅ ሲፀደቅ ወዲያው ይነገርዎታል`,
      { parse_mode: "HTML" }
    );

    if (ADMIN_ID) {
      const kb = new InlineKeyboard().text("✅ አፀድቅ", `approve_${depId}`).text("❌ ሰርዝ", `reject_${depId}`);
      await bot.api.sendMessage(
        ADMIN_ID,
        `📥 <b>Deposit #${depId}</b>\n👤 ${firstName} (${telegramId})\n💰 <b>${amount} ብር</b>\n🔖 ኮድ: <code>${code}</code>`,
        { parse_mode: "HTML", reply_markup: kb }
      );
    }
    logger.info({ telegramId, amount, depId, code }, "Deposit submitted (pending)");
  } catch (err) {
    logger.error({ err }, "deposit confirmation error");
    await ctx.reply("❌ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።");
  }
  return false;
}

// ── Lucky Box helpers (exported for route use) ────────────────────────────────
export function buildBoxKeyboard(
  totalBoxes: number,
  claims: Pick<LuckyBoxClaim, "boxNumber" | "firstName">[],
  sessionId: number,
  amountPerBox: number,
) {
  const claimedMap = new Map(claims.map(c => [c.boxNumber, c.firstName]));
  const rows: { text: string; callback_data: string }[][] = [];
  const perRow = 3;
  for (let i = 0; i < totalBoxes; i += perRow) {
    const row: { text: string; callback_data: string }[] = [];
    for (let j = i; j < Math.min(i + perRow, totalBoxes); j++) {
      const boxNum = j + 1;
      const claimedBy = claimedMap.get(boxNum);
      if (claimedBy) {
        row.push({ text: `✅ ${claimedBy.slice(0, 10)}`, callback_data: `lbxt_${sessionId}_${boxNum}` });
      } else {
        row.push({ text: `🎁 ${amountPerBox} ብር`, callback_data: `lbox_${sessionId}_${boxNum}` });
      }
    }
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

export function buildResultsMessage(
  title: string,
  claims: Pick<LuckyBoxClaim, "boxNumber" | "firstName" | "username" | "amount">[],
) {
  const total = claims.reduce((s, c) => s + Number(c.amount), 0);
  const sorted = [...claims].sort((a, b) => a.boxNumber - b.boxNumber);
  let text = `🎊 <b>Lucky Box ተጠናቀቀ!</b>\n\n`;
  text += `🎁 <b>${title}</b>\n\n`;
  text += `🏆 <b>አሸናፊዎች ዝርዝር:</b>\n`;
  for (const c of sorted) {
    const name = c.username ? `@${c.username}` : c.firstName;
    text += `• 👤 <b>${name}</b> — ${Number(c.amount).toFixed(0)} ብር 💰\n`;
  }
  text += `\n💵 <b>ጠቅላላ ተሰራጨ: ${total.toFixed(0)} ብር</b>\n\n`;
  text += `🎉 <b>እንኳን ደስ አላቹ! ሁሉም Lucky Box ተወስዷል!</b>\n`;
  text += `💫 ቀጣዩ Lucky Box ለማያዣዘው — መልካም BINGO ጨዋታ ተቀላቀሉ!\n`;
  text += `🎱 <i>መልካም Bingo — ዛሬም ይጫወቱ!</i>`;
  return text;
}

// ── Lucky Box — taken box (already claimed) ───────────────────────────────────
bot.callbackQuery(/^lbxt_/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "❌ ይህ Box ቀድሞ ተወስዷል!", show_alert: true });
});

// ── Lucky Box — claim ─────────────────────────────────────────────────────────
bot.callbackQuery(/^lbox_(\d+)_(\d+)$/, async (ctx) => {
  const sessionId = Number(ctx.match[1]);
  const boxNumber = Number(ctx.match[2]);
  const user = ctx.from;

  try {
    // Must be registered
    const playerRows = await db.select().from(playersTable).where(eq(playersTable.telegramId, user.id)).limit(1);
    if (!playerRows.length) {
      await ctx.answerCallbackQuery({ text: "❌ አካውንት አልተገኘም። Bot ን ክፍቱና /start ን ይጫኑ።", show_alert: true });
      return;
    }

    // Session must exist and be active
    const sessionRows = await db.select().from(luckyBoxSessionsTable).where(eq(luckyBoxSessionsTable.id, sessionId)).limit(1);
    if (!sessionRows.length || sessionRows[0]!.status !== "active") {
      await ctx.answerCallbackQuery({ text: "❌ ይህ Lucky Box ጊዜው አልፎ ወይም አልቋል።", show_alert: true });
      return;
    }
    const session = sessionRows[0]!;

    // Box must not be claimed
    const boxClaim = await db.select().from(luckyBoxClaimsTable)
      .where(and(eq(luckyBoxClaimsTable.sessionId, sessionId), eq(luckyBoxClaimsTable.boxNumber, boxNumber)))
      .limit(1);
    if (boxClaim.length) {
      await ctx.answerCallbackQuery({ text: "❌ ይህ Box ቀድሞ ተወስዷል! ሌላ Box ይሞክሩ።", show_alert: true });
      return;
    }

    // User can only claim one box per session
    const userClaim = await db.select().from(luckyBoxClaimsTable)
      .where(and(eq(luckyBoxClaimsTable.sessionId, sessionId), eq(luckyBoxClaimsTable.telegramId, user.id)))
      .limit(1);
    if (userClaim.length) {
      await ctx.answerCallbackQuery({ text: `✅ ቀደም ብለው Box #${userClaim[0]!.boxNumber} ወስደዋል! አንድ Box ብቻ ይፈቀዳል።`, show_alert: true });
      return;
    }

    const amount = Number(session.amountPerBox);

    // Credit balance
    await db.update(playersTable)
      .set({ balance: sql`${playersTable.balance} + ${amount}` })
      .where(eq(playersTable.telegramId, user.id));

    await db.insert(transactionsTable).values({
      telegramId: user.id,
      type: "lucky_box",
      amount: `${amount}`,
      status: "approved",
      note: `Lucky Box #${sessionId} — Box ${boxNumber}`,
    });

    // Record claim
    await db.insert(luckyBoxClaimsTable).values({
      sessionId,
      boxNumber,
      telegramId: user.id,
      firstName: user.first_name,
      username: user.username ?? null,
      amount: `${amount}`,
    });

    // Update claimed count
    const newCount = session.claimedCount + 1;
    const isComplete = newCount >= session.totalBoxes;
    await db.update(luckyBoxSessionsTable)
      .set({ claimedCount: newCount, status: isComplete ? "completed" : "active" })
      .where(eq(luckyBoxSessionsTable.id, sessionId));

    await ctx.answerCallbackQuery({ text: `🎉 ${amount} ብር ወደ ዋሌትዎ ተጨምሯል!`, show_alert: true });

    // Notify user via private message
    try {
      await bot.api.sendMessage(user.id,
        `🎁 <b>Lucky Box ዕድለኛ ሆኑ!</b>\n\n💰 <b>${amount} ብር</b> ወደ ዋሌትዎ ተጨምሯል!\n\n🎱 <i>መልካም Bingo — ይጫወቱ ይዝናኑ!</i>`,
        { parse_mode: "HTML" }
      );
    } catch { /* non-fatal */ }

    // Edit channel message
    if (session.channelMessageId && LUCKY_BOX_CHANNEL_ID) {
      try {
        const allClaims = await db.select().from(luckyBoxClaimsTable)
          .where(eq(luckyBoxClaimsTable.sessionId, sessionId));

        if (isComplete) {
          const resultText = buildResultsMessage(session.title, allClaims);
          const botUsername = await getBotUsername();
          const miniAppUrl = (process.env["MINI_APP_URL"] ?? _botDomain)?.trim() || null;
          const playUrl = miniAppUrl ? `https://${miniAppUrl}` : null;
          const resultKb = botUsername && playUrl
            ? { inline_keyboard: [[{ text: "🎱 መልካም BINGO — Play NOW", web_app: { url: playUrl } }]] }
            : { inline_keyboard: [] };

          if (session.imageBase64) {
            await bot.api.editMessageCaption(LUCKY_BOX_CHANNEL_ID, Number(session.channelMessageId), {
              caption: resultText,
              parse_mode: "HTML",
              reply_markup: resultKb,
            });
          } else {
            await bot.api.editMessageText(LUCKY_BOX_CHANNEL_ID, Number(session.channelMessageId), resultText, {
              parse_mode: "HTML",
              reply_markup: resultKb,
            });
          }
        } else {
          const keyboard = buildBoxKeyboard(session.totalBoxes, allClaims, sessionId, amount);
          await bot.api.editMessageReplyMarkup(LUCKY_BOX_CHANNEL_ID, Number(session.channelMessageId), {
            reply_markup: keyboard,
          });
        }
      } catch (editErr) {
        logger.warn({ editErr }, "Failed to edit lucky box channel message");
      }
    }
  } catch (err) {
    logger.error({ err }, "lucky box claim error");
    try { await ctx.answerCallbackQuery({ text: "❌ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።", show_alert: true }); } catch { /* ignore */ }
  }
});

async function handleWithdrawRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  telegramId: number,
  firstName: string,
  amount: number,
  phone: string,
  accountName: string
) {
  try {
    // Deduct balance immediately when the request is submitted
    await db.update(playersTable)
      .set({ balance: sql`${playersTable.balance} - ${amount}` })
      .where(eq(playersTable.telegramId, telegramId));
    await db.insert(transactionsTable).values({
      telegramId, type: "withdrawal", amount: `${amount}`, status: "pending",
      note: `Withdrawal request submitted — pending admin approval`,
    });

    const inserted = await db.insert(pendingWithdrawalsTable).values({
      telegramId, firstName, amount: `${amount}`, phone, accountName, status: "pending",
    }).returning();
    const wId = inserted[0]!.id;
    await ctx.reply(
      `✅ <b>ዊዝድሮው ጥያቄ ተቀብሏል!</b>\n\n` +
      `💸 ${amount} ብር ወደ <code>${phone}</code>\n` +
      `👤 አካውንት: <b>${accountName}</b>\n\n` +
      `💳 <b>${amount} ብር ከዋሌትዎ ተቀንሷል።</b>\n` +
      `Admin ሲያፀድቁ ወዲያው ይጋባልዎ። ✅`,
      { parse_mode: "HTML" }
    );
    if (ADMIN_ID) {
      const kb = new InlineKeyboard().text("✅ ልከዋለሁ", `approvew_${wId}`).text("❌ ሰርዝ", `rejectw_${wId}`);
      await bot.api.sendMessage(
        ADMIN_ID,
        `📤 <b>አዲስ Withdrawal #${wId}</b>\n` +
        `👤 ${firstName} (${telegramId})\n` +
        `💸 <b>${amount} ብር</b>\n` +
        `📞 Telebirr: <code>${phone}</code>\n` +
        `🏷 አካውንት ሆልደር: <b>${accountName}</b>`,
        { parse_mode: "HTML", reply_markup: kb }
      );
    }
    logger.info({ telegramId, amount, wId }, "Withdrawal submitted — balance deducted immediately");
  } catch (err) {
    logger.error({ err }, "withdraw request error");
    await ctx.reply("❌ ስህተት ተፈጥሯል። እንደገና ይሞክሩ።");
  }
}

export { grantInviteBonus };

// ── Shared: grant depositor bonus (5 ETB flat + 20% of deposit) ───────────────
export async function grantDepositorBonus(telegramId: number, depositAmount: number): Promise<void> {
  try {
    const FLAT_BONUS = 5;
    const PERCENT_BONUS = 0.20;
    const percentAmount = Math.floor(depositAmount * PERCENT_BONUS * 100) / 100;
    const totalBonus = FLAT_BONUS + percentAmount;

    await db.update(playersTable).set({
      playBalance: sql`${playersTable.playBalance} + ${totalBonus}`,
    }).where(eq(playersTable.telegramId, telegramId));

    await db.insert(transactionsTable).values({
      telegramId,
      type: "deposit_bonus",
      amount: `${totalBonus}`,
      status: "approved",
      note: `ዲፖዚት ቦነስ — 5 ብር + 20% (${percentAmount.toFixed(2)} ብር) on ${depositAmount} ብር deposit`,
    });

    try {
      await bot.api.sendMessage(
        telegramId,
        `🎁 <b>የዲፖዚት ቦነስ ደረሰዎ!</b>\n\n` +
        `💵 ዲፖዚት: <b>${depositAmount.toFixed(0)} ብር</b>\n` +
        `➕ የቋሚ ቦነስ: <b>5 ብር</b>\n` +
        `➕ 20% ቦነስ: <b>${percentAmount.toFixed(2)} ብር</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `🏆 ጠቅላላ ቦነስ: <b>${totalBonus.toFixed(2)} ብር</b> Play Wallet ተጨምሯል!\n\n` +
        `🎱 አሁን ይጫወቱ!`,
        { parse_mode: "HTML" },
      );
    } catch { /* non-fatal */ }

    logger.info({ telegramId, depositAmount, totalBonus }, "Depositor bonus granted");
  } catch (err) {
    logger.error({ err }, "grantDepositorBonus error");
  }
}

bot.catch((err) => { logger.error({ err: err.error }, "Bot error"); });
