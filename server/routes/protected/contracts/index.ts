import { Router } from "express";

import pool from "./pool";
import vault from "./vault";
import netting from "./netting";
import swap from "./swap";

const router = Router();

router.use("/pool", pool);
router.use("/vault", vault);
router.use("/netting", netting);
router.use("/swap", swap);

export default router;
