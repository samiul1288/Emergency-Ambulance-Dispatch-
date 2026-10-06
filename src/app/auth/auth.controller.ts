import type { NextFunction, Request, Response } from "express";
import { isProduction } from "../../config/index.js";
import { sendResponse } from "../../utils/ApiResponse.js";
import { loginUser, refreshTokens, registerUser } from "./auth.service.js";
import type {
  LoginInput,
  RefreshTokenInput,
  RegisterInput,
} from "./auth.validation.js";

const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

/** POST /api/v1/auth/register */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await registerUser(req.body as RegisterInput);
    setRefreshCookie(res, result.refreshToken);
    sendResponse(res, {
      statusCode: 201,
      message: "Registration successful",
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/auth/login */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await loginUser(req.body as LoginInput);
    setRefreshCookie(res, result.refreshToken);
    sendResponse(res, {
      statusCode: 200,
      message: "Login successful",
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/auth/refresh-token
 * Rotates the refresh token (cookie or body) and returns a fresh pair.
 */
export async function refreshToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = (req.body ?? {}) as RefreshTokenInput;
    const result = await refreshTokens({
      refreshToken: body.refreshToken ?? req.cookies?.refreshToken,
    });
    setRefreshCookie(res, result.refreshToken);
    sendResponse(res, {
      statusCode: 200,
      message: "Tokens refreshed successfully",
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

