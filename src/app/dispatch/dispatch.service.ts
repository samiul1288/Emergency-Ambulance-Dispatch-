import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../errors/ApiError.js";
import { calculateDistance } from "../../utils/calculateDistance.js";
import type { AuthenticatedUser } from "../../middlewares/auth.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { DispatchStatus } from "../../generated/prisma/enums.js";
import type {
  AssignDriverInput,
  CreateDispatchInput,
  DispatchStatusFilter,
  MyRequestsQuery,
  NearbyAmbulancesQuery,
  SearchDispatchQuery,
  TargetDispatchStatus,
  UpdateDispatchStatusInput,
} from "./dispatch.validation.js";

type DispatchStatusValue = (typeof DispatchStatus)[keyof typeof DispatchStatus];

const OUTSTANDING_STATUSES = [
  "PENDING",
  "DISPATCHED",
  "EN_ROUTE",
  "PICKED_UP",
] as const;

/** Require an active, non-deleted patient account. */
async function requirePatient(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, isDeleted: true },
  });

  if (!user || user.isDeleted) {
    throw ApiError.unauthorized("Patient account not found", [
      { path: "user", message: "Patient account not found" },
    ]);
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      "Your account has been deactivated. Please contact support.",
      [{ path: "account", message: "Account is deactivated" }],
    );
  }

  return user;
}

/**
 * Create a new emergency dispatch request for the caller.
 * Blocked while the patient has an outstanding (non-terminal) request
 * to prevent duplicate dispatches for the same emergency.
 */
export async function createDispatchRequest(
  userId: string,
  input: CreateDispatchInput,
) {
  await requirePatient(userId);

  // A patient must finish or cancel an existing emergency before opening another.
  const outstanding = await prisma.dispatchRequest.findFirst({
    where: {
      patientId: userId,
      status: { in: [...OUTSTANDING_STATUSES] },
      isDeleted: false,
    },
    select: { id: true, status: true },
  });

  if (outstanding) {
    throw ApiError.conflict("You already have an active emergency request", [
      {
        path: "dispatchRequest",
        message: `Request ${outstanding.id} (${outstanding.status}) must be completed or cancelled before creating a new one`,
      },
    ]);
  }

  return prisma.dispatchRequest.create({
    data: {
      patientId: userId,
      status: "PENDING",
      priority: input.priority,
      requiredAmbulanceType: input.requiredAmbulanceType ?? null,
      pickupAddress: input.pickupAddress,
      pickupLatitude: input.pickupLatitude,
      pickupLongitude: input.pickupLongitude,
      dropoffAddress: input.dropoffAddress,
      dropoffLatitude: input.dropoffLatitude,
      dropoffLongitude: input.dropoffLongitude,
      emergencyDetails: input.emergencyDetails,
    },
    include: {
      driver: {
        select: {
          id: true,
          licenseNumber: true,
          isAvailable: true,
          currentLatitude: true,
          currentLongitude: true,
        },
      },
      ambulance: {
        select: { id: true, vehicleNumber: true, type: true },
      },
      payment: {
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          paymentMethod: true,
          paidAt: true,
        },
      },
      review: {
        select: { id: true, rating: true, feedback: true },
      },
    },
  });
}

