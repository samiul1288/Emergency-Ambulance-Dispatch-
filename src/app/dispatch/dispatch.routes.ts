import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import {
  assignAmbulance,
  createRequest,
  getAllDispatches,
  getMyRequestHistory,
  getNearbyAmbulances,
  updateRequestStatus,
} from "./dispatch.controller.js";
import {
  assignDriverSchema,
  createDispatchSchema,
  dispatchIdParamSchema,
  myRequestsQuerySchema,
  nearbyAmbulancesQuerySchema,
  searchDispatchQuerySchema,
  updateDispatchStatusSchema,
} from "./dispatch.validation.js";

const dispatchRouter: Router = Router();

// ---------------------------------------------------------------------------
// Patient endpoints — raising and following up on their own emergencies.
// ---------------------------------------------------------------------------

dispatchRouter.post(
  "/request",
  auth("PATIENT"),
  validateRequest({ body: createDispatchSchema }),
  createRequest,
);

dispatchRouter.get(
  "/my-requests",
  auth("PATIENT"),
  validateRequest({ query: myRequestsQuerySchema }),
  getMyRequestHistory,
);

// Both patients and admins may inspect available ambulances nearby:
dispatchRouter.get(
  "/nearby-ambulances",
  auth("PATIENT", "ADMIN"),
  validateRequest({ query: nearbyAmbulancesQuerySchema }),
  getNearbyAmbulances,
);

// ---------------------------------------------------------------------------
// Admin search across every dispatch request.
// ⚠️ MUST BE PLACED BEFORE THE `/:id` ROUTES TO AVOID EXPRESS ROUTE CONFLICTS
// ---------------------------------------------------------------------------

dispatchRouter.get(
  "/search",
  auth("ADMIN"),
  validateRequest({ query: searchDispatchQuerySchema }),
  getAllDispatches,
);

// ---------------------------------------------------------------------------
// Dispatcher / driver lifecycle endpoints.
// ---------------------------------------------------------------------------

/** Admin assigns an available driver (and that driver's ambulance). */
dispatchRouter.post(
  "/:id/assign",
  auth("ADMIN"),
  validateRequest({
    params: dispatchIdParamSchema,
    body: assignDriverSchema,
  }),
  assignAmbulance,
);

/** Assigned driver advances the trip; patient/admin may cancel it. */
dispatchRouter.patch(
  "/:id/status",
  auth("DRIVER", "PATIENT", "ADMIN"),
  validateRequest({
    params: dispatchIdParamSchema,
    body: updateDispatchStatusSchema,
  }),
  updateRequestStatus,
);

export default dispatchRouter;
