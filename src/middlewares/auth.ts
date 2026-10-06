import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "../generated/prisma/enums.js";
import { ApiError } from "../errors/ApiError.js";
import { verifyAccessToken, type AuthTokenPayload } from "../utils/jwt.js";

/**
 * `jsonwebtoken` is CommonJS — under Node's ESM loader only its default
 * export is available, so the error classes are read off the default
 * import (runtime named imports throw `SyntaxError` at startup).
 */
const { JsonWebTokenError, TokenExpiredError } = jwt;

/**
 * Authenticated caller extracted from a verified access token
 * and attached to `req.user` by the `auth` middleware.
 */
export interface AuthenticatedUser {
  id: string;
  role: (typeof UserRole)[keyof typeof UserRole];
  issuedAt?: number;
  expiresAt?: number;
}

/** Roles accepted by the `auth` RBAC guard. */
export type AuthorizedRole = AuthenticatedUser["role"];

// `req.user` is augmented globally in `src/@types/express.d.ts`.

const VALID_ROLES: ReadonlySet<string> = new Set(Object.values(UserRole));

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header) {
    throw ApiError.unauthorized("Authorization header is missing", [
      { path: "authorization", message: "Authorization header is required" },
    ]);
  }
  const parts = header.split(" ");
  const scheme = parts[0];
  const token = parts[1];
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    throw ApiError.unauthorized(
      "Authorization header must be in the format: Bearer <token>",
      [
        {
          path: "authorization",
          message: "Expected 'Bearer <token>'",
        },
      ],
    );
  }
  return token;
}

function toAuthenticatedUser(payload: AuthTokenPayload): AuthenticatedUser {
  if (!payload.sub || typeof payload.sub !== "string") {
    throw ApiError.unauthorized("Invalid access token: missing subject", [
      { path: "sub", message: "Token subject (user id) is missing" },
    ]);
  }
  if (typeof payload.role !== "string" || !VALID_ROLES.has(payload.role)) {
    throw ApiError.unauthorized("Invalid access token: unknown role", [
      { path: "role", message: "Token role is not a recognized user role" },
    ]);
  }
  return {
    id: payload.sub,
    role: payload.role as AuthorizedRole,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

/**
 * Verify the Bearer access token, attach the caller to `req.user`,
 * and optionally enforce role-based access control.
 *
 * @example
 * // Any authenticated user
 * router.get("/me", auth(), getMe);
 *
 * @example
 * // Drivers and admins only
 * router.patch("/dispatch/:id", auth("DRIVER", "ADMIN"), updateDispatch);
 */
export function auth(...allowedRoles: AuthorizedRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const payload = verifyAccessToken(extractBearerToken(req));
      const user = toAuthenticatedUser(payload);
      if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
        throw ApiError.forbidden(
          "You do not have permission to access this resource",
          [
            {
              path: "role",
              message: `Requires one of the following roles: ${allowedRoles.join(", ")}`,
            },
          ],
        );
      }
      req.user = user;
      next();
    } catch (err) {
      if (err instanceof ApiError) {
        next(err);
        return;
      }
      if (err instanceof TokenExpiredError) {
        next(
          ApiError.unauthorized("Access token has expired", [
            { path: "token", message: "Access token has expired" },
          ]),
        );
        return;
      }
      if (err instanceof JsonWebTokenError) {
        next(
          ApiError.unauthorized("Invalid access token", [
            { path: "token", message: "Access token is malformed or invalid" },
          ]),
        );
        return;
      }
      next(err);
    }
  };
}

/**
 * Alias for `auth()` — requires a valid token but no specific role.
 */
export const requireAuth: RequestHandler = auth();
