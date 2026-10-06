import { Router } from "express";
import adminRouter from "../admin/admin.routes.js";
import authRouter from "../auth/auth.routes.js";
import dispatchRouter from "../dispatch/dispatch.routes.js";
import driverRouter from "../driver/driver.routes.js";
import paymentRouter from "../payment/payment.routes.js";
import userRouter from "../user/user.routes.js";

/**
 * Root API router — mounted once in `app.ts` under `/api/v1`.
 * Every feature router below is therefore prefixed with `/api/v1`.
 */
const router: Router = Router();

router.use("/auth", authRouter);
router.use("/users", userRouter);
router.use("/drivers", driverRouter);
router.use("/dispatch", dispatchRouter);
router.use("/payments", paymentRouter);
router.use("/admin", adminRouter);

export default router;

