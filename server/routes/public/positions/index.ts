import { Router } from "express";
import { authRequired } from "../../middleware";
import Position from "../../../models/Positions";

const router = Router();

router.get("/", authRequired, async (req, res) => {
    try {
        const user = req.user as import("mongoose").Document;
        const positions = await Position.find(
            { user: user._id, status: "open" },
        ).lean();

        res.json(positions);
    } catch (err) {
        console.error("[positions] Error fetching positions:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
