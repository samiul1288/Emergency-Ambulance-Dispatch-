import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import {
  getDriverTrips,
  registerOrUpdateVehicle,
  updateAvailability,
  updateDriverLocation,
} from "./driver.controller.js";
import {
  availabilitySchema,
  locationSchema,
  myTripsQuerySchema,
  vehicleSchema,
} from "./driver.validation.js";

const driverRouter: Router = Router();

// All driver endpoints require an authenticated DRIVER (admins excluded —
 // vehicle/availability are self-service for the calling driver only).
driverRouter.use(auth("DRIVER"));

driverRouter.post(
  "/vehicle",
  validateRequest({ body: vehicleSchema }),
  registerOrUpdateVehicle,
);

driverRouter.patch(
  "/availability",
  validateRequest({ body: availabilitySchema }),
  updateAvailability,
);

driverRouter.patch(
  "/location",
  validateRequest({ body: locationSchema }),
  updateDriverLocation,
);

driverRouter.get(
  "/my-trips",
  validateRequest({ query: myTripsQuerySchema }),
  getDriverTrips,
);

export default driverRouter;

