import { randomUUID, randomInt } from "crypto";
import type { Server, Socket, Namespace } from "socket.io";
import { logger } from "./logger";
import { db } from "./db";
import { CARTELAS } from "../data/cartelas";
import { playersTable, transactionsTable, gameRoundsTable, jackpotBatchesTable, jackpotPointsTable, jackpotRoundLogTable } from "@workspace/db/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { appSettings, type RoomId } from "./settings";
import { bot } from "./bot";


export type Phase = "waiting" | "playing" | "finished";

export interface PlayerState {
  socketId: string;
  telegramId: number;
  firstName: string;
  cardIds: number[];
}

export interface Winner {
  telegramId: number;
  firstName: string;
  cardId: number;
  card: number[][];
  winPattern: number[];
}

export interface BroadcastState {
  roundId: string;
  phase: Phase;
  countdown: number;
  playerCount: number;
  playersWithCards: number;
  prizePool: number;
  netPrizePool: number;
  calledBalls: number[];
  currentBall: number | null;
  jackpotPool: number;
}

export interface RoomConfig {
  namespace?: string;
  roomId?: string;
  stakePerCard?: number;
  commissionPercent?: number;
  countdownSeconds?: number;
  ballIntervalSeconds?: number;
  maxCardsPerPlayer?: number;
}

const COLUMNS = ["B", "I", "N", "G", "O"] as const;
const COL_RANGES: [number, number][] = [[1,15],[16,30],[31,45],[46,60],[61,75]];

export function getColForNumber(n: number): string {
  for (let i = 0; i < COL_RANGES.length; i++) {
    const [min, max] = COL_RANGES[i]!;
    if (n >= min && n <= max) return COLUMNS[i]!;
  }
  return "B";
}

export function getWinPattern(card: number[][], calledSet: Set<number>): number[] {
  const isMarked = (r: number, c: number) => card[r]![c] === 0 || calledSet.has(card[r]![c]!);
  const vals = (coords: [number, number][]) => coords.map(([r, c]) => card[r]![c]!);

  for (let r = 0; r < 5; r++) {
    const coords: [number, number][] = [0,1,2,3,4].map(c => [r, c]);
    if (coords.every(([r2, c2]) => isMarked(r2, c2))) return vals(coords);
  }
  for (let c = 0; c < 5; c++) {
    const coords: [number, number][] = [0,1,2,3,4].map(r => [r, c]);
    if (coords.every(([r2, c2]) => isMarked(r2, c2))) return vals(coords);
  }
  {
    const coords: [number, number][] = [0,1,2,3,4].map(i => [i, i]);
    if (coords.every(([r2, c2]) => isMarked(r2, c2))) return vals(coords);
  }
  {
    const coords: [number, number][] = [0,1,2,3,4].map(i => [i, 4 - i]);
    if (coords.every(([r2, c2]) => isMarked(r2, c2))) return vals(coords);
  }
  {
    const corners: [number, number][] = [[0,0],[0,4],[4,0],[4,4]];
    if (corners.every(([r2, c2]) => isMarked(r2, c2))) return vals(corners);
  }
  return [];
}

export function checkWin(card: number[][], calledSet: Set<number>): boolean {
  return getWinPattern(card, calledSet).length > 0;
}

export class GameEngine {
  private io: Server;
  private ns: Server | Namespace;
  private roomCfg: RoomConfig;

  private roundId: string;
  private phase: Phase;
  private countdown: number;
  private players: Map<string, PlayerState>;
  private persistentCards: Map<number, { firstName: string; cardIds: number[] }>;
  private roundParticipants: Map<number, { firstName: string; cardIds: number[] }>;
  private calledBalls: number[];
  private availableBalls: number[];
  private currentBall: number | null;
  private winners: Winner[];
  private claimedThisRound: Set<number>;
  // Tracks exact per-card deductions {main, bonus} for proportional refunds on deselect.
  private cardDeductions: Map<number, Map<number, { main: number; bonus: number; deposit: number }>>;
  // Aggregated per-player deduction totals for the current round (used for win logic and maintenance refunds).
  private roundDeductions: Map<number, { main: number; bonus: number; deposit: number }>;

  private jackpotPool = 0;
  // Locked at game-start; stays fixed for the whole playing/finished phase
  // so the "PLAYERS" chip never jumps as sockets connect/disconnect mid-game.
  private lockedPlayerCount = 0;

  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private ballTimer: ReturnType<typeof setInterval> | null = null;
  private finishedTimer: ReturnType<typeof setTimeout> | null = null;
  private tieWindowTimer: ReturnType<typeof setTimeout> | null = null;
  // Number of called balls when the first winner of a round was validated.
  // Used to accept co-winners who claim on the same ball within the tie window.
  private tieWindowBallCount = 0;

  constructor(io: Server, config: RoomConfig = {}) {
    this.io = io;
    this.roomCfg = config;
    const ns = config.namespace ?? "/";
    // Always use io.of(ns) — never use io directly — so Room 1 and Room 2
    // are completely isolated and events never bleed across namespaces.
    this.ns = io.of(ns);

    this.roundId = randomUUID();
    this.phase = "waiting";
    this.countdown = this.cfgCountdownSeconds();
    this.players = new Map();
    this.persistentCards = new Map();
    this.roundParticipants = new Map();
    this.calledBalls = [];
    this.availableBalls = this.makeAvailableBalls();
    this.currentBall = null;
    this.winners = [];
    this.claimedThisRound = new Set();
    this.cardDeductions = new Map();
    this.roundDeductions = new Map();
    this.startCountdown();
    logger.info({ roundId: this.roundId, namespace: ns ?? "/" }, "Game engine started");
  }

  // ── Config-aware setting getters ─────────────────────────────────────────────

  private cfgStakePerCard(): number {
    if (this.roomCfg.roomId) return appSettings.getRoomNum(this.roomCfg.roomId as RoomId, "stakePerCard");
    return this.roomCfg.stakePerCard ?? appSettings.getNum("stakePerCard");
  }

  /** Returns the authoritative cartela list for this room */
  private cfgCartelas(): number[][][] {
    return CARTELAS;
  }

  private cfgCommissionPercent(): number {
    if (this.roomCfg.roomId) return appSettings.getRoomNum(this.roomCfg.roomId as RoomId, "commissionPercent");
    return this.roomCfg.commissionPercent ?? appSettings.getNum("commissionPercent");
  }

  private cfgCountdownSeconds(): number {
    if (this.roomCfg.roomId) return appSettings.getRoomNum(this.roomCfg.roomId as RoomId, "countdownSeconds");
    return this.roomCfg.countdownSeconds ?? appSettings.getNum("countdownSeconds");
  }

  private cfgBallIntervalMs(): number {
    if (this.roomCfg.roomId) return appSettings.getRoomNum(this.roomCfg.roomId as RoomId, "ballIntervalSeconds") * 1000;
    return (this.roomCfg.ballIntervalSeconds ?? appSettings.getNum("ballIntervalSeconds")) * 1000;
  }

  private cfgMaxCards(): number {
    return 6;
  }

  private cfgMinPlayersToStart(): number {
    if (this.roomCfg.roomId) return appSettings.getRoomNum(this.roomCfg.roomId as RoomId, "minPlayersToStart");
    return 2;
  }

  private cfgJackpotEnabled(): boolean {
    return appSettings.getBool("jackpotEnabled");
  }

  private cfgJackpotFinalGame(): number {
    return Math.max(1, Math.floor(appSettings.getNum("jackpotFinalGame")));
  }

  getNamespace(): Server | Namespace {
    return this.ns;
  }

