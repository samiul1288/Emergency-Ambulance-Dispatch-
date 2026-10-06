import { z } from "zod";

const latitudeSchema = z.coerce
  .number()
  .refine((v) => Number.isFinite(v), "Latitude must be a finite number")
  .refine(
    (v) => v >= -90 && v <= 90,
    "Latitude must be between -90 and 90",
  );

const longitudeSchema = z.coerce
  .number()
  .refine((v) => Number.isFinite(v), "Longitude must be a finite number")
  .refine(
    (v) => v >= -180 && v <= 180,
    "Longitude must be between -180 and 180",
  );

/**
 * Create a new emergency dispatch request.
 * `patientId` is derived from `req.user` — never accepted from the client.
 */
export const createDispatchSchema = z.object({
  pickupAddress: z
    .string()
    .trim()
    .min(1, "Pickup address is required")
    .max(255, "Pickup address must be at most 255 characters"),
  pickupLatitude: latitudeSchema,
  pickupLongitude: longitudeSchema,
  dropoffAddress: z
    .string()
    .trim()
    .max(255, "Drop-off address must be at most 255 characters")
    .optional(),
  dropoffLatitude: latitudeSchema.optional(),
  dropoffLongitude: longitudeSchema.optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  requiredAmbulanceType: z.enum(["BASIC", "ICU", "FREEZER"]).optional(),
  emergencyDetails: z
    .string()
    .trim()
    .max(1000, "Emergency details must be at most 1000 characters")
    .optional(),
});

const dispatchStatuses = [
  "PENDING",
  "DISPATCHED",
  "EN_ROUTE",
  "PICKED_UP",
  "COMPLETED",
  "CANCELLED",
] as const;

/** Patient's own request history: pagination + optional status filter. */
export const myRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z
    .string()
    .trim()
    .optional()
    .transform((raw) =>
      raw === undefined || raw === ""
        ? undefined
        : raw
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
    )
    .refine(
      (list) =>
        list === undefined ||
        (list.length > 0 &&
          list.every((s) =>
            (dispatchStatuses as readonly string[]).includes(s),
          )),
      `status must be a comma-separated list of: ${dispatchStatuses.join(", ")}`,
    ),
  sort: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Nearby-ambulance search: patient location + radius in kilometres,
 * optional ambulance-type and result-count limits.
 */
export const nearbyAmbulancesQuerySchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusKm: z.coerce.number().positive().max(200).default(10),
  type: z.enum(["BASIC", "ICU", "FREEZER"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * Comma-separated `DispatchStatus` filter shared by the patient history
 * and the admin search (e.g. `?status=DISPATCHED,EN_ROUTE`).
 */
const statusListFilter = z
  .string()
  .trim()
  .optional()
  .transform((raw) =>
    raw === undefined || raw === ""
      ? undefined
      : raw
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
  )
  .refine(
    (list) =>
      list === undefined ||
      (list.length > 0 &&
        list.every((s) =>
          (dispatchStatuses as readonly string[]).includes(s),
        )),
    `status must be a comma-separated list of: ${dispatchStatuses.join(", ")}`,
  );

/**
 * Admin search across every patient's dispatch requests. Combines
 * free-text matching with status / priority / type / patient / driver
 * filters and a created-at range, plus pagination and sorting.
 */
export const searchDispatchQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().min(1).max(255).optional(),
    status: statusListFilter,
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    ambulanceType: z.enum(["BASIC", "ICU", "FREEZER"]).optional(),
    patientId: z
      .string()
      .trim()
      .uuid("patientId must be a valid UUID")
      .optional(),
    driverId: z.string().trim().uuid("driverId must be a valid UUID").optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sortBy: z
      .enum(["createdAt", "updatedAt", "priority", "status", "dispatchedAt"])
      .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine(
    (data) =>
      data.from === undefined ||
      data.to === undefined ||
      data.from.getTime() <= data.to.getTime(),
    {
      message: "`from` must be earlier than or equal to `to`",
      path: ["from"],
    },
  );

export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;
export type MyRequestsQuery = z.infer<typeof myRequestsQuerySchema>;
export type NearbyAmbulancesQuery = z.infer<typeof nearbyAmbulancesQuerySchema>;
export type SearchDispatchQuery = z.infer<typeof searchDispatchQuerySchema>;
export type DispatchStatusFilter =
  (typeof dispatchStatuses)[number];

/** Route params for a single dispatch request. */
export const dispatchIdParamSchema = z.object({
  id: z.string().trim().uuid("Dispatch id must be a valid UUID"),
});

/**
 * Assign a driver to a pending request. Only `driverId` is accepted: the
 * ambulance is always derived from that driver's registered vehicle, so a
 * mismatched driver/vehicle pair can never be stored.
 */
export const assignDriverSchema = z.object({
  driverId: z.string().trim().uuid("driverId must be a valid UUID"),
});

/**
 * Statuses a caller may move a request *to*. `PENDING` and `DISPATCHED` are
 * omitted on purpose: `PENDING` only exists on creation and `DISPATCHED` is
 * reached through the assign endpoint, never by PATCHing status.
 */
export const targetDispatchStatuses = [
  "EN_ROUTE",
  "PICKED_UP",
  "COMPLETED",
  "CANCELLED",
] as const;

/** Body for PATCH /:id/status — cancellation always needs a reason. */
export const updateDispatchStatusSchema = z
  .object({
    status: z.enum(targetDispatchStatuses),
    cancellationReason: z
      .string()
      .trim()
      .min(3, "Cancellation reason must be at least 3 characters")
      .max(255, "Cancellation reason must be at most 255 characters")
      .optional(),
  })
  .refine(
    (data) =>
      data.status !== "CANCELLED" || data.cancellationReason !== undefined,
    {
      message: "cancellationReason is required when status is CANCELLED",
      path: ["cancellationReason"],
    },
  );

export type DispatchIdParams = z.infer<typeof dispatchIdParamSchema>;
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;
export type UpdateDispatchStatusInput = z.infer<
  typeof updateDispatchStatusSchema
>;
export type TargetDispatchStatus =
  (typeof targetDispatchStatuses)[number];

