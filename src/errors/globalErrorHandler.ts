import type { ErrorRequestHandler } from "express";
import { isProduction } from "../config/index.js";
import { ApiError, type ApiErrorDetail } from "./ApiError.js";
import { handleZodError, isZodError } from "./handleZodError.js";

interface HttpError extends Error {
  statusCode?: number;
  status?: number;
  errors?: unknown;
  details?: unknown;
  code?: string;
  body?: unknown;
}

type ErrorItem = Record<string, unknown> | string;

const toErrorArray = (value: unknown): ErrorItem[] => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value as ErrorItem[];
  return [value as ErrorItem];
};

function normalizeStatusCode(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 400 &&
    value < 600
    ? value
    : 500;
}

/** Map well-known Prisma request errors onto API-friendly statuses. */
function fromPrismaError(err: HttpError): ApiError | null {
  if (err.name !== "PrismaClientKnownRequestError" || !err.code) {
    return null;
  }
  switch (err.code) {
    case "P2002": {
      const target = (err as { meta?: { target?: unknown } }).meta?.target;
      const fields = Array.isArray(target) ? target.join(", ") : String(target ?? "field");
      return ApiError.conflict("A record with this value already exists", [
        { path: fields, message: `Unique constraint failed on ${fields}` },
      ]);
    }
    case "P2025":
      return ApiError.notFound("The requested record was not found");
    case "P2003":
      return ApiError.conflict("Related record constraint failed");
    default:
      return null;
  }
}

function fromJsonWebTokenError(err: HttpError): ApiError | null {
  if (err.name === "TokenExpiredError") {
    return ApiError.unauthorized("Token has expired");
  }
  if (err.name === "JsonWebTokenError" || err.name === "NotBeforeError") {
    return ApiError.unauthorized("Invalid token");
  }
  return null;
}

/** Normalize anything thrown in the app into a single `ApiError`. */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isZodError(error)) {
    const formatted = handleZodError(error);
    return new ApiError(formatted.statusCode, formatted.message, formatted.errors);
  }

  const err = (error ?? new Error("Internal server error")) as HttpError;

  const prismaError = fromPrismaError(err);
  if (prismaError) return prismaError;

  const jwtError = fromJsonWebTokenError(err);
  if (jwtError) return jwtError;

  // Malformed JSON body rejected by express.json() (body-parser).
  if (err instanceof SyntaxError && "body" in err) {
    return ApiError.badRequest("Invalid JSON payload");
  }

  const statusCode = normalizeStatusCode(err.statusCode ?? err.status);
  const message = err.message || "Internal server error";
  const errors = toErrorArray(err.errors ?? err.details) as ApiErrorDetail[];
  return new ApiError(statusCode, message, errors);
}

/**
 * Global error handling middleware.
 * Always responds with the standard structure: { success, message, errors }
 * Must be registered AFTER all routes (and after the 404 handler).
 */
export const globalErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next,
) => {
  const apiError = toApiError(error);
  const statusCode = apiError.statusCode;

  if (statusCode >= 500) {
    console.error(error);
  }

  const hideDetails = statusCode >= 500 && isProduction;

  res.status(statusCode).json({
    success: false,
    message: hideDetails ? "Internal server error" : apiError.message,
    errors: hideDetails ? [] : apiError.errors,
  });
};
