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
 * Register or update the caller's assigned ambulance.
 * `driverId` is derived from `req.user` — never accepted from the client.
 */
export const vehicleSchema = z.object({
  vehicleNumber: z
    .string()
    .trim()
    .min(1, "Vehicle number is required")
    .max(30, "Vehicle number must be at most 30 characters")
    .transform((v) => v.toUpperCase()),
  type: z.enum(["BASIC", "ICU", "FREEZER"]).default("BASIC"),
  isActive: z.boolean().default(true),
  currentLatitude: latitudeSchema.optional(),
  currentLongitude: longitudeSchema.optional(),
});

/** Toggle the driver's online/offline availability, with optional GPS fix. */
export const availabilitySchema = z.object({
  isAvailable: z.boolean({ message: "isAvailable is required" }),
  currentLatitude: latitudeSchema.optional(),
  currentLongitude: longitudeSchema.optional(),
});

/** GPS fix for the driver's live position — both coordinates required. */
export const locationSchema = z.object({
  currentLatitude: latitudeSchema,
  currentLongitude: longitudeSchema,
});

const dispatchStatuses = [
  "PENDING",
  "DISPATCHED",
  "EN_ROUTE",
  "PICKED_UP",
  "COMPLETED",
  "CANCELLED",
] as const;

/**
 * Trip history listing: page-based pagination plus an optional
 * comma-separated `status` filter (validated against DispatchStatus).
 */
export const myTripsQuerySchema = z.object({
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

export type VehicleInput = z.infer<typeof vehicleSchema>;
export type AvailabilityInput = z.infer<typeof availabilitySchema>;
export type LocationInput = z.infer<typeof locationSchema>;
export type MyTripsQuery = z.infer<typeof myTripsQuerySchema>;
export type TripStatusFilter =
  (typeof dispatchStatuses)[number];

