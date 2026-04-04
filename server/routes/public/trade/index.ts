import { Router, type Request, type Response } from "express";
import { authRequired } from "../../middleware";
import { executeTrade } from "../../../services/trade";

const router = Router();

router.post("/", authRequired, async (req: Request, res: Response) => {
    try {
        const { conditionId, outcome, amount, leverage } = req.body;

        if (!conditionId || !outcome || !amount || !leverage) {
            res.status(400).json({ error: "Missing required fields: conditionId, outcome, amount, leverage" });
            return;
        }

        if (outcome !== "Yes" && outcome !== "No") {
            res.status(400).json({ error: "outcome must be 'Yes' or 'No'" });
            return;
        }

        const numAmount = parseFloat(amount);
        const numLeverage = parseInt(leverage, 10);

        if (isNaN(numAmount) || numAmount <= 0) {
            res.status(400).json({ error: "amount must be a positive number" });
            return;
        }

        if (isNaN(numLeverage) || numLeverage < 1 || numLeverage > 20) {
            res.status(400).json({ error: "leverage must be between 1 and 20" });
            return;
        }

        const result = await executeTrade({
            wallet: req.user!.wallet,
            conditionId,
            outcome,
            amount: numAmount,
            leverage: numLeverage,
        });

        res.json(result);
    } catch (err: any) {
        console.error("Trade error:", err);
        res.status(500).json({ error: err.message || "Trade failed" });
    }
});

export default router;
