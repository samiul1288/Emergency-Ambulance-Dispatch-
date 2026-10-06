import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  STRIPE_SECRET_KEY: z
    .string()
    .startsWith("sk_", 'STRIPE_SECRET_KEY must start with "sk_"'),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .startsWith("whsec_", 'STRIPE_WEBHOOK_SECRET must start with "whsec_"')
    .optional(),
  DISPATCH_FARE_AMOUNT: z
    .string()
    .regex(
      /^\d+(\.\d{1,2})?$/,
      "DISPATCH_FARE_AMOUNT must have at most 2 decimals",
    )
    .optional(),
  DISPATCH_FARE_CURRENCY: z
    .string()
    .regex(/^[a-zA-Z]{3}$/, "DISPATCH_FARE_CURRENCY must be a 3-letter code")
    .default("USD"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(31).default(12),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  console.error(`Invalid environment variables:\n${details}`);
  process.exit(1);
}

if (parsed.data.JWT_SECRET === parsed.data.JWT_REFRESH_SECRET) {
  console.error(
    "Invalid environment variables:\n  - JWT_SECRET and JWT_REFRESH_SECRET must differ",
  );
  process.exit(1);
}

export type Config = z.infer<typeof envSchema>;

export const config: Readonly<Config> = Object.freeze(parsed.data);
export const isProduction = config.NODE_ENV === "production";
