import { Router } from "express";
import { getPoolStats, getLPBalance } from "../../../services/pool";

const router = Router();

router.get("/stats", async (_req, res) => {
    try {
        const stats = await getPoolStats();
        res.json(stats);
    } catch (err) {
        console.error("[pool/stats] Error:", err);
        res.status(500).json({ error: "Failed to fetch pool stats" });
    }
});

router.get("/balance/:address", async (req, res) => {
    try {
        const balance = await getLPBalance(req.params.address);
        res.json(balance);
    } catch (err) {
        console.error("[pool/balance] Error:", err);
        res.status(500).json({ error: "Failed to fetch LP balance" });
    }
});

export default router;
