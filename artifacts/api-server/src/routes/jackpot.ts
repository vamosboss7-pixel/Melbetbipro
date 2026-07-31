import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { db } from "../lib/db";
import { jackpotBatchesTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/jackpot/status — current pool balance and game number
router.get("/jackpot/status", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(jackpotBatchesTable)
      .where(eq(jackpotBatchesTable.isActive, true))
      .orderBy(desc(jackpotBatchesTable.id))
      .limit(1);

    if (!rows.length) {
      res.json({ pool: 0, gameNumber: 0, batchNumber: 1 });
      return;
    }

    const batch = rows[0]!;
    res.json({
      pool: Number(batch.jackpotPool),
      gameNumber: batch.gameCount,
      batchNumber: batch.batchNumber,
    });
  } catch (err) {
    logger.error({ err }, "jackpot/status error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
