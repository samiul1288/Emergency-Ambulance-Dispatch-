import { z } from "zod";

const nameSchema = (field: string): z.ZodString =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(50, `${field} must be at most 50 characters`);

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{7,20}$/, "Invalid phone number");

/**
 * Self-service profile update. Email and role are intentionally immutable
 * here — email changes need re-verification and roles are managed by admins.
 * At least one mutable field must be present.
 */
export const updateProfileSchema = z
  .object({
    firstName: nameSchema("First name").optional(),
    lastName: nameSchema("Last name").optional(),
    phone: phoneSchema.optional(),
  })
  .refine(
    (data) =>
      data.firstName !== undefined ||
      data.lastName !== undefined ||
      data.phone !== undefined,
    {
      message:
        "Provide at least one field to update: firstName, lastName or phone",
      path: [],
    },
  );

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

