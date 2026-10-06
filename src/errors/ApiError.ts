/**
 * Custom application error carrying an HTTP status code and structured details.
 *
 * Understood by `globalErrorHandler`, which renders it as:
 * { success: false, message, errors }
 */

export interface ApiErrorDetail {
  path?: string;
  message: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errors: ApiErrorDetail[];
  public readonly isOperational: boolean;

  constructor(
    statusCode = 500,
    message = "Something went wrong",
    errors: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(
    message = "Bad request",
    errors: ApiErrorDetail[] = [],
  ): ApiError {
    return new ApiError(400, message, errors);
  }

  static unauthorized(
    message = "Unauthorized",
    errors: ApiErrorDetail[] = [],
  ): ApiError {
    return new ApiError(401, message, errors);
  }

  static forbidden(
    message = "Forbidden",
    errors: ApiErrorDetail[] = [],
  ): ApiError {
    return new ApiError(403, message, errors);
  }

  static notFound(
    message = "Resource not found",
    errors: ApiErrorDetail[] = [],
  ): ApiError {
    return new ApiError(404, message, errors);
  }

  static conflict(
    message = "Resource already exists",
    errors: ApiErrorDetail[] = [],
  ): ApiError {
    return new ApiError(409, message, errors);
  }

  static unprocessableEntity(
    message = "Validation failed",
    errors: ApiErrorDetail[] = [],
  ): ApiError {
    return new ApiError(422, message, errors);
  }

  static tooManyRequests(
    message = "Too many requests, please try again later.",
    errors: ApiErrorDetail[] = [],
  ): ApiError {
    return new ApiError(429, message, errors);
  }

  static internal(
    message = "Internal server error",
    errors: ApiErrorDetail[] = [],
  ): ApiError {
    return new ApiError(500, message, errors);
  }
}