export interface RequestHistoryResult {
  requests: Awaited<ReturnType<typeof prisma.dispatchRequest.findMany>>;
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Paginated request history for the caller, newest first by default.
 * Optional `status` narrows to one or more DispatchStatus values.
 */
export async function getMyRequests(
  userId: string,
  query: MyRequestsQuery,
): Promise<RequestHistoryResult> {
  await requirePatient(userId);

  const statuses = query.status as DispatchStatusFilter[] | undefined;

  const where = {
    patientId: userId,
    isDeleted: false,
    ...(statuses ? { status: { in: statuses } } : {}),
  };

  const [total, requests] = await prisma.$transaction([
    prisma.dispatchRequest.count({ where }),
    prisma.dispatchRequest.findMany({
      where,
      orderBy: { createdAt: query.sort },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        driver: {
          select: {
            id: true,
            licenseNumber: true,
            isAvailable: true,
            currentLatitude: true,
            currentLongitude: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
        ambulance: {
          select: { id: true, vehicleNumber: true, type: true },
        },
        payment: {
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            paymentMethod: true,
            paidAt: true,
          },
        },
        review: {
          select: { id: true, rating: true, feedback: true },
        },
      },
    }),
  ]);

  return {
    requests,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
}

export interface NearbyAmbulance {
  driverId: string;
  licenseNumber: string;
  isAvailable: boolean;
  currentLatitude: number;
  currentLongitude: number;
  distanceKm: number;
  estimatedArrivalMinutes: number;
  driver: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
  };
  ambulance: {
    id: string;
    vehicleNumber: string;
    type: "BASIC" | "ICU" | "FREEZER";
  } | null;
}

/** Average urban ambulance speed used for ETA estimates (km/h). */
const AVERAGE_SPEED_KMPH = 40;

/**
 * Find online drivers with a live GPS fix inside `radiusKm` of the
 * patient's location, nearest first. Post-filters by ambulance type
 * and caps the result count — distance math uses the Haversine formula
 * in `calculateDistance.ts`.
 */
export async function findNearbyAmbulances(
  userId: string,
  query: NearbyAmbulancesQuery,
): Promise<NearbyAmbulance[]> {
  await requirePatient(userId);

  const candidates = await prisma.driverProfile.findMany({
    where: {
      isAvailable: true,
      isDeleted: false,
      currentLatitude: { not: null },
      currentLongitude: { not: null },
      user: { isActive: true, isDeleted: false },
      ...(query.type
        ? {
            ambulance: {
              isDeleted: false,
              isActive: true,
              type: query.type,
            },
          }
        : {
            ambulance: { isDeleted: false, isActive: true },
          }),
    },
    select: {
      id: true,
      licenseNumber: true,
      isAvailable: true,
      currentLatitude: true,
      currentLongitude: true,
      user: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
      ambulance: {
        select: { id: true, vehicleNumber: true, type: true },
      },
    },
  });

  return candidates
    .map((candidate) => {
      // Guaranteed non-null by the `not: null` filters above.
      const driverLat = candidate.currentLatitude as number;
      const driverLon = candidate.currentLongitude as number;
      const distanceKm = calculateDistance(
        { latitude: query.latitude, longitude: query.longitude },
        { latitude: driverLat, longitude: driverLon },
      );
      return {
        driverId: candidate.id,
        licenseNumber: candidate.licenseNumber,
        isAvailable: candidate.isAvailable,
        currentLatitude: driverLat,
        currentLongitude: driverLon,
        distanceKm: Math.round(distanceKm * 100) / 100,
        estimatedArrivalMinutes: Math.max(
          1,
          Math.round((distanceKm / AVERAGE_SPEED_KMPH) * 60),
        ),
        driver: candidate.user,
        ambulance: candidate.ambulance,
      };
    })
    .filter((entry) => entry.distanceKm <= query.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, query.limit);
}

/**
 * Shared relation payload for the write endpoints, so assigning a driver and
 * advancing a trip answer with the same shape the patient reads return.
 */
const DISPATCH_INCLUDE = {
  driver: {
    select: {
      id: true,
      licenseNumber: true,
      isAvailable: true,
      user: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
    },
  },
  ambulance: { select: { id: true, vehicleNumber: true, type: true } },
  payment: { select: { id: true, status: true } },
  review: { select: { id: true, rating: true } },
};

/** A request may only be assigned while it is still unserved. */
const ASSIGNABLE_FROM: readonly DispatchStatusValue[] = ["PENDING"];

/** A request may only be cancelled before the patient is picked up. */
const CANCELLABLE_FROM: readonly DispatchStatusValue[] = [
  "PENDING",
  "DISPATCHED",
];

/** Every advance step and the single status it has to follow. */
const ADVANCE_STEPS: Partial<
  Record<TargetDispatchStatus, readonly DispatchStatusValue[]>
> = {
  EN_ROUTE: ["DISPATCHED"],
  PICKED_UP: ["EN_ROUTE"],
  COMPLETED: ["PICKED_UP"],
};

/** ETA used for a dispatched driver whose GPS fix is missing (minutes). */
const DEFAULT_ETA_MINUTES = 15;

/**
 * Caller account must exist, be undeleted and be active. The role is read
 * from the user row — not from the access token — so a revoked role or a
 * deactivation takes effect on the very next request.
 */
async function requireActiveCaller(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, isDeleted: true },
  });

  if (!user || user.isDeleted) {
    throw ApiError.unauthorized("Account not found", [
      { path: "user", message: "User account not found" },
    ]);
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      "Your account has been deactivated. Please contact support.",
      [{ path: "account", message: "Account is deactivated" }],
    );
  }

  return user;
}