  getPublicState() {
    const totalCards = [...this.persistentCards.values()].reduce((sum, p) => sum + p.cardIds.length, 0);
    return {
      phase: this.phase,
      playerCount: this.persistentCards.size,
      cardCount: totalCards,
      countdown: this.countdown,
      stakePerCard: this.cfgStakePerCard(),
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────────

  private makeAvailableBalls(): number[] {
    // Step 1: Fisher-Yates with crypto.randomInt (OS-level entropy, no PRNG bias)
    const balls = Array.from({ length: 75 }, (_, i) => i + 1);
    for (let i = balls.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      [balls[i], balls[j]] = [balls[j]!, balls[i]!];
    }

    // Step 2: Desequentialization — balls are called via pop() so we check
    // the tail end of the array. Swap any pair within 8 of each other in value
    // with a random element from the first half, repeat 4 passes.
    for (let pass = 0; pass < 4; pass++) {
      for (let i = balls.length - 1; i > 0; i--) {
        if (Math.abs(balls[i]! - balls[i - 1]!) <= 8) {
          const swapIdx = randomInt(0, Math.max(1, Math.floor(balls.length / 2)));
          [balls[i], balls[swapIdx]] = [balls[swapIdx]!, balls[i]!];
        }
      }
    }

    return balls;
  }

  private startCountdown() {
    this.clearAllTimers();
    this.phase = "waiting";
    this.countdown = this.cfgCountdownSeconds();
    this.broadcastState();

    this.countdownTimer = setInterval(() => {
      this.countdown -= 1;
      this.broadcastState();

      if (this.countdown <= 0) {
        const uniquePlayersWithCards = this.persistentCards.size;
        const totalCardsSelected = [...this.persistentCards.values()].reduce((sum, p) => sum + p.cardIds.length, 0);
        const minPlayers = this.cfgMinPlayersToStart();
        if (totalCardsSelected >= 1 && uniquePlayersWithCards >= minPlayers) {
          void this.startGame();
        } else {
          this.countdown = this.cfgCountdownSeconds();
          if (totalCardsSelected < 1) {
            logger.info({ roundId: this.roundId, uniquePlayersWithCards, totalCardsSelected, minPlayers }, "No cards selected — resetting countdown");
          } else {
            logger.info({ roundId: this.roundId, uniquePlayersWithCards, totalCardsSelected, minPlayers }, "Not enough players — resetting countdown");
          }
        }
      }
    }, 1000);
  }

  private async startGame() {
    this.clearAllTimers();
    this.phase = "playing";
    this.calledBalls = [];
    this.availableBalls = this.makeAvailableBalls();
    this.currentBall = null;
    this.winners = [];
    this.claimedThisRound = new Set();

    this.roundParticipants.clear();
    const stakePerCard = this.cfgStakePerCard();
    for (const [telegramId, { firstName, cardIds }] of this.persistentCards) {
      if (cardIds.length > 0) {
        this.roundParticipants.set(telegramId, { firstName, cardIds: [...cardIds] });
      }
    }

    // Lock the player count once here — never changes until next round.
    this.lockedPlayerCount = this.roundParticipants.size;

    this.broadcastState();
    logger.info({ roundId: this.roundId, participants: this.roundParticipants.size }, "Game started");

    // Stake was already deducted per-card at selection time.
    // We only record the transaction here for the audit trail.
    for (const [telegramId, participant] of this.roundParticipants) {
      const stake = participant.cardIds.length * stakePerCard;
      if (stake <= 0) continue;
      try {
        await db.insert(transactionsTable).values({
          telegramId,
          type: "stake",
          amount: `${stake}`,
          status: "approved",
          note: `Stake for round ${this.roundId.slice(0, 8).toUpperCase()}`,
        });
      } catch (err) {
        logger.error({ err, telegramId }, "Failed to record stake transaction");
      }
    }

    this.ballTimer = setInterval(() => {
      this.callNextBall();
    }, this.cfgBallIntervalMs());
  }

  private callNextBall() {
    if (this.availableBalls.length === 0) {
      logger.info({ roundId: this.roundId }, "All balls called — resetting round");
      void this.saveRoundResultsAndReset();
      return;
    }

    const ball = this.availableBalls.pop()!;
    this.currentBall = ball;
    this.calledBalls.push(ball);

    this.ns.emit("ball_called", {
      ball,
      col: getColForNumber(ball),
      calledBalls: [...this.calledBalls],
    });

    this.broadcastState();
  }

  handleClaimBingo(socket: Socket, data: { roundId: string; cardId: number; card?: number[][] }) {
    if (this.phase !== "playing") return;
    if (data.roundId !== this.roundId) return;

    const player = this.players.get(socket.id);
    if (!player) return;
    if (!player.cardIds.includes(data.cardId)) return;
    // Track claims by telegramId so that each player can win at most once per
    // round, but two different players who legitimately hold the same card
    // (e.g. due to a race-condition during selection) are not unfairly blocked.
    if (this.claimedThisRound.has(player.telegramId)) return;

    // Always use the server's own authoritative card data — never trust the client-supplied card.
    const serverCard = this.cfgCartelas()[data.cardId - 1];
    if (!serverCard) {
      logger.warn({ cardId: data.cardId }, "claim_bingo: cardId not found in server cartelas");
      return;
    }

    const calledSet = new Set(this.calledBalls);
    if (!checkWin(serverCard, calledSet)) return;

    // Co-winner check: if a tie window is open, only accept claims at the same
    // ball count as the first winner. Claims after extra balls have been called
    // are rejected (that player would have won earlier and didn't claim in time).
    const isFirstWinner = this.tieWindowBallCount === 0;
    if (!isFirstWinner && this.calledBalls.length !== this.tieWindowBallCount) return;

    this.claimedThisRound.add(player.telegramId);

    const winner: Winner = {
      telegramId: player.telegramId,
      firstName: player.firstName,
      cardId: data.cardId,
      card: serverCard,
      winPattern: getWinPattern(serverCard, calledSet),
    };

    this.winners.push(winner);
    logger.info({ roundId: this.roundId, telegramId: player.telegramId, cardId: data.cardId, isFirstWinner, ballCount: this.calledBalls.length }, "Winner!");

    if (isFirstWinner) {
      // First winner: freeze ball calls, open a 500 ms tie window for co-winners.
      this.tieWindowBallCount = this.calledBalls.length;
      if (this.ballTimer) { clearInterval(this.ballTimer); this.ballTimer = null; }
      if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }

      this.tieWindowTimer = setTimeout(() => {
        this.tieWindowTimer = null;
        this.declareWinnersAndFinish();
      }, 500);
    }
    // If not the first winner, simply fall through — tieWindowTimer will fire
    // and include this winner when it calls declareWinnersAndFinish().
  }

  private declareWinnersAndFinish() {
    this.phase = "finished";

    const stakePerCardW = this.cfgStakePerCard();
    const commissionPctW = this.cfgCommissionPercent();
    const totalPoolW = [...this.roundParticipants.values()].reduce((sum, p) => sum + p.cardIds.length * stakePerCardW, 0);
    const jackpotCutW = Math.round(totalPoolW * commissionPctW / 100);
    const netPoolW = totalPoolW - jackpotCutW;
    const prizePerWinner = this.winners.length > 0 ? Math.floor(netPoolW / this.winners.length) : 0;

    this.ns.emit("winner_declared", {
      roundId: this.roundId,
      winners: this.winners,
      prizePerWinner,
    });

    this.broadcastState();

    this.finishedTimer = setTimeout(() => {
      void this.saveRoundResultsAndReset();
    }, 5000);
  }

  private async saveRoundResultsAndReset() {
    const roundId = this.roundId;
    const winners = this.winners;
    const winnerTelegramIds = new Set(winners.map(w => w.telegramId));
    const stakePerCard = this.cfgStakePerCard();

    const commissionPct = this.cfgCommissionPercent();
    const totalPrizePool = [...this.roundParticipants.values()]
      .reduce((sum, p) => sum + p.cardIds.length * stakePerCard, 0);
    const jackpotContribution = Math.round(totalPrizePool * commissionPct / 100);
    const netPrizePool = totalPrizePool - jackpotContribution;
    const prizePerWinner = winnerTelegramIds.size > 0
      ? Math.floor(netPrizePool / winnerTelegramIds.size)
      : 0;

    for (const [telegramId, participant] of this.roundParticipants) {
      const isWinner = winnerTelegramIds.has(telegramId);
      const prize = isWinner ? prizePerWinner : 0;
      const stake = participant.cardIds.length * stakePerCard;

      try {
        await db.insert(gameRoundsTable).values({
          roundId,
          roomId: this.roomCfg.roomId ?? "room1",
          telegramId,
          cardIds: JSON.stringify(participant.cardIds),
          stake: `${stake}`,
          result: isWinner ? "won" : "lost",
          prize: `${prize}`,
          winnersCount: winnerTelegramIds.size,
        });

        if (isWinner && prize > 0) {
          const playerRoundDeduction = this.roundDeductions.get(telegramId);
          const usedBonus = (playerRoundDeduction?.bonus ?? 0) > 0;
          let updatedBalances: { depositBalance: string; mainBalance: string; bonusBalance: string } | null = null;

          if (usedBonus) {
            // Win from bonus-funded game → credit bonusBalance + apply wagering logic
            updatedBalances = await db.transaction(async (tx) => {
              const [playerRow] = await tx
                .select({ hasActiveWagering: playersTable.hasActiveWagering })
                .from(playersTable)
                .where(eq(playersTable.telegramId, telegramId))
                .limit(1);
              if (!playerRow) return null;

              if (!playerRow.hasActiveWagering) {
                // First win using bonus — activate 10× wagering requirement
                const wagerRequired = prize * appSettings.getNum("wageringMultiplier");
                const [updated] = await tx.update(playersTable)
                  .set({
                    bonusBalance: sql`${playersTable.bonusBalance} + ${prize}`,
                    wageringRequired: `${wagerRequired}`,
                    wageringCompleted: "0.00",
                    hasActiveWagering: true,
                  })
                  .where(eq(playersTable.telegramId, telegramId))
                  .returning({ depositBalance: playersTable.depositBalance, mainBalance: playersTable.mainBalance, bonusBalance: playersTable.bonusBalance });
                return updated ?? null;
              } else {
                // Subsequent win — add to bonusBalance only
                const [updated] = await tx.update(playersTable)
                  .set({ bonusBalance: sql`${playersTable.bonusBalance} + ${prize}` })
                  .where(eq(playersTable.telegramId, telegramId))
                  .returning({ depositBalance: playersTable.depositBalance, mainBalance: playersTable.mainBalance, bonusBalance: playersTable.bonusBalance });
                return updated ?? null;
              }
            });
          } else {
            // Win from main/deposit-funded game → credit mainBalance
            const [updated] = await db.update(playersTable)
              .set({ mainBalance: sql`${playersTable.mainBalance} + ${prize}` })
              .where(eq(playersTable.telegramId, telegramId))
              .returning({ depositBalance: playersTable.depositBalance, mainBalance: playersTable.mainBalance, bonusBalance: playersTable.bonusBalance });
            updatedBalances = updated ?? null;
          }

          await db.insert(transactionsTable).values({
            telegramId,
            type: "win",
            amount: `${prize}`,
            status: "approved",
            note: `Win prize for round ${roundId.slice(0, 8).toUpperCase()}`,
          });

          const connectedPlayer = this.findConnectedPlayer(telegramId);
          if (connectedPlayer && updatedBalances) {
            this.ns.to(connectedPlayer.socketId).emit("balance_update", {
              depositBalance: updatedBalances.depositBalance,
              mainBalance: updatedBalances.mainBalance,
              bonusBalance: updatedBalances.bonusBalance,
            });
          }
        } else if (!isWinner) {
          // Zero balance reset: if loser's bonusBalance is now 0, clear wagering state
          try {
            const [playerRow] = await db
              .select({ bonusBalance: playersTable.bonusBalance })
              .from(playersTable)
              .where(eq(playersTable.telegramId, telegramId))
              .limit(1);
            if (Number(playerRow?.bonusBalance ?? 1) === 0) {
              await db.update(playersTable)
                .set({ wageringRequired: "0.00", wageringCompleted: "0.00", hasActiveWagering: false })
                .where(eq(playersTable.telegramId, telegramId));
            }
          } catch (zeroErr) {
            logger.error({ zeroErr, telegramId }, "Failed zero balance reset check for loser");
          }
        }
      } catch (err) {
        logger.error({ err, telegramId }, "Failed to save round result");
      }
    }

    // ── Jackpot: award points + fund pool + leaderboard/distribution ──────────
    // resetRound() runs in a finally block so a jackpot DB failure never leaves
    // the engine stuck in "finished" phase with no way to start a new game.
    try {
      if (this.cfgJackpotEnabled()) {
        await this.handleJackpotLogic(roundId, this.roundParticipants, winnerTelegramIds, jackpotContribution, this.roundDeductions);
      } else {
        logger.info({ roundId, jackpotContribution }, "Jackpot disabled — skipping jackpot logic, commission retained as app revenue");
      }
    } catch (err) {
      logger.error({ err, roundId }, "Jackpot logic failed — round will still reset");
    } finally {
      this.resetRound();
    }
  }

  // ── Jackpot system ────────────────────────────────────────────────────────────

  /**
   * Called at the end of every game. Awards points, funds the jackpot pool,
   * posts the leaderboard, and distributes + resets on the admin-configured
   * final game.
   *
   * Idempotency: the entire batch-increment + point-award block runs inside a
   * single DB transaction. The first step is inserting `roundId` into
   * `jackpot_round_log` (PRIMARY KEY). If the server crashes and the function
   * is called again for the same round, that INSERT will throw a unique-key
   * violation and the transaction rolls back — no double-counting.
   */
  private async handleJackpotLogic(
    roundId: string,
    roundParticipants: Map<number, { firstName: string; cardIds: number[] }>,
    winnerTelegramIds: Set<number>,
    jackpotContribution: number,
    roundDeductions: Map<number, { main: number; bonus: number; deposit: number }>,
  ): Promise<void> {
    let batchId: number;
    let batchNumber: number;
    let gameCount: number;
    let currentPool: number;

    try {
      // Run everything atomically. The jackpot_round_log INSERT acts as the
      // idempotency gate: a duplicate roundId throws immediately and rolls back.
      const result = await db.transaction(async (tx) => {
        // ── Idempotency gate ─────────────────────────────────────────────────
        await tx.insert(jackpotRoundLogTable).values({ roundId, batchId: 0, gameCount: 0 });
        // (batchId / gameCount placeholders — updated below once we know them)

        // ── 1. Get or create the active batch ────────────────────────────────
        const existingRows = await tx
          .select()
          .from(jackpotBatchesTable)
          .where(eq(jackpotBatchesTable.isActive, true))
          .orderBy(desc(jackpotBatchesTable.id))
          .limit(1);

        let txBatchId: number;
        let txBatchNumber: number;
        let txGameCount: number;
        let txCurrentPool: number;

        if (!existingRows.length) {
          const [newBatch] = await tx
            .insert(jackpotBatchesTable)
            .values({ batchNumber: 1, gameCount: 1, jackpotPool: `${jackpotContribution}`, isActive: true })
            .returning();
          txBatchId = newBatch!.id;
          txBatchNumber = 1;
          txGameCount = 1;
          txCurrentPool = jackpotContribution;
        } else {
          const batch = existingRows[0]!;
          const newGameCount = batch.gameCount + 1;
          const newPool = Number(batch.jackpotPool) + jackpotContribution;
          const [updated] = await tx
            .update(jackpotBatchesTable)
            .set({ gameCount: newGameCount, jackpotPool: `${newPool}` })
            .where(eq(jackpotBatchesTable.id, batch.id))
            .returning();
          txBatchId = batch.id;
          txBatchNumber = batch.batchNumber;
          txGameCount = newGameCount;
          txCurrentPool = Number(updated!.jackpotPool);
        }

        // Back-fill the real batchId / gameCount into the log row
        await tx
          .update(jackpotRoundLogTable)
          .set({ batchId: txBatchId, gameCount: txGameCount })
          .where(eq(jackpotRoundLogTable.roundId, roundId));

        // ── 2. Award points (atomic per-player upsert) ───────────────────────
        // Formula (Option A + Streak):
        //   participation = cards × 4
        //   win bonus     = cards × 3  (if winner)
        //   streak bonus  = min(consecutive games in this batch, 8)
        //
        // Eligibility rules (any one disqualifies):
        //   a) Used ANY bonus balance
        //   b) Did NOT use deposit balance (depositBalance deduction = 0)
        //
        // INSERT … ON CONFLICT keeps per-player points safe even if the loop is
        // partially replayed, because the transaction as a whole will roll back
        // on a duplicate roundId before this code is reached a second time.
        for (const [telegramId, participant] of roundParticipants) {
          const deduction = roundDeductions.get(telegramId);

           // Rule a: bonus balance used → ineligible
          if (deduction && deduction.bonus > 0) {
            logger.info({ telegramId, bonusUsed: deduction.bonus }, "Jackpot: skipping — bonus balance used");
            continue;
          }

          // Rule b: no deposit balance used → ineligible
          if (!deduction || deduction.deposit === 0) {
            logger.info({ telegramId }, "Jackpot: skipping — no deposit balance used in this round");
            continue;
          }

          const isWinner = winnerTelegramIds.has(telegramId);
          const cards = participant.cardIds.length;
           const participationPts = cards * appSettings.getNum("jackpotParticipationPoints");
           const winBonus = isWinner ? cards * appSettings.getNum("jackpotWinBonusPoints") : 0;
          const firstGamePoints = participationPts + winBonus + 1; // streak=1 on first game

          await tx.execute(sql`
            INSERT INTO jackpot_points
              (batch_id, batch_number, telegram_id, first_name, points, streak_count, last_game_count, created_at, updated_at)
            VALUES
              (${txBatchId}, ${txBatchNumber}, ${telegramId}, ${participant.firstName},
               ${firstGamePoints}, 1, ${txGameCount}, NOW(), NOW())
            ON CONFLICT (batch_id, telegram_id) DO UPDATE SET
               streak_count    = CASE
                                  WHEN jackpot_points.last_game_count = ${txGameCount} - 1
                                     THEN LEAST(jackpot_points.streak_count + 1, ${appSettings.getNum("jackpotStreakMax")})
                                  ELSE 1
                                END,
              points          = jackpot_points.points
                                  + ${participationPts}
                                  + ${winBonus}
                                  + CASE
                                       WHEN jackpot_points.last_game_count = ${txGameCount} - 1
                                         THEN LEAST(jackpot_points.streak_count + 1, ${appSettings.getNum("jackpotStreakMax")})
                                      ELSE 1
                                    END,
              last_game_count = ${txGameCount},
              first_name      = ${participant.firstName},
              updated_at      = NOW()
          `);
        }

        return { txBatchId, txBatchNumber, txGameCount, txCurrentPool };
      });

      batchId = result.txBatchId;
      batchNumber = result.txBatchNumber;
      gameCount = result.txGameCount;
      currentPool = result.txCurrentPool;
      // Keep in-memory cache up-to-date so broadcastState() sends live jackpot.
      this.jackpotPool = currentPool;

    } catch (err: unknown) {
      // A duplicate roundId means this round was already processed — safe to skip.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("jackpot_round_log") && msg.includes("duplicate")) {
        logger.warn({ roundId }, "handleJackpotLogic: round already processed, skipping");
        return;
      }
      logger.error({ err, roundId }, "handleJackpotLogic error");
      throw err;
    }

    // ── 3. Post leaderboard and distribute on the configured final game ────────
    // These run outside the transaction: they're external side-effects (Telegram
    // messages, balance credits) that must not block the DB commit.

    // Collect round winner names for the leaderboard post
    const roundWinnerNames = [...winnerTelegramIds]
      .map(tid => roundParticipants.get(tid)?.firstName)
      .filter((n): n is string => !!n);

    try {
      if (gameCount >= this.cfgJackpotFinalGame()) {
        await this.distributeJackpot(batchId, batchNumber, currentPool);
      } else {
        await this.postLeaderboardToChannel(batchId, batchNumber, gameCount, currentPool, roundWinnerNames);
      }
    } catch (err) {
      logger.error({ err, roundId, gameCount }, "handleJackpotLogic: post-commit step failed");
    }
  }

