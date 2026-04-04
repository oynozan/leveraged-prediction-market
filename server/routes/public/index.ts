import { Router } from "express";

/* Routes */
import Ping from "./ping";
import Health from "./health";
import Markets from "./markets";
import Positions from "./positions";

const router = Router();

router.use("/ping", Ping);
router.use("/health", Health);
router.use("/markets", Markets);
router.use("/positions", Positions);

export default router;
