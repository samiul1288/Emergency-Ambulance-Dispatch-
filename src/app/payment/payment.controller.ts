import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../errors/ApiError.js";
import { sendResponse } from "../../utils/ApiResponse.js";
import type { AuthenticatedUser } from "../../middlewares/auth.js";
import { config } from "../../config/index.js";
import {
  getPaymentDetails,
  handleStripeEvent,
  initiateCheckout,
  stripe,
} from "./payment.service.js";
import type {
  InitiatePaymentInput,
  PaymentIdParams,
} from "./payment.validation.js";

function requireCaller(req: Request): AuthenticatedUser {
  const caller = req.user;
  if (!caller) {
    throw ApiError.unauthorized("Authentication is required", [
      { path: "user", message: "Authenticated user context is missing" },
    ]);
  }
  return caller;
}

/** POST /api/v1/payments/initiate */
export async function initiatePayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const checkout = await initiateCheckout(
      requireCaller(req),
      req.body as InitiatePaymentInput,
    );
    sendResponse(res, {
      statusCode: 201,
      message: "Checkout session created successfully",
      data: checkout,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/payments/webhook */
export async function stripeWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!config.STRIPE_WEBHOOK_SECRET) {
      res.status(503).json({
        success: false,
        message: "Stripe webhook is not configured",
        errors: [],
      });
      return;
    }

    const signature = req.headers["stripe-signature"];
    const rawBody = Buffer.isBuffer(req.body) ? req.body : undefined;
    if (typeof signature !== "string" || !rawBody) {
      res.status(400).json({
        success: false,
        message: "A valid Stripe signature and request body are required",
        errors: [],
      });
      return;
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        config.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      res.status(400).json({
        success: false,
        message: "Invalid Stripe webhook signature",
        errors: [],
      });
      return;
    }

    await handleStripeEvent(event);
    sendResponse(res, {
      statusCode: 200,
      message: "Webhook received",
      data: { received: true },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/payments/:id */
export async function getPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params as unknown as PaymentIdParams;
    const payment = await getPaymentDetails(requireCaller(req), id);
    sendResponse(res, {
      statusCode: 200,
      message: "Payment details retrieved successfully",
      data: payment,
    });
  } catch (err) {
    next(err);
  }
}
