import jwt, { type SignOptions, type JwtPayload } from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { config } from "../config/index.js";

/**
 * Payload carried by our access / refresh tokens.
 * `sub` is the user id, `role` gates role-based access control.
 * Refresh tokens also carry a `jti` so each rotation can be
 * bound to (and invalidate) the exact token it replaces.
 */
export interface AuthTokenPayload extends JwtPayload {
  sub: string;
  role: string;
  /** Refresh-token lineage id — present on refresh tokens only. */
  jti?: string;
}

type SignablePayload = Omit<AuthTokenPayload, "iat" | "exp" | "nbf">;

const ACCESS_SECRET = config.JWT_SECRET;
const REFRESH_SECRET = config.JWT_REFRESH_SECRET;

/**
 * Sign a short-lived access token.
 */
export function signAccessToken(
  payload: SignablePayload,
  expiresIn: SignOptions["expiresIn"] = config.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn });
}

/**
 * Sign a long-lived refresh token (store/rotate server-side as needed).
 * Each token gets a unique `jti` so a rotation can invalidate exactly
 * the token it replaces (reuse detection).
 */
export function signRefreshToken(
  payload: Omit<SignablePayload, "jti">,
  expiresIn: SignOptions["expiresIn"] = config.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"],
): string {
  return jwt.sign({ ...payload, jti: randomUUID() }, REFRESH_SECRET, {
    expiresIn,
  });
}

/**
 * Sign both tokens at once for login / refresh flows.
 * Strips `jti` before signing the access token — each refresh
 * token gets its own fresh `jti` inside `signRefreshToken`.
 */
export function signTokenPair(payload: Omit<SignablePayload, "jti">): {
  accessToken: string;
  refreshToken: string;
} {
  const { jti: _ignored, ...basePayload } = payload;
  void _ignored;
  return {
    accessToken: signAccessToken(basePayload),
    refreshToken: signRefreshToken(basePayload),
  };
}

/**
 * Verify an access token. Throws `JsonWebTokenError` / `TokenExpiredError`
 * on invalid / expired tokens — let `globalErrorHandler` map them.
 */
export function verifyAccessToken(token: string): AuthTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AuthTokenPayload;
}

/** Verify a refresh token. Throws on invalid / expired tokens. */
export function verifyRefreshToken(token: string): AuthTokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as AuthTokenPayload;
}

/** Decode without verification (e.g. for logging `sub` on failures). */
export function decodeToken(token: string): AuthTokenPayload | null {
  const decoded = jwt.decode(token);
  if (decoded === null || typeof decoded === "string") {
    return null;
  }
  return decoded as AuthTokenPayload;
}

