import { Router } from "express";
import {
    getNettingState,
    getCurrentHoldings,
    openPosition,
    closePosition,
} from "../../../services/netting";

const router = Router();

router.get("/:conditionId", async (req, res) => {
    try {
        const state = await getNettingState(req.params.conditionId);
        res.json(state);
    } catch (err) {
        console.error("[netting/state] Error:", err);
        res.status(500).json({ error: "Failed to fetch netting state" });
    }
});

router.get("/:conditionId/holdings", async (req, res) => {
    try {
        const holdings = await getCurrentHoldings(req.params.conditionId);
        res.json(holdings);
    } catch (err) {
        console.error("[netting/holdings] Error:", err);
        res.status(500).json({ error: "Failed to fetch holdings" });
    }
});

router.post("/open", async (req, res) => {
    try {
        const { user, conditionId, isYes, tokenAmount } = req.body;
        if (!user || !conditionId || isYes === undefined || !tokenAmount) {
            res.status(400).json({ error: "user, conditionId, isYes, and tokenAmount required" });
            return;
        }
        const receipt = await openPosition(user, conditionId, isYes, tokenAmount);
        res.json({ ok: true, txHash: receipt.hash });
    } catch (err: any) {
        console.error("[netting/open] Error:", err);
        res.status(500).json({ error: err.message || "Transaction failed" });
    }
});

router.post("/close", async (req, res) => {
    try {
        const { user, conditionId, isYes, tokenAmount } = req.body;
        if (!user || !conditionId || isYes === undefined || !tokenAmount) {
            res.status(400).json({ error: "user, conditionId, isYes, and tokenAmount required" });
            return;
        }
        const receipt = await closePosition(user, conditionId, isYes, tokenAmount);
        res.json({ ok: true, txHash: receipt.hash });
    } catch (err: any) {
        console.error("[netting/close] Error:", err);
        res.status(500).json({ error: err.message || "Transaction failed" });
    }
});

export default router;
