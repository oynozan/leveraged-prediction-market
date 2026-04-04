import { Router } from "express";
import {
    getUserMargin,
    lockMargin,
    releaseMargin,
    borrowFromPool,
    repayToPool,
} from "../../../services/vault";

const router = Router();

router.get("/margin/:address", async (req, res) => {
    try {
        const margin = await getUserMargin(req.params.address);
        res.json(margin);
    } catch (err) {
        console.error("[vault/margin] Error:", err);
        res.status(500).json({ error: "Failed to fetch margin" });
    }
});

router.post("/lock-margin", async (req, res) => {
    try {
        const { user, amount } = req.body;
        if (!user || !amount) {
            res.status(400).json({ error: "user and amount required" });
            return;
        }
        const receipt = await lockMargin(user, amount);
        res.json({ ok: true, txHash: receipt.hash });
    } catch (err: any) {
        console.error("[vault/lock-margin] Error:", err);
        res.status(500).json({ error: err.message || "Transaction failed" });
    }
});

router.post("/release-margin", async (req, res) => {
    try {
        const { user, amount } = req.body;
        if (!user || !amount) {
            res.status(400).json({ error: "user and amount required" });
            return;
        }
        const receipt = await releaseMargin(user, amount);
        res.json({ ok: true, txHash: receipt.hash });
    } catch (err: any) {
        console.error("[vault/release-margin] Error:", err);
        res.status(500).json({ error: err.message || "Transaction failed" });
    }
});

router.post("/borrow", async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount) {
            res.status(400).json({ error: "amount required" });
            return;
        }
        const receipt = await borrowFromPool(amount);
        res.json({ ok: true, txHash: receipt.hash });
    } catch (err: any) {
        console.error("[vault/borrow] Error:", err);
        res.status(500).json({ error: err.message || "Transaction failed" });
    }
});

router.post("/repay", async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount) {
            res.status(400).json({ error: "amount required" });
            return;
        }
        const receipt = await repayToPool(amount);
        res.json({ ok: true, txHash: receipt.hash });
    } catch (err: any) {
        console.error("[vault/repay] Error:", err);
        res.status(500).json({ error: err.message || "Transaction failed" });
    }
});

export default router;
