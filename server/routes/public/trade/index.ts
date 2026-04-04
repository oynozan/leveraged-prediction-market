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
    } catch (err: unknown) {
        const raw = (err as any)?.response?.data?.error
            || (err as any)?.response?.data?.message
            || (err instanceof Error ? err.message : "Trade failed");
        const msg = raw.replace(/\b(\d{4,})\b/g, (_: string, n: string) => {
            const num = parseInt(n, 10);
            if (num >= 1000) return `$${(num / 1_000_000).toFixed(2)}`;
            return n;
        });
        console.error("Trade error:", msg);
        res.status(500).json({ error: msg });
    }
});

export default router;
