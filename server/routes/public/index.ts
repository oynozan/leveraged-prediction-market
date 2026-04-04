import { Router } from "express";

/* Routes */
import Ping from "./ping";
import Health from "./health";
import Markets from "./markets";
import Positions from "./positions";
import Deposit from "./deposit";
import Trade from "./trade";

const router = Router();

router.use("/ping", Ping);
router.use("/health", Health);
router.use("/markets", Markets);
router.use("/positions", Positions);
router.use("/deposit", Deposit);
router.use("/trade", Trade);

export default router;
