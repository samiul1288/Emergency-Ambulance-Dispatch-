import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../errors/ApiError.js";
import { sendResponse } from "../../utils/ApiResponse.js";
import { getMyProfile, updateMyProfile } from "./user.service.js";
import type { UpdateProfileInput } from "./user.validation.js";

function requireUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication is required", [
      { path: "user", message: "Authenticated user context is missing" },
    ]);
  }
  return userId;
}

/** GET /api/v1/users/me */
export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await getMyProfile(requireUserId(req));
    sendResponse(res, {
      statusCode: 200,
      message: "Profile retrieved successfully",
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/users/me */
export async function updateMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await updateMyProfile(
      requireUserId(req),
      req.body as UpdateProfileInput,
    );
    sendResponse(res, {
      statusCode: 200,
      message: "Profile updated successfully",
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

