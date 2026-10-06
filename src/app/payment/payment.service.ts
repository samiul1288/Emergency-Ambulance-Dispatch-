import { prisma } from "../../lib/prisma.js";
import { config } from "../../config/index.js";
import { ApiError } from "../../errors/ApiError.js";
import type { AuthenticatedUser } from "../../middlewares/auth.js";
import Stripe from "stripe";
import {
  DispatchStatus,
  PaymentStatus,
  RequestPriority,
} from "../../generated/prisma/enums.js";
import type { InitiatePaymentInput } from "./payment.validation.js";

/**
 * Shared Stripe client. The secret key is supplied by the validated
 * environment config, so it is guaranteed to be present at startup.
 */
export const stripe = new Stripe(config.STRIPE_SECRET_KEY);

type PaymentStatusValue = (typeof PaymentStatus)[keyof typeof PaymentStatus];
type DispatchStatusValue = (typeof DispatchStatus)[keyof typeof DispatchStatus];
type RequestPriorityValue =
  (typeof RequestPriority)[keyof typeof RequestPriority];

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

function currencyMinorUnitFactor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase()) ? 1 : 100;
}

export interface CheckoutDetails {
  paymentId: string;
  checkoutSessionId: string;
  checkoutUrl: string;
  amount: string;
  currency: string;
  expiresAt: Date | null;
}

export async function initiateCheckout(
  caller: AuthenticatedUser,
  input: InitiatePaymentInput,
): Promise<CheckoutDetails> {
  const account = await requireActiveCaller(caller.id);
  if (account.role !== "PATIENT" && account.role !== "ADMIN") {
    throw ApiError.forbidden(
      "Only patients or administrators can initiate payment",
    );
  }

  const dispatch = await prisma.dispatchRequest.findFirst({
    where: { id: input.dispatchRequestId, isDeleted: false },
    select: {
      id: true,
      patientId: true,
      status: true,
      completedAt: true,
      patient: { select: { email: true } },
      payment: {
        select: {
          id: true,
          status: true,
          isDeleted: true,
        },
      },
    },
  });

  if (!dispatch) {
    throw ApiError.notFound("Dispatch request not found", [
      { path: "dispatchRequestId", message: "No dispatch request was found" },
    ]);
  }
  if (account.role !== "ADMIN" && dispatch.patientId !== account.id) {
    throw ApiError.forbidden("You may only pay for your own dispatch requests");
  }
  if (dispatch.status !== DispatchStatus.COMPLETED) {
    throw ApiError.conflict(
      "Payment is available only after the trip is completed",
      [
        {
          path: "dispatchRequestId",
          message: `Dispatch is ${dispatch.status}`,
        },
      ],
    );
  }
  // The configured server-side fare is authoritative; clients cannot choose the charge.
  if (!config.DISPATCH_FARE_AMOUNT) {
    throw new ApiError(503, "Dispatch fare is not configured");
  }

  const amount = Number(config.DISPATCH_FARE_AMOUNT);
  const currency = config.DISPATCH_FARE_CURRENCY.toLowerCase();
  const minorUnitFactor = currencyMinorUnitFactor(currency);
  if (minorUnitFactor === 1 && !Number.isInteger(amount)) {
    throw new ApiError(
      503,
      "Configured fare must be a whole amount for this currency",
    );
  }
  const amountInMinorUnits = Math.round(amount * minorUnitFactor);
  if (!Number.isSafeInteger(amountInMinorUnits) || amountInMinorUnits < 1) {
    throw new ApiError(503, "Configured dispatch fare is invalid");
  }

  if (
    dispatch.payment &&
    !dispatch.payment.isDeleted &&
    dispatch.payment.status === PaymentStatus.PAID
  ) {
    throw ApiError.conflict("This dispatch has already been paid");
  }

  const paymentCurrency = currency.toUpperCase();
  const payment = await prisma.payment.upsert({
    where: { dispatchRequestId: dispatch.id },
    create: {
      dispatchRequestId: dispatch.id,
      amount: amount.toFixed(2),
      currency: paymentCurrency,
      status: PaymentStatus.PENDING,
      paymentMethod: "STRIPE",
    },
    update: {
      amount: amount.toFixed(2),
      currency: paymentCurrency,
      status: PaymentStatus.PENDING,
      paymentMethod: "STRIPE",
      transactionId: null,
      paidAt: null,
      failedAt: null,
      failureReason: null,
      isDeleted: false,
      deletedAt: null,
    },
    select: { id: true },
  });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: dispatch.patient.email,
    client_reference_id: payment.id,
    // Stripe returns these IDs in webhook events so they can be matched to this database payment.
    metadata: { paymentId: payment.id, dispatchRequestId: dispatch.id },
    payment_intent_data: {
      metadata: { paymentId: payment.id, dispatchRequestId: dispatch.id },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amountInMinorUnits,
          product_data: { name: `Ambulance dispatch ${dispatch.id}` },
        },
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });

  if (!session.url) {
    throw ApiError.internal("Stripe did not return a Checkout URL");
  }

  await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: PaymentStatus.PENDING,
      transactionId: null,
    },
    data: { transactionId: session.id },
  });

  return {
    paymentId: payment.id,
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
    amount: amount.toFixed(2),
    currency: paymentCurrency,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
  };
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const success =
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "payment_intent.succeeded";
  const failure =
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired" ||
    event.type === "payment_intent.payment_failed";
  if (!success && !failure) return;

  const stripeObject = event.data.object as
    | Stripe.Checkout.Session
    | Stripe.PaymentIntent;
  if (
    event.type === "checkout.session.completed" &&
    (stripeObject as Stripe.Checkout.Session).payment_status !== "paid"
  ) {
    return;
  }

  const paymentId = stripeObject.metadata?.paymentId;
  if (!paymentId) return;

  const providerReference = "id" in stripeObject ? stripeObject.id : null;
  const paymentIntent =
    "payment_intent" in stripeObject ? stripeObject.payment_intent : null;
  const paymentIntentId =
    typeof paymentIntent === "string"
      ? paymentIntent
      : paymentIntent && typeof paymentIntent === "object"
        ? paymentIntent.id
        : providerReference;
  let failureReason = "Payment failed";
  if (event.type === "payment_intent.payment_failed") {
    failureReason =
      (stripeObject as Stripe.PaymentIntent).last_payment_error?.message ??
      failureReason;
  } else if (event.type === "checkout.session.expired") {
    failureReason = "Checkout session expired";
  }

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, isDeleted: false },
      select: {
        id: true,
        status: true,
        transactionId: true,
        amount: true,
        currency: true,
        dispatchRequestId: true,
        dispatchRequest: { select: { status: true, completedAt: true } },
      },
    });
    if (!payment) return;

    let eventAmount: number | null;
    if ("amount_total" in stripeObject) {
      eventAmount = stripeObject.amount_total;
    } else {
      eventAmount = stripeObject.amount;
    }
    if (
      eventAmount !== null &&
      eventAmount !== undefined &&
      // Ignore events whose amount or currency does not match the stored checkout.
      (eventAmount !==
        Math.round(
          Number(payment.amount) * currencyMinorUnitFactor(payment.currency),
        ) ||
        ("currency" in stripeObject &&
          stripeObject.currency?.toLowerCase() !==
            payment.currency.toLowerCase()))
    ) {
      return;
    }

    if (
      failure &&
      event.type.startsWith("checkout.session.") &&
      payment.transactionId !== stripeObject.id
    ) {
      return;
    }

    if (success) {
      if (payment.status !== PaymentStatus.PAID) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.PAID,
            paymentMethod: "STRIPE",
            transactionId: paymentIntentId,
            paidAt: new Date(),
            failedAt: null,
            failureReason: null,
          },
        });
      }
      await tx.dispatchRequest.update({
        where: { id: payment.dispatchRequestId },
        data: {
          status: DispatchStatus.COMPLETED,
          completedAt: payment.dispatchRequest.completedAt ?? new Date(),
        },
      });
      return;
    }

    if (payment.status === PaymentStatus.PENDING) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          paymentMethod: "STRIPE",
          transactionId: providerReference,
          failedAt: new Date(),
          failureReason,
        },
      });
    }
  });
}

