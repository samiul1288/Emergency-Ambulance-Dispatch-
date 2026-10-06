import { ZodError } from "zod";
import type { ApiErrorDetail } from "./ApiError.js";

/**
 * Normalized shape produced from a raw `ZodError` so it can be rendered
 * by the global error handler as:
 * { success: false, message, errors }
 */
export interface FormattedZodError {
  statusCode: number;
  message: string;
  errors: ApiErrorDetail[];
}

/**
 * Type guard that recognizes Zod validation failures, even when the
 * `ZodError` crosses a module boundary (so `instanceof` would be unsafe).
 */
export function isZodError(error: unknown): error is ZodError {
  if (error instanceof ZodError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "ZodError" &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

/**
 * Convert a `ZodError` into the API's standard error contract.
 * Every issue becomes `{ path, message, code }`.
 */
export function handleZodError(error: ZodError): FormattedZodError {
  const errors: ApiErrorDetail[] = error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
    code: issue.code,
  }));

  return { statusCode: 422, message: "Validation failed", errors };
}

