import type { AuthenticatedUser } from "../middlewares/auth.js";

/**
 * Augments Express' `Request` with the authenticated caller that the
 * `auth` middleware attaches after verifying the Bearer access token.
 *
 * Keeping the declaration here (instead of inside `middlewares/auth.ts`)
 * means every controller/service sees `req.user` without extra imports.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};

