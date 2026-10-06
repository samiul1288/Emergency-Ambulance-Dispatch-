import express from "express";
import cors from "cors";
import * as helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { config, isProduction } from "./config/index.js";
import { notFound } from "./middlewares/notFound.js";
import { globalErrorHandler } from "./errors/globalErrorHandler.js";
import router from "./app/routes/index.js";

const app = express();

// Required when running behind a load balancer / reverse proxy so that
// rate limiting and req.ip use the real client IP.
if (isProduction) {
  app.set("trust proxy", 1);
}
app.disable("x-powered-by");

// Security headers
app.use(helmet.default());

// CORS — allow the frontend origin(s), credentials for cookie-based auth
const allowedOrigins = process.env.FRONTEND_URL?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  }),
);

// Body parsers + cookies
// Keep Stripe's webhook body raw so its signature can be verified exactly as sent.
app.use(
  "/api/v1/payments/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
);
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());

// Health check (used by load balancers / uptime monitors, kept before rate limiter)
app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Emergency Ambulance Dispatch API",
    data: { version: "v1", health: "/health" },
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    uptime: process.uptime(),
    env: config.NODE_ENV,
  });
});

// Global rate limiting — standard { success, message, errors } shape on 429
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message: "Too many requests, please try again later.",
        errors: [],
      });
    },
  }),
);

// Feature routers — mounted once under /api/v1 via src/app/routes/index.ts
app.use("/api/v1", router);

// 404 for unmatched routes (standard response structure)
app.use(notFound);

// Global error handler — must be last (standard response structure)
app.use(globalErrorHandler);

export default app;
