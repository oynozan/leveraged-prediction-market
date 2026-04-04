import { Router } from "express";

/* Routes */
import Ping from "./ping";
import Markets from "./markets";
import Contracts from "./contracts";

const router = Router();

router.use("/ping", Ping);
router.use("/markets", Markets);
router.use("/contracts", Contracts);

export default router;
