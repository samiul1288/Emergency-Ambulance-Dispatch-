import { ApiError } from "../../errors/ApiError.js";
import { prisma } from "../../lib/prisma.js";
import type { UpdateProfileInput } from "./user.validation.js";

/** Public profile fields — never includes the password hash. */
const profileSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Fetch the authenticated caller's own profile.
 * Drivers additionally receive their vehicle + availability snapshot.
 */
export async function getMyProfile(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    select: {
      ...profileSelect,
      driverProfile: {
        select: {
          id: true,
          licenseNumber: true,
          isAvailable: true,
          currentLatitude: true,
          currentLongitude: true,
          ambulance: {
            select: {
              id: true,
              vehicleNumber: true,
              type: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw ApiError.notFound("User profile not found", [
      { path: "user", message: `No active user found for id ${userId}` },
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
 * Update the caller's mutable profile fields (names / phone number).
 * Phone uniqueness is enforced against every other active account.
 */
export async function updateMyProfile(
  userId: string,
  input: UpdateProfileInput,
) {
  const existing = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    select: { id: true, isActive: true, phone: true },
  });

  if (!existing) {
    throw ApiError.notFound("User profile not found", [
      { path: "user", message: `No active user found for id ${userId}` },
    ]);
  }

  if (!existing.isActive) {
    throw ApiError.forbidden(
      "Your account has been deactivated. Please contact support.",
      [{ path: "account", message: "Account is deactivated" }],
    );
  }

  if (input.phone !== undefined && input.phone !== existing.phone) {
    const phoneTaken = await prisma.user.findFirst({
      where: { phone: input.phone, isDeleted: false, id: { not: userId } },
      select: { id: true },
    });
    if (phoneTaken) {
      throw ApiError.conflict("This phone number is already in use", [
        { path: "phone", message: "Phone number is already registered" },
      ]);
    }
  }

  const data: { firstName?: string; lastName?: string; phone?: string } = {};
  if (input.firstName !== undefined) data.firstName = input.firstName;
  if (input.lastName !== undefined) data.lastName = input.lastName;
  if (input.phone !== undefined) data.phone = input.phone;

  return prisma.user.update({
    where: { id: userId },
    data,
    select: profileSelect,
  });
}