/** The dispatch row plus every field the assign/status rules inspect. */
async function loadDispatchOrThrow(dispatchId: string) {
  const dispatch = await prisma.dispatchRequest.findFirst({
    where: { id: dispatchId, isDeleted: false },
    select: {
      id: true,
      status: true,
      patientId: true,
      driverId: true,
      requiredAmbulanceType: true,
      pickupLatitude: true,
      pickupLongitude: true,
    },
  });

  if (!dispatch) {
    throw ApiError.notFound("Dispatch request not found", [
      {
        path: "id",
        message: `No dispatch request found for id ${dispatchId}`,
      },
    ]);
  }

  return dispatch;
}

/** Driver profile of the caller — proves "assigned driver" identity. */
async function requireCallerDriverProfile(userId: string) {
  const profile = await prisma.driverProfile.findFirst({
    where: { userId, isDeleted: false },
    select: { id: true },
  });

  if (!profile) {
    throw ApiError.notFound("Driver profile not found", [
      {
        path: "user",
        message: "Register your vehicle first to create a driver profile",
      },
    ]);
  }

  return profile;
}

/**
 * Assign an available driver — and the vehicle registered to them — to a
 * pending request. Admin-only: the request moves to `DISPATCHED` with a
 * timestamped ETA and the driver leaves the available pool, so two dispatch
 * actions can never claim the same ambulance.
 */
export async function assignDriver(
  caller: AuthenticatedUser,
  dispatchId: string,
  input: AssignDriverInput,
  auditContext: { ipAddress?: string; userAgent?: string | null } = {},
) {
  const account = await requireActiveCaller(caller.id);

  if (account.role !== "ADMIN") {
    throw ApiError.forbidden("Only an administrator can assign ambulances", [
      {
        path: "role",
        message: `Role ${account.role} is not allowed to assign drivers`,
      },
    ]);
  }

  const dispatch = await loadDispatchOrThrow(dispatchId);

  if (!ASSIGNABLE_FROM.includes(dispatch.status)) {
    throw ApiError.conflict(
      dispatch.driverId
        ? "This request already has a driver assigned"
        : "This request can no longer be assigned",
      [
        {
          path: "status",
          message: `Request is ${dispatch.status}; only ${ASSIGNABLE_FROM.join(" or ")} requests can be assigned`,
        },
      ],
    );
  }

  const driver = await prisma.driverProfile.findFirst({
    where: { id: input.driverId, isDeleted: false },
    select: {
      id: true,
      isAvailable: true,
      currentLatitude: true,
      currentLongitude: true,
      user: {
        select: {
          id: true,
          role: true,
          isActive: true,
          isDeleted: true,
        },
      },
      ambulance: {
        select: {
          id: true,
          type: true,
          isActive: true,
          isDeleted: true,
        },
      },
    },
  });

  if (!driver) {
    throw ApiError.notFound("Driver not found", [
      {
        path: "driverId",
        message: `No driver profile for id ${input.driverId}`,
      },
    ]);
  }

  if (driver.user.isDeleted || driver.user.role !== "DRIVER") {
    throw ApiError.badRequest("Selected account is not a driver account", [
      {
        path: "driverId",
        message: "driverId must reference a driver profile",
      },
    ]);
  }

  if (!driver.user.isActive) {
    throw ApiError.conflict("Driver account is deactivated", [
      { path: "driverId", message: "That driver cannot take new trips" },
    ]);
  }

  if (!driver.isAvailable) {
    throw ApiError.conflict("Driver is already serving a dispatch", [
      { path: "driverId", message: "Choose a driver marked as available" },
    ]);
  }

  const vehicle = driver.ambulance;

  if (!vehicle || vehicle.isDeleted || !vehicle.isActive) {
    throw ApiError.conflict("Driver has no active ambulance", [
      {
        path: "driverId",
        message: "The driver must register a vehicle before being dispatched",
      },
    ]);
  }

  if (
    dispatch.requiredAmbulanceType !== null &&
    vehicle.type !== dispatch.requiredAmbulanceType
  ) {
    throw ApiError.conflict("Ambulance type does not match the request", [
      {
        path: "driverId",
        message: `Request requires ${dispatch.requiredAmbulanceType} but this driver's ambulance is ${vehicle.type}`,
      },
    ]);
  }

  const dispatchedAt = new Date();
  const distanceKm =
    driver.currentLatitude === null || driver.currentLongitude === null
      ? null
      : calculateDistance(
          {
            latitude: dispatch.pickupLatitude,
            longitude: dispatch.pickupLongitude,
          },
          {
            latitude: driver.currentLatitude,
            longitude: driver.currentLongitude,
          },
        );
  // Use a conservative default ETA until the driver has submitted a GPS location.
  const etaMinutes =
    distanceKm === null
      ? DEFAULT_ETA_MINUTES
      : Math.max(1, Math.round((distanceKm / AVERAGE_SPEED_KMPH) * 60));

  // Reserve the driver and assign the request together so neither update is left half-applied.
  return prisma.$transaction(async (tx) => {
    await tx.driverProfile.update({
      where: { id: driver.id },
      data: { isAvailable: false },
    });

    const updatedDispatch = await tx.dispatchRequest.update({
      where: { id: dispatch.id },
      data: {
        driverId: driver.id,
        ambulanceId: vehicle.id,
        status: "DISPATCHED",
        dispatchedAt,
        estimatedArrival: new Date(
          dispatchedAt.getTime() + etaMinutes * 60_000,
        ),
      },
      include: DISPATCH_INCLUDE,
    });
    await tx.auditLog.create({
      data: {
        userId: caller.id,
        action: "DISPATCH_STATUS_UPDATED",
        entity: "DispatchRequest",
        entityId: dispatch.id,
        details: {
          previousStatus: dispatch.status,
          newStatus: "DISPATCHED",
          driverId: driver.id,
        },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      },
    });
    return updatedDispatch;
  });
}

