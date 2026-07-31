import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { getGameEngine, getGameEngine5 } from "../lib/gameSocket";

const router: IRouter = Router();

router.get("/game/rooms", (_req: Request, res: Response) => {
  try {
    res.json({
      room10: getGameEngine()?.getPublicState() ?? null,
      room5: getGameEngine5()?.getPublicState() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "game/rooms error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