  /** Post a top-10 leaderboard update to the dedicated jackpot channel */
  private async postLeaderboardToChannel(
    batchId: number,
    batchNumber: number,
    gameCount: number,
    currentPool: number,
    roundWinnerNames: string[] = [],
  ): Promise<void> {
    const channelId = appSettings.get("jackpotChannelId");

    try {
      const rows = await db
        .select()
        .from(jackpotPointsTable)
        .where(eq(jackpotPointsTable.batchId, batchId))
        .orderBy(desc(jackpotPointsTable.points))
        .limit(10);

      if (!rows.length) return;

      const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
      const lines = rows.map((r, i) => `${medals[i] ?? "•"} ${r.firstName} — ${r.points} ነጥብ`);

      const winnerLine = roundWinnerNames.length > 0
        ? `🎯 *የዙሩ አሸናፊ:* ${roundWinnerNames.join(", ")}\n`
        : "";

      const nextLine = `📊 ጠቅላላ ዙሮች: ${gameCount}`;
      const title = `🏆 *ጃክፖት ሊደርቦርድ — ዙር ${gameCount}*`;

      const message =
        `${title}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        winnerLine +
        lines.join("\n") +
        `\n━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 ጃክፖት ቦርሳ: *${currentPool.toFixed(2)} ETB*\n` +
        nextLine;

      await bot.api.sendMessage(channelId, message, { parse_mode: "Markdown" });
      logger.info({ gameCount, batchNumber }, "Posted jackpot leaderboard to jackpot channel");
    } catch (err) {
      logger.error({ err, channelId }, "Failed to post leaderboard to jackpot channel");
    }
  }

  /** Distribute jackpot pool to top 3, reset batch, announce in channel */
  private async distributeJackpot(
    batchId: number,
    batchNumber: number,
    currentPool: number,
  ): Promise<void> {
    try {
      // Fetch top 3 by points
      const top3 = await db
        .select()
        .from(jackpotPointsTable)
        .where(eq(jackpotPointsTable.batchId, batchId))
        .orderBy(desc(jackpotPointsTable.points))
        .limit(3);

      const splits = [
        appSettings.getNum("jackpotFirstPrizePercent") / 100,
        appSettings.getNum("jackpotSecondPrizePercent") / 100,
        appSettings.getNum("jackpotThirdPrizePercent") / 100,
      ];
      const prizes: Array<{ telegramId: number; firstName: string; points: number; prize: number }> = [];

      for (let i = 0; i < top3.length; i++) {
        const player = top3[i]!;
        const prize = Math.floor(currentPool * splits[i]!);
        prizes.push({ telegramId: player.telegramId, firstName: player.firstName, points: player.points, prize });

        if (prize > 0) {
          try {
            // Jackpot prizes go to bonusBalance (non-withdrawable)
            await db
              .update(playersTable)
              .set({ bonusBalance: sql`${playersTable.bonusBalance} + ${prize}` })
              .where(eq(playersTable.telegramId, player.telegramId));

            await db.insert(transactionsTable).values({
              telegramId: player.telegramId,
              type: "win",
              amount: `${prize}`,
              status: "approved",
              note: `Jackpot batch #${batchNumber} — ${i + 1}${i === 0 ? "st" : i === 1 ? "nd" : "rd"} place`,
            });
          } catch (err) {
            logger.error({ err, telegramId: player.telegramId }, "Failed to credit jackpot prize");
          }
        }
      }

      // Mark batch as completed
      await db
        .update(jackpotBatchesTable)
        .set({ isActive: false, completedAt: new Date() })
        .where(eq(jackpotBatchesTable.id, batchId));

      // Create the next batch
      await db.insert(jackpotBatchesTable).values({
        batchNumber: batchNumber + 1,
        gameCount: 0,
        jackpotPool: "0.00",
        isActive: true,
      });

      // New batch starts at 0
      this.jackpotPool = 0;
      logger.info({ batchNumber, currentPool, winners: prizes.length }, "Jackpot distributed, new batch started");

      const winnerMedals = ["🥇", "🥈", "🥉"];
      const placeNames = ["1ኛ", "2ኛ", "3ኛ"];
      const winnerIds = new Set(prizes.map((p) => p.telegramId));

      // ── 1. Personal DM to each winner ────────────────────────────────────────
      for (let i = 0; i < prizes.length; i++) {
        const p = prizes[i]!;
        if (p.prize <= 0) continue;
        const dm =
          `🎉 እንኳን ደስ አለዎት, *${p.firstName}*!\n\n` +
          `${winnerMedals[i]} ከጃክፖት ዙር #${batchNumber} *${placeNames[i]}* ቦታ አሸነፉ!\n\n` +
          `💰 ሽልማትዎ: *${p.prize.toFixed(2)} ETB* ወደ ሂሳብዎ ተጨምሯል።\n` +
          `📊 ነጥቦችዎ: ${p.points} ነጥብ\n\n` +
          `⚡ ቀጣዩ ጃክፖት ዙር ተጀምሯል! ጨዋታ ቀጥሉ!`;
        try {
          await bot.api.sendMessage(p.telegramId, dm, { parse_mode: "Markdown" });
        } catch (err) {
          logger.error({ err, telegramId: p.telegramId }, "Failed to send jackpot DM to winner");
        }
      }

      // ── 2. General announcement to all players ────────────────────────────────
      const winLines = prizes
        .filter((p) => p.prize > 0)
        .map((p, i) => {
          const prizeStr = Number.isInteger(p.prize) ? `${p.prize}` : p.prize.toFixed(2);
          return `${winnerMedals[i]} ${p.firstName} — ${p.points} pts → ${prizeStr} ETB`;
        });

      const poolStr = Number.isInteger(currentPool) ? `${currentPool}` : currentPool.toFixed(2);

      const generalMsg =
        `🔥 ጃክፖቱ ተበላ!\n\n` +
        `በዙር #${batchNumber} ${poolStr} ብር ለአንበሶቹ ተጫዋቾቻችን ተከፋፍሏል !\n\n` +
        `👇 ዕድለኞቹ:\n` +
        winLines.join("\n") +
        `\n\n⚡ ቀጣዩ ዙር አሁን ተጀምሯል! ቀድመው በመግባት የማሸነፍ እድልዎን ከፍተኛ ያድርጉ! 💸\n\n` +
        `በየ10 ዙር ዳጎስ ያለ ሽልማት 😎\n\n` +
        `መልካም እድል 🥂`;

      let allPlayers: { telegramId: number }[] = [];
      try {
        allPlayers = await db.select({ telegramId: playersTable.telegramId }).from(playersTable);
      } catch (err) {
        logger.error({ err }, "Failed to fetch players for jackpot broadcast");
      }

      for (const player of allPlayers) {
        try {
          await bot.api.sendMessage(player.telegramId, generalMsg);
        } catch {
          // Silently skip — player may have blocked the bot
        }
      }

      // ── 3. Post final result to dedicated jackpot channel ─────────────────────
      try {
        const channelId = appSettings.get("jackpotChannelId");
        await bot.api.sendMessage(channelId, generalMsg);
        logger.info({ batchNumber, channelId }, "Posted jackpot result to jackpot channel");
      } catch (err) {
        logger.error({ err }, "Failed to post jackpot result to configured channel");
      }
    } catch (err) {
      logger.error({ err }, "distributeJackpot error");
    }
  }

  private resetRound() {
    this.clearAllTimers();
    this.roundId = randomUUID();
    this.winners = [];
    this.claimedThisRound = new Set();
    this.tieWindowBallCount = 0;
    this.calledBalls = [];
    this.currentBall = null;
    this.availableBalls = this.makeAvailableBalls();

    this.persistentCards.clear();
    this.roundParticipants.clear();
    this.cardDeductions.clear();
    this.roundDeductions.clear();

    for (const player of this.players.values()) {
      player.cardIds = [];
    }

    this.ns.emit("round_reset", { roundId: this.roundId });
    logger.info({ roundId: this.roundId }, "Round reset");
    this.startCountdown();
  }

  private clearAllTimers() {
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    if (this.ballTimer) { clearInterval(this.ballTimer); this.ballTimer = null; }
    if (this.finishedTimer) { clearTimeout(this.finishedTimer); this.finishedTimer = null; }
    if (this.tieWindowTimer) { clearTimeout(this.tieWindowTimer); this.tieWindowTimer = null; }
  }

  async initJackpotPool(): Promise<void> {
    if (!this.cfgJackpotEnabled()) {
      this.jackpotPool = 0;
      logger.info("Jackpot disabled — pool initialised to 0");
      return;
    }
    const maxAttempts = 10;
    const delayMs = 2000;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const rows = await db
          .select({ jackpotPool: jackpotBatchesTable.jackpotPool })
          .from(jackpotBatchesTable)
          .where(eq(jackpotBatchesTable.isActive, true))
          .orderBy(desc(jackpotBatchesTable.id))
          .limit(1);
        this.jackpotPool = rows[0] ? Number(rows[0].jackpotPool) : 0;
        logger.info({ jackpotPool: this.jackpotPool }, "Jackpot pool initialised");
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const tableNotReady = msg.includes("does not exist") || msg.includes("relation");
        if (tableNotReady && attempt < maxAttempts) {
          logger.warn({ attempt, maxAttempts }, "initJackpotPool: tables not ready yet, retrying…");
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          logger.error({ err, attempt }, "Failed to init jackpot pool");
          throw err;
        }
      }
    }
  }

  private broadcastState() {
    const stakePerCard = this.cfgStakePerCard();
    const commissionPct = this.cfgCommissionPercent();
    let playersWithCards: number;
    let prizePool: number;

    if (this.phase === "playing" || this.phase === "finished") {
      const participants = [...this.roundParticipants.values()];
      playersWithCards = participants.reduce((sum, p) => sum + p.cardIds.length, 0);
      prizePool = participants.reduce((sum, p) => sum + p.cardIds.length * stakePerCard, 0);
    } else {
      const persistent = [...this.persistentCards.values()];
      playersWithCards = persistent.reduce((sum, p) => sum + p.cardIds.length, 0);
      prizePool = persistent.reduce((sum, p) => sum + p.cardIds.length * stakePerCard, 0);
    }

    const commissionAmount = Math.floor(prizePool * commissionPct / 100);
    const netPrizePool = prizePool - commissionAmount;

    const totalCardsInRound = [...this.players.values()].reduce((s, p) => s + p.cardIds.length, 0);
    const state: BroadcastState = {
      roundId: this.roundId,
      phase: this.phase,
      countdown: this.countdown,
      playerCount: totalCardsInRound,
      playersWithCards,
      prizePool,
      netPrizePool,
      calledBalls: [...this.calledBalls],
      currentBall: this.currentBall,
      jackpotPool: this.cfgJackpotEnabled() ? this.jackpotPool : 0,
    };
    this.ns.emit("game_state", state);
  }

  private findConnectedPlayer(telegramId: number): PlayerState | undefined {
    for (const p of this.players.values()) {
      if (p.telegramId === telegramId) return p;
    }
    return undefined;
  }

  async handleJoin(socket: Socket, data: { telegramId: number; firstName: string }) {
    const { telegramId, firstName } = data;

    if (this.players.has(socket.id)) return;

    for (const [sid, p] of this.players) {
      if (p.telegramId === telegramId && sid !== socket.id) {
        this.players.delete(sid);
        logger.info({ telegramId, oldSocketId: sid }, "Removed stale socket on reconnect");
      }
    }

    const isReturningPlayer = this.persistentCards.has(telegramId) || this.roundParticipants.has(telegramId);
    if (this.phase === "waiting" && !isReturningPlayer) {
      const stakePerCard = this.cfgStakePerCard();
      // Only check balance when there's an actual stake requirement
      if (stakePerCard > 0) {
        try {
          // Check combined ETB balance (depositBalance + mainBalance + bonusBalance) — stakes are paid in ETB.
          const rows = await db.select({ depositBalance: playersTable.depositBalance, mainBalance: playersTable.mainBalance, bonusBalance: playersTable.bonusBalance })
            .from(playersTable).where(eq(playersTable.telegramId, telegramId)).limit(1);
          const depositBal = rows[0] ? Number(rows[0].depositBalance) : 0;
          const mainBal = rows[0] ? Number(rows[0].mainBalance) : 0;
          const bonusBal = rows[0] ? Number(rows[0].bonusBalance) : 0;
          const balance = depositBal + mainBal + bonusBal;
          if (balance < stakePerCard) {
            const msg = `ጨዋታ ለመቀላቀል ቢያንስ ${stakePerCard} ብር ያስፈልጋል። አሁን ያለዎ ባላንስ: ${balance.toFixed(2)} ብር`;
            socket.emit("join_error", { message: msg });
            logger.info({ telegramId, balance, stakePerCard, namespace: this.roomCfg.namespace ?? "/" }, "join_error: insufficient balance");
            return;
          }
        } catch (err) {
          logger.error({ err, telegramId }, "Failed to check balance for bingo join");
        }
      }
    }

    let cardIds: number[] = [];
    if (this.phase === "waiting" && this.persistentCards.has(telegramId)) {
      cardIds = [...this.persistentCards.get(telegramId)!.cardIds];
      logger.info({ telegramId, cardIds }, "Restored card selection on reconnect (waiting)");
    } else if ((this.phase === "playing" || this.phase === "finished") && this.roundParticipants.has(telegramId)) {
      cardIds = [...this.roundParticipants.get(telegramId)!.cardIds];
      logger.info({ telegramId, cardIds }, "Restored participation on reconnect (playing/finished)");
    }

    this.players.set(socket.id, { socketId: socket.id, telegramId, firstName, cardIds });

    const stakePerCard = this.cfgStakePerCard();
    const commissionPct = this.cfgCommissionPercent();
    let playersWithCardsCount: number;
    let prizePool: number;
    if (this.phase === "playing" || this.phase === "finished") {
      const participants = [...this.roundParticipants.values()];
      playersWithCardsCount = participants.reduce((sum, p) => sum + p.cardIds.length, 0);
      prizePool = participants.reduce((sum, p) => sum + p.cardIds.length * stakePerCard, 0);
    } else {
      const persistent = [...this.persistentCards.values()];
      playersWithCardsCount = persistent.reduce((sum, p) => sum + p.cardIds.length, 0);
      prizePool = persistent.reduce((sum, p) => sum + p.cardIds.length * stakePerCard, 0);
    }
    const commissionAmount = Math.floor(prizePool * commissionPct / 100);

    const totalCardsOnJoin = [...this.players.values()].reduce((s, p) => s + p.cardIds.length, 0);
    socket.emit("game_state", {
      roundId: this.roundId,
      phase: this.phase,
      countdown: this.countdown,
      playerCount: totalCardsOnJoin,
      playersWithCards: playersWithCardsCount,
      prizePool,
      netPrizePool: prizePool - commissionAmount,
      calledBalls: [...this.calledBalls],
      currentBall: this.currentBall,
      jackpotPool: this.cfgJackpotEnabled() ? this.jackpotPool : 0,
    });

    if (cardIds.length > 0) {
      socket.emit("my_cards", { cardIds });
    }

    if (this.phase === "playing") {
      socket.emit("ball_called", {
        ball: this.currentBall,
        col: this.currentBall ? getColForNumber(this.currentBall) : null,
        calledBalls: [...this.calledBalls],
      });
    }

    if (this.phase === "finished" && this.winners.length > 0) {
      const totalPoolJ = [...this.roundParticipants.values()].reduce((sum, p) => sum + p.cardIds.length * stakePerCard, 0);
      const netPoolJ = totalPoolJ - Math.floor(totalPoolJ * commissionPct / 100);
      const prizePerWinnerJ = this.winners.length > 0 ? Math.floor(netPoolJ / this.winners.length) : 0;
      socket.emit("winner_declared", { roundId: this.roundId, winners: this.winners, prizePerWinner: prizePerWinnerJ });
    }

    // During an active game the count is locked; only update it in waiting phase.
    const joinEmitCount = (this.phase === "playing" || this.phase === "finished")
      ? this.lockedPlayerCount
      : this.players.size;
    this.ns.emit("player_count", { count: joinEmitCount });

    if (this.phase === "waiting") {
      socket.emit("cards_taken", { cardIds: this.getAllTakenCardIds() });
    }

    logger.info({ socketId: socket.id, telegramId, restoredCards: cardIds.length }, "Player joined");
  }

  private getAllTakenCardIds(): number[] {
    const taken: number[] = [];
    for (const { cardIds } of this.persistentCards.values()) {
      for (const id of cardIds) {
        taken.push(id);
      }
    }
    return taken;
  }

  private broadcastTakenCards() {
    this.ns.emit("cards_taken", { cardIds: this.getAllTakenCardIds() });
  }

  async handleSelectCard(socket: Socket, cardId: number) {
    if (this.phase !== "waiting") return;
    const player = this.players.get(socket.id);
    if (!player) return;
    const maxCards = this.cfgMaxCards();
    if (player.cardIds.length >= maxCards) return;
    if (player.cardIds.includes(cardId)) return;
    // Prevent two players from selecting the same card (race-condition guard).
    if (this.getAllTakenCardIds().includes(cardId)) return;

    const stakePerCard = this.cfgStakePerCard();
    // Deduct stakePerCard: depositBalance first, then mainBalance/bonusBalance per preference.
    // Uses a DB transaction with FOR UPDATE to prevent concurrent double-spend.
    if (stakePerCard > 0) {
      type DeductResult = { mainDeduct: number; bonusDeduct: number; depositDeduct: number; depositBalance: string; mainBalance: string; bonusBalance: string };
      let deductResult: DeductResult | null = null;
      try {
        deductResult = await db.transaction(async (tx) => {
          const rows = await tx.execute(
            sql`SELECT deposit_balance, main_balance, bonus_balance, has_active_wagering, preferred_balance FROM players WHERE telegram_id = ${player.telegramId} FOR UPDATE LIMIT 1`
          );
          type BalRow = { deposit_balance: string; main_balance: string; bonus_balance: string; has_active_wagering: boolean; preferred_balance: string };
          const row = rows.rows[0] as BalRow | undefined;
          if (!row) return null;

          const depositBal = Number(row.deposit_balance);
          const mainBal = Number(row.main_balance);
          const bonusBal = Number(row.bonus_balance);
          if (depositBal + mainBal + bonusBal < stakePerCard) return null;

          // Deduct depositBalance first (non-withdrawable deposit funds).
          // Remaining comes from mainBalance or bonusBalance per the player's preference.
          const depositDeduct = Math.min(depositBal, stakePerCard);
          const remaining = stakePerCard - depositDeduct;

          let mainDeduct: number;
          let bonusDeduct: number;
          if ((row.preferred_balance ?? "main_first") === "bonus_first") {
            bonusDeduct = Math.min(bonusBal, remaining);
            mainDeduct = remaining - bonusDeduct;
          } else {
            mainDeduct = Math.min(mainBal, remaining);
            bonusDeduct = remaining - mainDeduct;
          }

          // Build update object — deduct depositBalance, mainBalance, and optionally bonusBalance.
          const updateSet: Record<string, unknown> = {
            mainBalance: sql`${playersTable.mainBalance} - ${mainDeduct}`,
          };
          if (depositDeduct > 0) {
            updateSet["depositBalance"] = sql`${playersTable.depositBalance} - ${depositDeduct}`;
          }
          if (bonusDeduct > 0) {
            updateSet["bonusBalance"] = sql`${playersTable.bonusBalance} - ${bonusDeduct}`;
            if (row.has_active_wagering) {
              updateSet["wageringCompleted"] = sql`${playersTable.wageringCompleted} + ${bonusDeduct}`;
            }
          }

          const [updated] = await tx.update(playersTable)
            .set(updateSet)
            .where(eq(playersTable.telegramId, player.telegramId))
            .returning({ depositBalance: playersTable.depositBalance, mainBalance: playersTable.mainBalance, bonusBalance: playersTable.bonusBalance });

          if (!updated) return null;
          return { mainDeduct, bonusDeduct, depositDeduct, depositBalance: updated.depositBalance, mainBalance: updated.mainBalance, bonusBalance: updated.bonusBalance };
        });
      } catch (err) {
        logger.error({ err, telegramId: player.telegramId }, "Failed to deduct stake on card selection");
        socket.emit("select_card_error", { message: "ስህተት ተፈጥሯል። እንደገና ይሞክሩ።", depositBalance: "0", mainBalance: "0", bonusBalance: "0" });
        return;
      }

      if (!deductResult) {
        const balRows = await db
          .select({ depositBalance: playersTable.depositBalance, mainBalance: playersTable.mainBalance, bonusBalance: playersTable.bonusBalance })
          .from(playersTable)
          .where(eq(playersTable.telegramId, player.telegramId))
          .limit(1);
        const depositBal = Number(balRows[0]?.depositBalance ?? 0);
        const mainBal = Number(balRows[0]?.mainBalance ?? 0);
        const bonusBal = Number(balRows[0]?.bonusBalance ?? 0);
        socket.emit("select_card_error", {
          message: `ካርድ ለመምረጥ ቢያንስ ${stakePerCard} ብር ያስፈልጋል። አሁን ያለዎ ባላንስ: ${(depositBal + mainBal + bonusBal).toFixed(2)} ብር`,
          depositBalance: depositBal.toFixed(2),
          mainBalance: mainBal.toFixed(2),
          bonusBalance: bonusBal.toFixed(2),
        });
        return;
      }

      // Track deductions per card (for exact refunds) and aggregate for round win logic
      if (!this.cardDeductions.has(player.telegramId)) {
        this.cardDeductions.set(player.telegramId, new Map());
      }
      this.cardDeductions.get(player.telegramId)!.set(cardId, { main: deductResult.mainDeduct, bonus: deductResult.bonusDeduct, deposit: deductResult.depositDeduct });
      const prevRound = this.roundDeductions.get(player.telegramId) ?? { main: 0, bonus: 0, deposit: 0 };
      this.roundDeductions.set(player.telegramId, {
        main: prevRound.main + deductResult.mainDeduct,
        bonus: prevRound.bonus + deductResult.bonusDeduct,
        deposit: prevRound.deposit + deductResult.depositDeduct,
      });

      // Zero balance reset: if bonusBalance hits 0, clear wagering state
      if (Number(deductResult.bonusBalance) === 0) {
        try {
          await db.update(playersTable)
            .set({ wageringRequired: "0.00", wageringCompleted: "0.00", hasActiveWagering: false })
            .where(eq(playersTable.telegramId, player.telegramId));
        } catch (err) {
          logger.error({ err }, "Failed wagering reset on zero bonus balance");
        }
      }

      // Emit updated balances immediately
      socket.emit("balance_update", {
        depositBalance: deductResult.depositBalance,
        mainBalance: deductResult.mainBalance,
        bonusBalance: deductResult.bonusBalance,
      });
    }

    // Re-check atomically after the async boundary.
    if (player.cardIds.includes(cardId)) return;
    if (this.getAllTakenCardIds().includes(cardId)) {
      // Card was grabbed by another player while we were deducting — refund.
      if (stakePerCard > 0) {
        const deduction = this.cardDeductions.get(player.telegramId)?.get(cardId);
        if (deduction) {
          try {
            const refund = await db.update(playersTable)
              .set({
                depositBalance: sql`${playersTable.depositBalance} + ${deduction.deposit}`,
                mainBalance: sql`${playersTable.mainBalance} + ${deduction.main}`,
                bonusBalance: sql`${playersTable.bonusBalance} + ${deduction.bonus}`,
              })
              .where(eq(playersTable.telegramId, player.telegramId))
              .returning({ depositBalance: playersTable.depositBalance, mainBalance: playersTable.mainBalance, bonusBalance: playersTable.bonusBalance });
            this.cardDeductions.get(player.telegramId)?.delete(cardId);
            const prevRound = this.roundDeductions.get(player.telegramId) ?? { main: 0, bonus: 0, deposit: 0 };
            this.roundDeductions.set(player.telegramId, {
              main: prevRound.main - deduction.main,
              bonus: prevRound.bonus - deduction.bonus,
              deposit: prevRound.deposit - deduction.deposit,
            });
            if (refund[0]) socket.emit("balance_update", { depositBalance: refund[0].depositBalance, mainBalance: refund[0].mainBalance, bonusBalance: refund[0].bonusBalance });
          } catch (e) { logger.error({ e }, "Failed to refund after lost card race"); }
        }
      }
      return;
    }

    player.cardIds.push(cardId);
    this.persistentCards.set(player.telegramId, { firstName: player.firstName, cardIds: [...player.cardIds] });
    socket.emit("my_cards", { cardIds: player.cardIds });
    this.broadcastTakenCards();
    this.broadcastState();
  }

  async handleDeselectCard(socket: Socket, cardId: number) {
    const player = this.players.get(socket.id);
    if (!player) return;
    if (!player.cardIds.includes(cardId)) return;
    player.cardIds = player.cardIds.filter(id => id !== cardId);
    this.persistentCards.set(player.telegramId, { firstName: player.firstName, cardIds: [...player.cardIds] });

    // Refund the exact amounts (main + bonus) that were deducted for this card.
    const stakePerCard = this.cfgStakePerCard();
    if (stakePerCard > 0) {
      const deduction = this.cardDeductions.get(player.telegramId)?.get(cardId);
      const depositRefund = deduction?.deposit ?? 0;
      const mainRefund = deduction?.main ?? stakePerCard;
      const bonusRefund = deduction?.bonus ?? 0;

      try {
        const updatedRows = await db.update(playersTable)
          .set({
            depositBalance: sql`${playersTable.depositBalance} + ${depositRefund}`,
            mainBalance: sql`${playersTable.mainBalance} + ${mainRefund}`,
            bonusBalance: sql`${playersTable.bonusBalance} + ${bonusRefund}`,
          })
          .where(eq(playersTable.telegramId, player.telegramId))
          .returning({ depositBalance: playersTable.depositBalance, mainBalance: playersTable.mainBalance, bonusBalance: playersTable.bonusBalance });

        if (deduction) {
          this.cardDeductions.get(player.telegramId)?.delete(cardId);
          const prevRound = this.roundDeductions.get(player.telegramId) ?? { main: 0, bonus: 0, deposit: 0 };
          this.roundDeductions.set(player.telegramId, {
            main: prevRound.main - deduction.main,
            bonus: prevRound.bonus - deduction.bonus,
            deposit: prevRound.deposit - deduction.deposit,
          });
        }

        if (updatedRows[0]) {
          socket.emit("balance_update", {
            depositBalance: updatedRows[0].depositBalance,
            mainBalance: updatedRows[0].mainBalance,
            bonusBalance: updatedRows[0].bonusBalance,
          });
        }
      } catch (err) {
        logger.error({ err, telegramId: player.telegramId }, "Failed to refund stake on card deselection");
      }
    }

    socket.emit("my_cards", { cardIds: player.cardIds });
    this.broadcastTakenCards();
    this.broadcastState();
  }

  handleDisconnect(socketId: string) {
    const player = this.players.get(socketId);
    this.players.delete(socketId);
    // During an active game the count is locked; only update it in waiting phase.
    const emitCount = (this.phase === "playing" || this.phase === "finished")
      ? this.lockedPlayerCount
      : this.players.size;
    this.ns.emit("player_count", { count: emitCount });
    if (player) {
      logger.info({ socketId, telegramId: player.telegramId }, "Player disconnected (state preserved for reconnect)");
    }
  }

  getState(): BroadcastState {
    return {
      roundId: this.roundId,
      phase: this.phase,
      countdown: this.countdown,
      // Use locked count during playing/finished so the chip never changes mid-game.
      playerCount: (this.phase === "playing" || this.phase === "finished")
        ? this.lockedPlayerCount
        : [...this.players.values()].reduce((s, p) => s + p.cardIds.length, 0),
      playersWithCards: this.computePlayersWithCards(),
      prizePool: this.computePrizePool(),
      netPrizePool: this.computeNetPrizePool(),
      calledBalls: [...this.calledBalls],
      currentBall: this.currentBall,
      jackpotPool: this.jackpotPool,
    };
  }

  getRoomStatus() {
    const playersWithCards = this.computePlayersWithCards();
    const totalCards = [...this.players.values()].reduce((s, p) => s + p.cardIds.length, 0);
    const stakePerCard = this.cfgStakePerCard();
    const commissionPct = this.cfgCommissionPercent();
    const prizePool = totalCards * stakePerCard;
    const netPrizePool = prizePool * (1 - commissionPct / 100);
    return {
      roomId: this.roomCfg.roomId ?? "room1",
      namespace: ('name' in this.ns ? this.ns.name : '/') as string,
      roundId: this.roundId,
      phase: this.phase,
      countdown: this.countdown,
      playerCount: this.players.size,
      playersWithCards,
      totalCards,
      calledBalls: this.calledBalls.length,
      currentBall: this.currentBall,
      stakePerCard,
      commissionPercent: commissionPct,
      prizePool,
      netPrizePool,
    };
  }

  private computePlayersWithCards(): number {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.cardIds.length > 0) count++;
    }
    return count;
  }

  private computePrizePool(): number {
    const totalCards = [...this.players.values()].reduce((s, p) => s + p.cardIds.length, 0);
    return totalCards * this.cfgStakePerCard();
  }

  private computeNetPrizePool(): number {
    return this.computePrizePool() * (1 - this.cfgCommissionPercent() / 100);
  }

  async enterMaintenance(): Promise<{ refunded: number }> {
    this.clearAllTimers();

    let refunded = 0;

    if (this.phase === "playing" || this.phase === "finished") {
      const stakePerCard = this.cfgStakePerCard();
      for (const [telegramId, participant] of this.roundParticipants) {
        const refundAmount = participant.cardIds.length * stakePerCard;
        if (refundAmount <= 0) continue;
        try {
          // Refund proportionally — use tracked deductions if available
          const deduction = this.roundDeductions.get(telegramId);
          const depositRefund = deduction?.deposit ?? 0;
          const mainRefund = deduction?.main ?? refundAmount;
          const bonusRefund = deduction?.bonus ?? 0;

          const updated = await db.update(playersTable)
            .set({
              depositBalance: sql`${playersTable.depositBalance} + ${depositRefund}`,
              mainBalance: sql`${playersTable.mainBalance} + ${mainRefund}`,
              bonusBalance: sql`${playersTable.bonusBalance} + ${bonusRefund}`,
            })
            .where(eq(playersTable.telegramId, telegramId))
            .returning({ depositBalance: playersTable.depositBalance, mainBalance: playersTable.mainBalance, bonusBalance: playersTable.bonusBalance });

          await db.insert(transactionsTable).values({
            telegramId,
            type: "refund",
            amount: `${refundAmount}`,
            status: "approved",
            note: `Maintenance mode — stake refunded (round ${this.roundId.slice(0, 8).toUpperCase()})`,
          });

          const connected = this.findConnectedPlayer(telegramId);
          if (connected && updated[0]) {
            this.ns.to(connected.socketId).emit("balance_update", {
              depositBalance: updated[0].depositBalance,
              mainBalance: updated[0].mainBalance,
              bonusBalance: updated[0].bonusBalance,
            });
          }
          refunded++;
        } catch (err) {
          logger.error({ err, telegramId }, "Failed to refund stake on maintenance");
        }
      }
    }

    this.phase = "waiting";
    this.persistentCards.clear();
    this.roundParticipants.clear();
    for (const player of this.players.values()) {
      player.cardIds = [];
    }
    this.calledBalls = [];
    this.currentBall = null;
    this.winners = [];
    this.claimedThisRound = new Set();
    this.roundId = randomUUID();

    this.ns.emit("maintenance_mode", { enabled: true });
    logger.info({ refunded }, "Maintenance mode entered");
    return { refunded };
  }

  exitMaintenance() {
    this.ns.emit("maintenance_mode", { enabled: false });
    logger.info("Maintenance mode exited");
    this.startCountdown();
  }
}
