import { createHash } from "node:crypto";
import type { UserRole } from "../../generated/prisma/enums.js";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../errors/ApiError.js";
import {
  signTokenPair,
  verifyRefreshToken,
} from "../../utils/jwt.js";
import { comparePassword, hashPassword } from "../../utils/password.js";
import type { LoginInput, RegisterInput } from "./auth.validation.js";

/** Public user fields — never includes the password hash. */
export interface SafeUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
}

const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Register a new PATIENT or DRIVER account.
 * Hashes the password with bcrypt and issues a JWT pair.
 */
export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findFirst({
    where: {
      isDeleted: false,
      OR: [{ email: input.email }, { phone: input.phone }],
    },
    select: { id: true },
  });

  if (existing) {
    throw ApiError.conflict(
      "An account with this email or phone number already exists",
      [
        {
          path: "email",
          message: "An account with this email or phone number already exists",
        },
      ],
    );
  }

  const hashedPassword = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      password: hashedPassword,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      role: input.role,
    },
    select: safeUserSelect,
  });

  const { accessToken, refreshToken } = signTokenPair({
    sub: user.id,
    role: user.role,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash: hashToken(refreshToken) },
  });

  return { user, accessToken, refreshToken };
}

/**
 * Authenticate with email + password and issue a fresh JWT pair.
 * Uses generic failure messages to avoid user enumeration.
 */
export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...safeUserSelect, password: true, isDeleted: true },
  });

  if (!user || user.isDeleted) {
    throw ApiError.unauthorized("Invalid email or password", [
      { path: "email", message: "Invalid email or password" },
    ]);
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      "Your account has been deactivated. Please contact support.",
      [{ path: "account", message: "Account is deactivated" }],
    );
  }

  const passwordMatches = await comparePassword(input.password, user.password);

  if (!passwordMatches) {
    throw ApiError.unauthorized("Invalid email or password", [
      { path: "password", message: "Invalid email or password" },
    ]);
  }

  const { accessToken, refreshToken } = signTokenPair({
    sub: user.id,
    role: user.role,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash: hashToken(refreshToken) },
  });

  const { password: _omitted, isDeleted: _deleted, ...safeUser } = user;

  return { user: safeUser, accessToken, refreshToken };
}

export interface RefreshTokenInput {
  /** Raw refresh token from the `refreshToken` cookie or request body. */
  refreshToken?: string;
}

/** SHA-256 hash of a refresh token — only hashes are persisted, never raw tokens. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Rotate a refresh token: verify it, ensure it matches the stored hash
 * (reuse detection), then issue a fresh pair and persist the new hash.
 *
 * Security properties:
 * - Raw refresh tokens are never stored — only their SHA-256 hash.
 * - Each token carries a unique `jti`; rotation replaces the stored hash,
 *   so presenting an already-rotated (reused) token is rejected and the
 *   leaked lineage is revoked (client must log in again).
 * - Deactivated / soft-deleted users and role changes are re-checked
 *   against the database on every rotation.
 */
export async function refreshTokens(
  input: RefreshTokenInput,
): Promise<AuthResult> {
  const { refreshToken } = input;

  if (!refreshToken) {
    throw ApiError.unauthorized("Refresh token is missing", [
      { path: "refreshToken", message: "Refresh token is required" },
    ]);
  }

  let payload: { sub: string; role: string; jti?: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token", [
      { path: "refreshToken", message: "Refresh token is invalid or expired" },
    ]);
  }

  if (!payload.sub || typeof payload.sub !== "string" || !payload.jti) {
    throw ApiError.unauthorized("Invalid refresh token", [
      { path: "refreshToken", message: "Refresh token payload is invalid" },
    ]);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { ...safeUserSelect, isDeleted: true, refreshTokenHash: true },
  });

  // No user, soft-deleted, or no stored lineage → cannot rotate.
  if (!user || user.isDeleted || !user.refreshTokenHash) {
    throw ApiError.unauthorized("Invalid or expired refresh token", [
      { path: "refreshToken", message: "Refresh token is invalid or expired" },
    ]);
  }

  const presentedHash = hashToken(refreshToken);

  // Token reuse detected (already rotated or forged): revoke the lineage
  // so the compromised chain cannot be used again.
  if (presentedHash !== user.refreshTokenHash) {
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: null },
    });
    throw ApiError.unauthorized("Invalid or expired refresh token", [
      { path: "refreshToken", message: "Refresh token is invalid or expired" },
    ]);
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      "Your account has been deactivated. Please contact support.",
      [{ path: "account", message: "Account is deactivated" }],
    );
  }

  const { accessToken, refreshToken: newRefreshToken } = signTokenPair({
    sub: user.id,
    role: user.role,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash: hashToken(newRefreshToken) },
  });

  const { isDeleted: _deleted, refreshTokenHash: _hash, ...safeUser } = user;

  return { user: safeUser, accessToken, refreshToken: newRefreshToken };
}

