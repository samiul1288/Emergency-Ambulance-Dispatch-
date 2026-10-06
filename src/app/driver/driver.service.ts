import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../errors/ApiError.js";
import type {
  AvailabilityInput,
  LocationInput,
  MyTripsQuery,
  TripStatusFilter,
  VehicleInput,
} from "./driver.validation.js";

const ACTIVE_DISPATCH_STATUSES = [
  "DISPATCHED",
  "EN_ROUTE",
  "PICKED_UP",
] as const;

/**
 * Resolve the caller's driver profile, creating one on first vehicle
 * registration. Driver accounts require a profile before they can
 * hold a vehicle or go online.
 */
async function getOrCreateDriverProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      isDeleted: true,
      role: true,
      driverProfile: {
        select: {
          id: true,
          userId: true,
          licenseNumber: true,
          isAvailable: true,
          currentLatitude: true,
          currentLongitude: true,
          isDeleted: true,
        },
      },
    },
  });

  if (!user || user.isDeleted) {
    throw ApiError.unauthorized("Driver account not found", [
      { path: "user", message: "Driver account not found" },
    ]);
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      "Your account has been deactivated. Please contact support.",
      [{ path: "account", message: "Account is deactivated" }],
    );
  }

  if (user.driverProfile && !user.driverProfile.isDeleted) {
    return user.driverProfile;
  }

  return prisma.driverProfile.upsert({
    where: { userId },
    update: { isDeleted: false, deletedAt: null },
    create: {
      userId,
      licenseNumber: `TEMP-${userId.slice(0, 8).toUpperCase()}`,
      isAvailable: false,
    },
    select: {
      id: true,
      userId: true,
      licenseNumber: true,
      isAvailable: true,
      currentLatitude: true,
      currentLongitude: true,
      isDeleted: true,
    },
  });
}

/**
 * Register a new ambulance for the caller or update the details of the
 * vehicle already assigned to them (upsert keyed on `vehicleNumber`).
 * Also stamps the driver's GPS fix when coordinates are supplied.
 */
export async function upsertVehicle(userId: string, input: VehicleInput) {
  const profile = await getOrCreateDriverProfile(userId);

  const conflicting = await prisma.ambulance.findUnique({
    where: { vehicleNumber: input.vehicleNumber },
    select: { id: true, driverId: true, isDeleted: true },
  });

  if (
    conflicting &&
    !conflicting.isDeleted &&
    conflicting.driverId !== null &&
    conflicting.driverId !== profile.id
  ) {
    throw ApiError.conflict(
      "This vehicle number is already assigned to another driver",
      [
        {
          path: "vehicleNumber",
          message: "Vehicle number is already assigned to another driver",
        },
      ],
    );
  }

  await prisma.ambulance.upsert({
    where: { vehicleNumber: input.vehicleNumber },
    update: {
      type: input.type,
      driverId: profile.id,
      isActive: input.isActive,
      isDeleted: false,
      deletedAt: null,
    },
    create: {
      vehicleNumber: input.vehicleNumber,
      type: input.type,
      driverId: profile.id,
      isActive: input.isActive,
    },
    select: { id: true },
  });

  if (
    input.currentLatitude !== undefined ||
    input.currentLongitude !== undefined
  ) {
    await prisma.driverProfile.update({
      where: { id: profile.id },
      data: {
        ...(input.currentLatitude !== undefined
          ? { currentLatitude: input.currentLatitude }
          : {}),
        ...(input.currentLongitude !== undefined
          ? { currentLongitude: input.currentLongitude }
          : {}),
      },
    });
  }

  return prisma.driverProfile.findUniqueOrThrow({
    where: { id: profile.id },
    include: { ambulance: true },
  });
}

/**
 * Toggle online/offline availability. Going offline is blocked while
 * the driver has an active dispatch (DISPATCHED / EN_ROUTE / PICKED_UP).
 */