/**
 * Caller account must exist, be undeleted and be active. The role stored on
 * the user row — not the role carried by the access token — decides access,
 * so a revoked role takes effect immediately.
 */
async function requireActiveCaller(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, isDeleted: true },
  });

  if (!user || user.isDeleted) {
    throw ApiError.unauthorized("Account not found", [
      { path: "user", message: "User account not found" },
    ]);
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      "Your account has been deactivated. Please contact support.",
      [{ path: "account", message: "Account is deactivated" }],
    );
  }

  return user;
}

interface VerificationSource {
  status: PaymentStatusValue;
  transactionId: string | null;
  paidAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
}

export interface PaymentVerification {
  /** True only for a captured payment backed by a provider reference. */
  verified: boolean;
  status: PaymentStatusValue;
  /** When the provider confirmed capture (mirrors `paidAt`). */
  verifiedAt: Date | null;
  /** Provider-side transaction reference, when one was recorded. */
  providerReference: string | null;
  /** PAID rows without a reference need a human to reconcile them. */
  requiresManualReview: boolean;
  /** Human-readable explanation of the verification outcome. */
  reason: string;
}

/**
 * Derive the verification state from the stored payment fields — the schema
 * has no dedicated verification columns, so "verified" means
 * `status === PAID` together with a `transactionId` from the gateway.
 */
