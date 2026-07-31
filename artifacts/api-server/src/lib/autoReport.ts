import { db } from "./db";
import {
  pendingDepositsTable,
  pendingWithdrawalsTable,
  playersTable,
  transactionsTable,
} from "@workspace/db/schema";
import { bot } from "./bot";
import { appSettings } from "./settings";
import { logger } from "./logger";

export async function generateReport(): Promise<string> {
  const [deposits, withdrawals, players, allTx] = await Promise.all([
    db.select().from(pendingDepositsTable),
    db.select().from(pendingWithdrawalsTable),
    db.select().from(playersTable),
    db.select().from(transactionsTable),
  ]);

  const approvedDeposits = deposits.filter(d => d.status === "approved");
  const approvedWithdrawals = withdrawals.filter(w => w.status === "approved");
  const totalDeposited = approvedDeposits.reduce((s, d) => s + Number(d.amount), 0);
  const totalWithdrawn = approvedWithdrawals.reduce((s, w) => s + Number(w.amount), 0);
  const netRevenue = totalDeposited - totalWithdrawn;
  const totalBalance = players.reduce((s, p) => s + Number(p.balance), 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayDep = allTx.filter(t => t.type === "deposit" && new Date(t.createdAt!) >= todayStart);
  const todayWd = allTx.filter(t => t.type === "withdrawal" && new Date(t.createdAt!) >= todayStart);
  const todayWin = allTx.filter(t => t.type === "win" && new Date(t.createdAt!) >= todayStart);
  const todayStake = allTx.filter(t => t.type === "stake" && new Date(t.createdAt!) >= todayStart);

  const todayDepAmt = todayDep.reduce((s, t) => s + Number(t.amount), 0);
  const todayWdAmt = todayWd.reduce((s, t) => s + Number(t.amount), 0);
  const todayWinAmt = todayWin.reduce((s, t) => s + Number(t.amount), 0);
  const todayStakeAmt = todayStake.reduce((s, t) => s + Number(t.amount), 0);

  const dateStr = new Date().toLocaleString("am-ET", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    `📊 <b>መልካም BINGO — ሪፖርት</b>\n` +
    `📅 ${dateStr}\n\n` +
    `💰 <b>ዲፖዚቶች</b>\n` +
    `  • ጠቅላላ: <b>${totalDeposited.toFixed(0)} ብር</b> (${approvedDeposits.length})\n` +
    `  • ዛሬ: <b>${todayDepAmt.toFixed(0)} ብር</b> (${todayDep.length})\n` +
    `  • Pending: <b>${deposits.filter(d => d.status === "pending").length}</b>\n\n` +
    `💸 <b>ዊዝድሮዎች</b>\n` +
    `  • ጠቅላላ: <b>${totalWithdrawn.toFixed(0)} ብር</b> (${approvedWithdrawals.length})\n` +
    `  • ዛሬ: <b>${todayWdAmt.toFixed(0)} ብር</b> (${todayWd.length})\n` +
    `  • Pending: <b>${withdrawals.filter(w => w.status === "pending").length}</b>\n\n` +
    `🏆 <b>ሽልማቶች (ዛሬ)</b>\n` +
    `  • ጠቅላላ: <b>${todayWinAmt.toFixed(0)} ብር</b> (${todayWin.length})\n\n` +
    `🎯 <b>Stakes (ዛሬ)</b>: <b>${todayStakeAmt.toFixed(0)} ብር</b> (${todayStake.length})\n\n` +
    `👥 <b>ጠቅላላ ተጫዋቾች</b>: ${players.length}\n` +
    `💳 <b>ጠቅላላ ባላንስ (ተጫዋቾች)</b>: ${totalBalance.toFixed(0)} ብር\n\n` +
    `📈 <b>Net Revenue</b>: ${netRevenue >= 0 ? "+" : ""}${netRevenue.toFixed(0)} ብር\n` +
    `⚙️ <b>Commission %</b>: ${appSettings.get("commissionPercent")}%`
  );
}

export async function sendReportTo(telegramIds: number[]): Promise<{ sent: number; failed: number }> {
  const report = await generateReport();
  let sent = 0, failed = 0;
  for (const id of telegramIds) {
    try {
      await bot.api.sendMessage(id, report, { parse_mode: "HTML" });
      sent++;
    } catch (err) {
      logger.warn({ err, telegramId: id }, "Failed to send report to user");
      failed++;
    }
  }
  return { sent, failed };
}

let lastAutoReportHour = -99;

export function startAutoReportCron() {
  setInterval(async () => {
    try {
      const hourSetting = appSettings.getNum("autoReportHour");
      if (hourSetting < 0 || hourSetting > 23) return;
      const now = new Date();
      const currentHour = now.getHours();
      if (currentHour === hourSetting && currentHour !== lastAutoReportHour) {
        lastAutoReportHour = currentHour;
        const adminIdsStr = appSettings.get("reportAdminIds");
        const adminIds = adminIdsStr
          .split(",")
          .map(s => Number(s.trim()))
          .filter(n => n > 0);
        if (adminIds.length > 0) {
          logger.info({ adminIds, hour: currentHour }, "Sending scheduled auto-report");
          const result = await sendReportTo(adminIds);
          logger.info(result, "Auto-report sent");
        }
      }
    } catch (err) {
      logger.error({ err }, "Auto-report cron error");
    }
  }, 60_000);
}
