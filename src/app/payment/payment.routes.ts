import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import {
  getPayment,
  initiatePayment,
  stripeWebhook,
} from "./payment.controller.js";
import {
  initiatePaymentSchema,
  paymentIdParamSchema,
} from "./payment.validation.js";

const paymentRouter: Router = Router();

paymentRouter.post(
  "/initiate",
  auth("PATIENT", "ADMIN"),
  validateRequest({ body: initiatePaymentSchema }),
  initiatePayment,
);

paymentRouter.post("/webhook", stripeWebhook);

paymentRouter.get(
  "/:id",
  auth(),
  validateRequest({ params: paymentIdParamSchema }),
  getPayment,
);

export default paymentRouter;
