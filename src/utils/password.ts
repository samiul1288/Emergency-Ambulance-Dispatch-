import bcrypt from "bcrypt";
import { config } from "../config/index.js";

const SALT_ROUNDS = config.BCRYPT_SALT_ROUNDS;

/**
 * Hash a plaintext password with bcrypt.
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  if (!plainPassword) {
    throw new Error("Password must not be empty");
  }
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Compare a plaintext password against a stored bcrypt hash.
 * Uses a timing-safe comparison internally and never throws on mismatch.
 */
export async function comparePassword(
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> {
  if (!plainPassword || !hashedPassword) {
    return false;
  }
  try {
    return await bcrypt.compare(plainPassword, hashedPassword);
  } catch {
    return false;
  }
}

