import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../errors/ApiError.js";
import { sendResponse } from "../../utils/ApiResponse.js";
import type { AuthenticatedUser } from "../../middlewares/auth.js";
import {
  assignDriver,
  createDispatchRequest,
  findNearbyAmbulances,
  getMyRequests,
  searchDispatchRequests,
  updateDispatchStatus,
} from "./dispatch.service.js";
import type {
  AssignDriverInput,
  CreateDispatchInput,
  DispatchIdParams,
  MyRequestsQuery,
  NearbyAmbulancesQuery,
  SearchDispatchQuery,
  UpdateDispatchStatusInput,
} from "./dispatch.validation.js";

function requireUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication is required", [
      { path: "user", message: "Authenticated patient context is missing" },
    ]);
  }
  return userId;
}

/** Authenticated caller with the role carried by the verified token. */
function requireCaller(req: Request): AuthenticatedUser {
  const caller = req.user;
  if (!caller) {
    throw ApiError.unauthorized("Authentication is required", [
      { path: "user", message: "Authenticated user context is missing" },
    ]);
  }
  return caller;
}

/** POST /api/v1/dispatch/request */
export async function createRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dispatch = await createDispatchRequest(
      requireUserId(req),
      req.body as CreateDispatchInput,
    );
    sendResponse(res, {
      statusCode: 201,
      message: "Emergency request created successfully",
      data: dispatch,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/dispatch/my-requests */
export async function getMyRequestHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { requests, meta } = await getMyRequests(
      requireUserId(req),
      req.query as unknown as MyRequestsQuery,
    );
    sendResponse(res, {
      statusCode: 200,
      message: "Request history retrieved successfully",
      data: requests,
      meta,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/dispatch/nearby-ambulances */
export async function getNearbyAmbulances(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ambulances = await findNearbyAmbulances(
      requireUserId(req),
      req.query as unknown as NearbyAmbulancesQuery,
    );
    sendResponse(res, {
      statusCode: 200,
      message:
        ambulances.length > 0
          ? "Nearby ambulances retrieved successfully"
          : "No available ambulances found within the specified radius",
      data: ambulances,
      meta: { count: ambulances.length },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/dispatch/:id/assign */
export async function assignAmbulance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params as unknown as DispatchIdParams;
    const dispatch = await assignDriver(
      requireCaller(req),
      id,
      req.body as AssignDriverInput,
      {
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      },
    );
    sendResponse(res, {
      statusCode: 200,
      message: "Ambulance assigned successfully",
      data: dispatch,
    });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/dispatch/:id/status */
export async function updateRequestStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params as unknown as DispatchIdParams;
    const dispatch = await updateDispatchStatus(
      requireCaller(req),
      id,
      req.body as UpdateDispatchStatusInput,
      {
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      },
    );
    sendResponse(res, {
      statusCode: 200,
      message: "Dispatch status updated successfully",
      data: dispatch,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/dispatch/search — admin-only cross-patient dispatch search. */
export async function getAllDispatches(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { dispatches, meta } = await searchDispatchRequests(
      requireCaller(req),
      req.query as unknown as SearchDispatchQuery,
    );
    sendResponse(res, {
      statusCode: 200,
      message: "Dispatches retrieved successfully",
      data: dispatches,
      meta,
    });
  } catch (err) {
    next(err);
  }
}
