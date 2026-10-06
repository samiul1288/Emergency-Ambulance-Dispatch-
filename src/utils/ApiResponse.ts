import type { Response } from "express";

/**
 * Standard success envelope for every 2xx JSON response:
 * { success: true, message, data, meta? }
 *
 * (Error responses use { success: false, message, errors }
 * via `notFound` / `globalErrorHandler` / `ApiError`.)
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type ResponseMeta = PaginationMeta | Record<string, unknown>;

export interface ApiSuccessBody<T> {
  success: true;
  message: string;
  data: T;
  meta?: ResponseMeta;
}

export interface SendResponseOptions<T> {
  statusCode?: number;
  message?: string;
  data?: T;
  meta?: ResponseMeta;
}

/**
 * Send a uniform success response.
 *
 * @example
 * return sendResponse(res, { statusCode: 200, message: "Driver found", data: driver });
 */
export function sendResponse<T>(
  res: Response,
  options: SendResponseOptions<T> = {},
): Response {
  const { statusCode = 200, message = "Success", meta } = options;
  const data = ("data" in options ? options.data : null) as T;
  const body: ApiSuccessBody<T> = { success: true, message, data };
  if (meta !== undefined) {
    body.meta = meta;
  }
  return res.status(statusCode).json(body);
}

/**
 * Shortcut for `201 Created` responses.
 */
export function sendCreated<T>(
  res: Response,
  data: T,
  message = "Resource created successfully",
  meta?: ResponseMeta,
): Response {
  return sendResponse<T>(res, { statusCode: 201, message, data, meta });
}