export function buildVerification(
  payment: VerificationSource,
): PaymentVerification {
  const base = {
    status: payment.status,
    verifiedAt: payment.paidAt,
    providerReference: payment.transactionId,
  };

  if (payment.status === PaymentStatus.PAID) {
    if (!payment.transactionId) {
      return {
        ...base,
        verified: false,
        requiresManualReview: true,
        reason:
          "Payment is marked PAID but has no provider reference; it must be reconciled manually",
      };
    }
    return {
      ...base,
      verified: true,
      requiresManualReview: false,
      reason: "Payment was captured and confirmed by the payment provider",
    };
  }

  if (payment.status === PaymentStatus.FAILED) {
    return {
      ...base,
      verified: false,
      verifiedAt: null,
      requiresManualReview: false,
      reason:
        payment.failureReason ?? "Payment attempt was declined by the provider",
    };
  }

  return {
    ...base,
    verified: false,
    verifiedAt: null,
    requiresManualReview: false,
    reason: "Payment has been requested but not collected yet",
  };
}

export interface PaymentDetails {
  id: string;
  /**
   * Decimal amount rendered as a 2-decimal fixed-point string
   * (e.g. 2500 -> "2500.00"), matching the `Decimal(10,2)` column.
   */
  amount: string;
  currency: string;
  status: PaymentStatusValue;
  paymentMethod: string | null;
  transactionId: string | null;
  paidAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  verification: PaymentVerification;
  dispatch: {
    id: string;
    status: DispatchStatusValue;
    priority: RequestPriorityValue;
    pickupAddress: string;
    dropoffAddress: string | null;
    patient: {
      id: string;
      name: string;
      email: string;
      phone: string;
    };
    driver: {
      id: string;
      name: string;
      phone: string;
      licenseNumber: string;
    } | null;
    ambulance: {
      id: string;
      vehicleNumber: string;
      type: string;
    } | null;
    timeline: {
      requestedAt: Date;
      dispatchedAt: Date | null;
      enRouteAt: Date | null;
      pickedUpAt: Date | null;
      completedAt: Date | null;
      cancelledAt: Date | null;
    };
  };
}

/**
 * Load one payment with its transaction context and verification status.
 *
 * Visible to the patient who raised the dispatch, the driver assigned to it,
 * and administrators; everyone else gets 403, and unknown (or soft-deleted)
 * payment ids get 404.
 */
export async function getPaymentDetails(
  caller: AuthenticatedUser,
  paymentId: string,
): Promise<PaymentDetails> {
  const account = await requireActiveCaller(caller.id);

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, isDeleted: false },
    include: {
      dispatchRequest: {
        select: {
          id: true,
          status: true,
          priority: true,
          patientId: true,
          pickupAddress: true,
          dropoffAddress: true,
          createdAt: true,
          dispatchedAt: true,
          enRouteAt: true,
          pickedUpAt: true,
          completedAt: true,
          cancelledAt: true,
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          driver: {
            select: {
              id: true,
              licenseNumber: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                },
              },
            },
          },
          ambulance: {
            select: { id: true, vehicleNumber: true, type: true },
          },
        },
      },
    },
  });

  if (!payment) {
    throw ApiError.notFound("Payment not found", [
      { path: "id", message: `No payment found for id ${paymentId}` },
    ]);
  }

  const request = payment.dispatchRequest;
  const isOwningPatient = request.patientId === account.id;
  const isAssignedDriver = request.driver?.user.id === account.id;

  if (account.role !== "ADMIN" && !isOwningPatient && !isAssignedDriver) {
    throw ApiError.forbidden(
      "You do not have permission to view this payment",
      [
        {
          path: "payment",
          message:
            "Caller is neither the patient, the assigned driver, nor an admin",
        },
      ],
    );
  }

  return {
    id: payment.id,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    status: payment.status,
    paymentMethod: payment.paymentMethod,
    transactionId: payment.transactionId,
    paidAt: payment.paidAt,
    failedAt: payment.failedAt,
    failureReason: payment.failureReason,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    verification: buildVerification(payment),
    dispatch: {
      id: request.id,
      status: request.status,
      priority: request.priority,
      pickupAddress: request.pickupAddress,
      dropoffAddress: request.dropoffAddress,
      patient: {
        id: request.patient.id,
        name: `${request.patient.firstName} ${request.patient.lastName}`,
        email: request.patient.email,
        phone: request.patient.phone,
      },
      driver: request.driver
        ? {
            id: request.driver.id,
            name: `${request.driver.user.firstName} ${request.driver.user.lastName}`,
            phone: request.driver.user.phone,
            licenseNumber: request.driver.licenseNumber,
          }
        : null,
      ambulance: request.ambulance
        ? {
            id: request.ambulance.id,
            vehicleNumber: request.ambulance.vehicleNumber,
            type: request.ambulance.type,
          }
        : null,
      timeline: {
        requestedAt: request.createdAt,
        dispatchedAt: request.dispatchedAt,
        enRouteAt: request.enRouteAt,
        pickedUpAt: request.pickedUpAt,
        completedAt: request.completedAt,
        cancelledAt: request.cancelledAt,
      },
    },
  };
}
