import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../errors/ApiError.js";
import type {
  AdminUsersQuery,
  AuditLogsQuery,
  UpdateUserRoleInput,
} from "./admin.validation.js";

export async function listUsers(query: AdminUsersQuery) {
  const where = {
    isDeleted: false,
    ...(query.role ? { role: query.role } : {}),
    ...(query.q
      ? {
          OR: [
            { firstName: { contains: query.q, mode: "insensitive" as const } },
            { lastName: { contains: query.q, mode: "insensitive" as const } },
            { email: { contains: query.q, mode: "insensitive" as const } },
            { phone: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const orderBy = { [query.sortBy]: query.sortOrder };

  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    users,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
}

export async function updateUserRole(
  adminId: string,
  userId: string,
  input: UpdateUserRoleInput,
  auditContext: { ipAddress?: string; userAgent?: string | null } = {},
) {
  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { role: true, isActive: true, isDeleted: true },
  });
  if (!admin || admin.isDeleted || !admin.isActive || admin.role !== "ADMIN") {
    throw ApiError.forbidden("An active administrator account is required");
  }
  if (adminId === userId) {
    throw ApiError.conflict("Administrators cannot change their own role");
  }

  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findFirst({
      where: { id: userId, isDeleted: false },
      select: { id: true, role: true },
    });
    if (!target) {
      throw ApiError.notFound("User not found", [
        { path: "id", message: `No active user found for id ${userId}` },
      ]);
    }

    const updated = await tx.user.update({
      where: { id: target.id },
      data: { role: input.role },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        updatedAt: true,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: adminId,
        action: "USER_ROLE_UPDATED",
        entity: "User",
        entityId: target.id,
        details: { previousRole: target.role, newRole: input.role },
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      },
    });
    return updated;
  });
}

export async function getDashboardStats() {
  const [totalDispatches, revenueByCurrency, activeDrivers, totalPatients] =
    await prisma.$transaction([
      prisma.dispatchRequest.count({ where: { isDeleted: false } }),
      prisma.payment.groupBy({
        by: ["currency"],
        where: { isDeleted: false, status: "PAID" },
        orderBy: { currency: "asc" },
        _sum: { amount: true },
      }),
      prisma.driverProfile.count({
        where: {
          isDeleted: false,
          isAvailable: true,
          user: { isDeleted: false, isActive: true },
        },
      }),
      prisma.user.count({
        where: { role: "PATIENT", isDeleted: false },
      }),
    ]);

  return {
    totalDispatches,
    totalRevenue: revenueByCurrency.map((entry) => ({
      currency: entry.currency,
      amount: entry._sum?.amount?.toFixed(2) ?? "0.00",
    })),
    activeDrivers,
    totalPatients,
  };
}

export async function listAuditLogs(query: AuditLogsQuery) {
  const where = { isDeleted: false };
  const [total, logs] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    }),
  ]);

  return {
    logs,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
}
