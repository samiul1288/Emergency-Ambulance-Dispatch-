import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(254, "Email must be at most 254 characters")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address")
  .transform((value) => value.toLowerCase());

const phoneSchema = z
  .string()
  .trim()
  .min(1, "Phone number is required")
  .regex(/^\+?[0-9\s-]{7,20}$/, "Invalid phone number");

const nameSchema = (field: string): z.ZodString =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(50, `${field} must be at most 50 characters`);

/**
 * Patient / Driver self-registration.
 * ADMIN accounts cannot be created through this endpoint —
 * they are provisioned via seeding or by an existing admin.
 */
export const registerSchema = z.object({
  firstName: nameSchema("First name"),
  lastName: nameSchema("Last name"),
  email: emailSchema,
  phone: phoneSchema,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
  role: z.enum(["PATIENT", "DRIVER"]).default("PATIENT"),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

/**
 * Refresh-token rotation. Accepts the token either in the JSON body
 * or — preferably — via the `httpOnly` `refreshToken` cookie set at
 * login/register. Body takes precedence when both are present.
 */
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required").optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