export async function setAvailability(userId: string, input: AvailabilityInput) {
  const profile = await getOrCreateDriverProfile(userId);

  if (!input.isAvailable) {
    const activeDispatch = await prisma.dispatchRequest.findFirst({
      where: {
        driverId: profile.id,
        status: { in: [...ACTIVE_DISPATCH_STATUSES] },
        isDeleted: false,
      },
      select: { id: true, status: true },
    });

    if (activeDispatch) {
      throw ApiError.conflict(
        "You cannot go offline while on an active dispatch",
        [
          {
            path: "isAvailable",
            message: `Active dispatch ${activeDispatch.id} (${activeDispatch.status}) must be completed or cancelled first`,
          },
        ],
      );
    }
  }

  return prisma.driverProfile.update({
    where: { id: profile.id },
    data: {
      isAvailable: input.isAvailable,
      ...(input.currentLatitude !== undefined
        ? { currentLatitude: input.currentLatitude }
        : {}),
      ...(input.currentLongitude !== undefined
        ? { currentLongitude: input.currentLongitude }
        : {}),
    },
    include: { ambulance: true },
  });
}

/**
 * Require the caller's *existing* driver profile (no auto-create).
 * Location pings and trip history only make sense for drivers that
 * have already onboarded via vehicle registration.
 */
async function requireDriverProfile(userId: string) {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      licenseNumber: true,
      isAvailable: true,
      currentLatitude: true,
      currentLongitude: true,
      isDeleted: true,
      user: { select: { isActive: true, isDeleted: true } },
    },
  });

  if (!profile || profile.isDeleted || profile.user.isDeleted) {
    throw ApiError.notFound("Driver profile not found", [
      {
        path: "profile",
        message: "Register your vehicle first to create a driver profile",
      },
    ]);
  }

  if (!profile.user.isActive) {
    throw ApiError.forbidden(
      "Your account has been deactivated. Please contact support.",
      [{ path: "account", message: "Account is deactivated" }],
    );
  }

  return profile;
}

/** Update the driver's live GPS position (both coordinates required). */
export async function updateLocation(userId: string, input: LocationInput) {
  const profile = await requireDriverProfile(userId);

  return prisma.driverProfile.update({
    where: { id: profile.id },
    data: {
      currentLatitude: input.currentLatitude,
      currentLongitude: input.currentLongitude,
    },
    include: { ambulance: true },
  });
}

export interface TripHistoryResult {
  trips: Awaited<
    ReturnType<typeof prisma.dispatchRequest.findMany>
  >;
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stats: {
    totalTrips: number;
    completedTrips: number;
    cancelledTrips: number;
    activeTrips: number;
  };
}

/**
 * Paginated trip history for the caller, newest first by default.
 * Optional `status` narrows to one or more DispatchStatus values;
 * per-request `stats` summarize the driver's whole (non-deleted) history.
 */
export async function getMyTrips(
  userId: string,
  query: MyTripsQuery,
): Promise<TripHistoryResult> {
  const profile = await requireDriverProfile(userId);

  const statuses = query.status as TripStatusFilter[] | undefined;

  const where = {
    driverId: profile.id,
    isDeleted: false,
    ...(statuses ? { status: { in: statuses } } : {}),
  };

  const [total, trips, stats] = await prisma.$transaction([
    prisma.dispatchRequest.count({ where }),
    prisma.dispatchRequest.findMany({
      where,
      orderBy: { createdAt: query.sort },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        ambulance: {
          select: { id: true, vehicleNumber: true, type: true },
        },
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
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
    prisma.dispatchRequest.groupBy({
      by: ["status"],
      where: { driverId: profile.id, isDeleted: false },
      _count: { _all: true },
      orderBy: { _count: { status: "desc" } },
    }),
  ]);

  // Prisma types a grouped `_count` as `true | { _all?: number }`. At
  // runtime it is always the aggregate object because this query asked
  // for `_count: { _all: true }`, so anything else counts as zero.
  const countFor = (status: string): number => {
    const row = stats.find((entry) => entry.status === status);
    const count = row?._count;
    if (!count || typeof count === "boolean") return 0;
    return count._all ?? 0;
  };

  const completedTrips = countFor("COMPLETED");
  const cancelledTrips = countFor("CANCELLED");
  const activeTrips =
    countFor("DISPATCHED") + countFor("EN_ROUTE") + countFor("PICKED_UP");

  return {
    trips,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
    stats: {
      totalTrips:
        completedTrips +
        cancelledTrips +
        activeTrips +
        countFor("PENDING"),
      completedTrips,
      cancelledTrips,
      activeTrips,
    },
  };
}

