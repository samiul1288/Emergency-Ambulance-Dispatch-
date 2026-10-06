import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, ZodType } from "zod";
import { ApiError } from "../errors/ApiError.js";
import { handleZodError } from "../errors/handleZodError.js";

/**
 * Schemas for the request parts to validate. Only the parts provided
 * are validated; each validated part is replaced with its parsed
 * (coerced / defaulted / stripped) value before `next()`.
 */
export interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

type RequestPart = keyof RequestSchemas;

function assignParsed(req: Request, part: RequestPart, value: unknown): void {
  try {
    (req as unknown as Record<string, unknown>)[part] = value;
  } catch {
    // Express 5 exposes some request properties (e.g. `query`) as getters —
    // fall back to redefining the property on the instance.
    Object.defineProperty(req, part, {
      value,
      writable: true,
      configurable: true,
    });
  }
}

function resolveParts(schemas: ZodType | RequestSchemas): Array<[RequestPart, ZodType]> {
  const parts: RequestSchemas =
    schemas instanceof ZodType ? { body: schemas } : schemas;
  const entries = Object.entries(parts) as Array<[RequestPart, ZodType | undefined]>;
  return entries.filter(
    (entry): entry is [RequestPart, ZodType] => entry[1] !== undefined,
  );
}

/**
 * Validate `body` / `query` / `params` against Zod schemas.
 *
 * Validation failures are forwarded as `ApiError(422)` so the global
 * error handler renders the standard `{ success, message, errors }` shape.
 *
 * @example
 * router.post("/login", validateRequest({ body: loginSchema }), login);
 */
export function validateRequest(schemas: ZodType | RequestSchemas): RequestHandler {
  const parts = resolveParts(schemas);
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      for (const [part, schema] of parts) {
        const source =
          part === "body" ? req.body : part === "query" ? req.query : req.params;
        assignParsed(req, part, schema.parse(source));
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const { statusCode, message, errors } = handleZodError(err);
        next(new ApiError(statusCode, message, errors));
        return;
      }
      next(err);
    }
  };
}

/**
 * Shortcut for validating only `req.body`.
 */
export function validateBody(schema: ZodType): RequestHandler {
  return validateRequest({ body: schema });
}

