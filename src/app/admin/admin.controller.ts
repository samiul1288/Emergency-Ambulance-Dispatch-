import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../errors/ApiError.js";
import { sendResponse } from "../../utils/ApiResponse.js";
import {
  getDashboardStats,
  listAuditLogs,
  listUsers,
  updateUserRole,
} from "./admin.service.js";
import type {
  AdminUsersQuery,
  AuditLogsQuery,
  UpdateUserRoleInput,
  UpdateUserRoleParams,
} from "./admin.validation.js";

function requireAdminId(req: Request): string {
  if (!req.user?.id) {
    throw ApiError.unauthorized("Authentication is required");
  }
  return req.user.id;
}

export async function getUsers(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await listUsers(req.query as unknown as AdminUsersQuery);
    sendResponse(res, {
      message: "Users retrieved successfully",
      data: result.users,
      meta: result.meta,
    });
  } catch (err) {
    next(err);
  }
}

export async function patchUserRole(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params as unknown as UpdateUserRoleParams;
    const user = await updateUserRole(
      requireAdminId(req),
      id,
      req.body as UpdateUserRoleInput,
      {
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      },
    );
    sendResponse(res, {
      message: "User role updated successfully",
      data: user,
    });
  } catch (err) {
    next(err);
  }
}

export async function getStats(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendResponse(res, {
      message: "Dashboard statistics retrieved successfully",
      data: await getDashboardStats(),
    });
  } catch (err) {
    next(err);
  }
}

export async function getAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await listAuditLogs(req.query as unknown as AuditLogsQuery);
    sendResponse(res, {
      message: "Audit logs retrieved successfully",
      data: result.logs,
      meta: result.meta,
    });
  } catch (err) {
    next(err);
  }
}
