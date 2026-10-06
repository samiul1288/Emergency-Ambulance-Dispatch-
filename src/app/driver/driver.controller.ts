import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../errors/ApiError.js";
import { sendResponse } from "../../utils/ApiResponse.js";
import {
  getMyTrips,
  setAvailability,
  updateLocation,
  upsertVehicle,
} from "./driver.service.js";
import type {
  AvailabilityInput,
  LocationInput,
  MyTripsQuery,
  VehicleInput,
} from "./driver.validation.js";

function requireUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) {
    throw ApiError.unauthorized("Authentication is required", [
      { path: "user", message: "Authenticated driver context is missing" },
    ]);
  }
  return userId;
}

/** POST /api/v1/drivers/vehicle */
export async function registerOrUpdateVehicle(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await upsertVehicle(
      requireUserId(req),
      req.body as VehicleInput,
    );
    sendResponse(res, {
      statusCode: 200,
      message: "Vehicle details saved successfully",
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/drivers/availability */
export async function updateAvailability(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await setAvailability(
      requireUserId(req),
      req.body as AvailabilityInput,
    );
    sendResponse(res, {
      statusCode: 200,
      message: profile.isAvailable
        ? "You are now online and available for dispatches"
        : "You are now offline",
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/v1/drivers/location */
export async function updateDriverLocation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await updateLocation(
      requireUserId(req),
      req.body as LocationInput,
    );
    sendResponse(res, {
      statusCode: 200,
      message: "Location updated successfully",
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/v1/drivers/my-trips */
export async function getDriverTrips(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { trips, meta, stats } = await getMyTrips(
      requireUserId(req),
      req.query as unknown as MyTripsQuery,
    );
    sendResponse(res, {
      statusCode: 200,
      message: "Trip history retrieved successfully",
      data: { trips, stats },
      meta,
    });
  } catch (err) {
    next(err);
  }
}

