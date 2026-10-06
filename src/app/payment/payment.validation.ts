import { z } from "zod";

/**
 * Route params for a single payment resource.
 * Payment ids are UUIDs minted by Prisma, so anything else is rejected
 * before it reaches the database.
 */
export const paymentIdParamSchema = z.object({
  id: z.string().trim().uuid("Payment id must be a valid UUID"),
});

const returnUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Return URL must use HTTP or HTTPS");

export const initiatePaymentSchema = z.object({
  dispatchRequestId: z
    .string()
    .trim()
    .uuid("Dispatch request id must be a valid UUID"),
  successUrl: returnUrlSchema,
  cancelUrl: returnUrlSchema,
});

export type PaymentIdParams = z.infer<typeof paymentIdParamSchema>;
export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;
