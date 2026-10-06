import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { validateRequest } from "../../middlewares/validateRequest.js";
import { login, refreshToken, register } from "./auth.controller.js";
import {
  loginSchema,
  refreshTokenSchema,
  registerSchema,
} from "./auth.validation.js";

const authRouter: Router = Router();

// Stricter brute-force protection for auth endpoints (on top of the
// global limiter), rendered in the standard { success, message, errors } shape.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      message: "Too many authentication attempts, please try again later.",
      errors: [],
    });
  },
});

authRouter.post(
  "/register",
  authLimiter,
  validateRequest({ body: registerSchema }),
  register,
);

authRouter.post(
  "/login",
  authLimiter,
  validateRequest({ body: loginSchema }),
  login,
);

authRouter.post(
  "/refresh-token",
  authLimiter,
  validateRequest({ body: refreshTokenSchema }),
  refreshToken,
);

export default authRouter;