/**
 * Move a request along its lifecycle:
 *
 * - The assigned driver advances `DISPATCHED -> EN_ROUTE -> PICKED_UP -> COMPLETED`.
 * - The owning patient or an admin may cancel while `PENDING` or `DISPATCHED`.
 * - An admin may also advance a trip on the driver's behalf (dispatch desk
 *   acting for a driver whose app is offline).
 *
 * `COMPLETED` and `CANCELLED` are terminal and release the assigned driver
 * back to the available pool.
 */
export async function updateDispatchStatus(
  caller: AuthenticatedUser,
  dispatchId: string,
  input: UpdateDispatchStatusInput,
  auditContext: { ipAddress?: string; userAgent?: string | null } = {},
) {
  const account = await requireActiveCaller(caller.id);
  const dispatch = await loadDispatchOrThrow(dispatchId);
  const target = input.status;

  if (target === "CANCELLED") {
    if (account.role !== "ADMIN" && dispatch.patientId !== account.id) {
      throw ApiError.forbidden(
        "Only the patient or an administrator can cancel this request",
        [{ path: "status", message: "Caller may not cancel this request" }],
      );
    }

    if (!CANCELLABLE_FROM.includes(dispatch.status)) {
      throw ApiError.conflict("This request can no longer be cancelled", [
        {
          path: "status",
          message: `Requests can only be cancelled while ${CANCELLABLE_FROM.join(" or ")}; this one is ${dispatch.status}`,
        },
      ]);
    }
  } else {
    const requiredFrom = ADVANCE_STEPS[target];

    if (requiredFrom === undefined) {
      throw ApiError.badRequest(`Status ${target} cannot be set directly`, [
        { path: "status", message: "That status is not reachable here" },
      ]);
    }

    if (account.role === "PATIENT") {
      throw ApiError.forbidden(
        "Only the assigned driver or an administrator can advance this request",
        [{ path: "status", message: "Patients may only cancel a request" }],
      );
    }

    if (account.role === "DRIVER") {
      const profile = await requireCallerDriverProfile(account.id);

      if (dispatch.driverId !== profile.id) {
        throw ApiError.forbidden(
          "Only the driver assigned to this request can update it",
          [{ path: "status", message: "Caller is not the assigned driver" }],
        );
      }
    }

    if (!requiredFrom.includes(dispatch.status)) {
      throw ApiError.conflict(
        `A ${dispatch.status} request cannot move to ${target}`,
        [
          {
            path: "status",
            message: `${target} requires the request to be ${requiredFrom.join(" or ")}`,
          },
        ],
      );
    }
  }

  const changedAt = new Date();
  const timestamps: {
    enRouteAt?: Date;
    pickedUpAt?: Date;
    completedAt?: Date;
    cancelledAt?: Date;
    cancellationReason?: string;
  } = {};

  if (target === "EN_ROUTE") {
    timestamps.enRouteAt = changedAt;
  } else if (target === "PICKED_UP") {
    timestamps.pickedUpAt = changedAt;
  } else if (target === "COMPLETED") {
    timestamps.completedAt = changedAt;
  } else {
    timestamps.cancelledAt = changedAt;
    timestamps.cancellationReason = input.cancellationReason;
  }

  const releaseDriverId =
    target === "COMPLETED" || target === "CANCELLED" ? dispatch.driverId : null;

  // Finalizing a trip also returns its driver to the available pool atomically.
  return prisma.$transaction(async (tx) => {
    if (releaseDriverId !== null) {
      await tx.driverProfile.update({
        where: { id: releaseDriverId },
        data: { isAvailable: true },
      });
    }

    const updatedDispatch = await tx.dispatchRequest.update({
      where: { id: dispatch.id },
      data: { status: target, ...timestamps },
      include: DISPATCH_INCLUDE,
    });

    await tx.auditLog.create({
      data: {
        userId: caller.id,
        action: "DISPATCH_STATUS_UPDATED",
        entity: "DispatchRequest",
        entityId: dispatch.id,
        details: {
          previousStatus: dispatch.status,
          newStatus: target,
          cancellationReason: input.cancellationReason ?? null,
        },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      },
    });
    return updatedDispatch;
  });
}

