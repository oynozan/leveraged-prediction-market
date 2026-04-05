import { Router } from "express";
import { reconcileAll, reconcileWallet } from "../../../services/recovery";
import Position from "../../../models/Positions";

const router = Router();

router.post("/reconcile", async (_req, res) => {
    try {
        const result = await reconcileAll();
        res.json(result);
    } catch (err: any) {
        console.error("[recovery] reconcile route error:", err);
        res.status(500).json({ error: err.message || "Reconciliation failed" });
    }
});

router.post("/reconcile/:wallet", async (req, res) => {
    try {
        const result = await reconcileWallet(req.params.wallet);
        res.json(result);
    } catch (err: any) {
        console.error("[recovery] reconcile wallet route error:", err);
        res.status(500).json({ error: err.message || "Wallet reconciliation failed" });
    }
});

router.get("/positions", async (_req, res) => {
    try {
        const allWallets: string[] = await Position.distinct("wallet");
        const openPositions = await Position.find({ status: "open" }).lean();

        const byWallet: Record<string, { wallet: string; totalLockedMargin: number; positions: typeof openPositions }> = {};

        for (const w of allWallets) {
            byWallet[w] = { wallet: w, totalLockedMargin: 0, positions: [] };
        }

        for (const pos of openPositions) {
            if (!byWallet[pos.wallet]) {
                byWallet[pos.wallet] = { wallet: pos.wallet, totalLockedMargin: 0, positions: [] };
            }
            byWallet[pos.wallet].totalLockedMargin += pos.marginAmount;
            byWallet[pos.wallet].positions.push(pos);
        }

        res.json({ wallets: Object.values(byWallet), totalPositions: openPositions.length });
    } catch (err: any) {
        console.error("[recovery] positions route error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch positions" });
    }
});

router.get("/stale-borrows", async (_req, res) => {
    try {
        const positions = await Position.find({
            status: "closed",
            borrowedAmount: { $gt: 0 },
            settled: { $ne: true },
        }).lean();

        const byCondition: Record<string, { conditionId: string; totalBorrowed: number; positionIds: string[] }> = {};
        for (const pos of positions) {
            const cid = pos.conditionId;
            if (!byCondition[cid]) {
                byCondition[cid] = { conditionId: cid, totalBorrowed: 0, positionIds: [] };
            }
            byCondition[cid].totalBorrowed += pos.borrowedAmount;
            byCondition[cid].positionIds.push(String(pos._id));
        }

        res.json({ borrows: Object.values(byCondition), totalPositions: positions.length });
    } catch (err: any) {
        console.error("[recovery] stale-borrows route error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch stale borrows" });
    }
});

export default router;
