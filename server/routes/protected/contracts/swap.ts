import { Router } from "express";
import { getQuote } from "../../../services/swap";

const router = Router();

router.get("/quote", async (req, res) => {
    try {
        const { tokenIn, amountIn, slippageBps } = req.query;

        if (!tokenIn || !amountIn) {
            res.status(400).json({ error: "tokenIn and amountIn query params required" });
            return;
        }

        const quote = await getQuote(
            tokenIn as string,
            amountIn as string,
            slippageBps ? parseInt(slippageBps as string, 10) : undefined,
        );

        res.json(quote);
    } catch (err: any) {
        console.error("[swap/quote] Error:", err);
        res.status(500).json({ error: err.message || "Failed to get quote" });
    }
});

export default router;