export interface DispatchSearchResult {
  dispatches: Awaited<ReturnType<typeof prisma.dispatchRequest.findMany>>;
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin-only search across every (non-deleted) dispatch request.
 * Free-text `q` matches pickup / drop-off addresses, emergency details,
 * the cancellation reason, patient identity, driver licence / name,
 * ambulance number and — when it is a UUID — the request id itself.
 * Additional filters narrow by status, priority, required ambulance
 * type, patient, driver and a created-at range.
 */
export async function searchDispatchRequests(
  caller: AuthenticatedUser,
  query: SearchDispatchQuery,
): Promise<DispatchSearchResult> {
  const account = await requireActiveCaller(caller.id);

  if (account.role !== "ADMIN") {
    throw ApiError.forbidden(
      "Only an administrator can browse all dispatches",
      [
        {
          path: "role",
          message: `Role ${account.role} is not allowed to search dispatches`,
        },
      ],
    );
  }

  const statuses = query.status as DispatchStatusFilter[] | undefined;

  const orFilters: Prisma.DispatchRequestWhereInput[] = [];
  if (query.q !== undefined) {
    const contains = { contains: query.q, mode: "insensitive" as const };
    orFilters.push(
      { pickupAddress: contains },
      { dropoffAddress: contains },
      { emergencyDetails: contains },
      { cancellationReason: contains },
      {
        patient: {
          is: {
            OR: [
              { firstName: contains },
              { lastName: contains },
              { email: contains },
              { phone: contains },
            ],
          },
        },
      },
      { driver: { is: { licenseNumber: contains } } },
      {
        driver: {
          is: {
            user: {
              is: {
                OR: [
                  { firstName: contains },
                  { lastName: contains },
                  { phone: contains },
                ],
              },
            },
          },
        },
      },
      { ambulance: { is: { vehicleNumber: contains } } },
    );

    if (UUID_PATTERN.test(query.q)) {
      orFilters.push({ id: query.q });
    }
  }

  const where: Prisma.DispatchRequestWhereInput = {
    isDeleted: false,
    ...(statuses ? { status: { in: statuses } } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.ambulanceType
      ? { requiredAmbulanceType: query.ambulanceType }
      : {}),
    ...(query.patientId ? { patientId: query.patientId } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(orFilters.length > 0 ? { OR: orFilters } : {}),
  };

  const orderBy = { [query.sortBy]: query.sortOrder };

  const [total, dispatches] = await prisma.$transaction([
    prisma.dispatchRequest.count({ where }),
    prisma.dispatchRequest.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        ...DISPATCH_INCLUDE,
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    }),
  ]);

  return {
    dispatches,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
}
