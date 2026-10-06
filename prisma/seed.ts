import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../src/lib/prisma.js";

const DEFAULT_PASSWORD = "Password123!";
const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);

async function hashPassword(plain: string) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function upsertUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: "ADMIN" | "DRIVER" | "PATIENT";
  passwordHash: string;
}) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      role: input.role,
      password: input.passwordHash,
      isActive: true,
      isDeleted: false,
      deletedAt: null,
    },
    create: {
      email: input.email,
      password: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      role: input.role,
      isActive: true,
    },
  });
}

async function main() {
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  const admin = await upsertUser({
    email: "admin@ambulance-dispatch.com",
    firstName: "System",
    lastName: "Admin",
    phone: "+8801000000001",
    role: "ADMIN",
    passwordHash,
  });

  const driverUser1 = await upsertUser({
    email: "driver1@ambulance-dispatch.com",
    firstName: "Karim",
    lastName: "Uddin",
    phone: "+8801000000002",
    role: "DRIVER",
    passwordHash,
  });

  const driverUser2 = await upsertUser({
    email: "driver2@ambulance-dispatch.com",
    firstName: "Rahim",
    lastName: "Hossain",
    phone: "+8801000000003",
    role: "DRIVER",
    passwordHash,
  });

  const driverProfile1 = await prisma.driverProfile.upsert({
    where: { userId: driverUser1.id },
    update: {
      licenseNumber: "DHK-DRV-1001",
      isAvailable: true,
      currentLatitude: 23.8103,
      currentLongitude: 90.4125,
      isDeleted: false,
      deletedAt: null,
    },
    create: {
      userId: driverUser1.id,
      licenseNumber: "DHK-DRV-1001",
      isAvailable: true,
      currentLatitude: 23.8103,
      currentLongitude: 90.4125,
    },
  });

  const driverProfile2 = await prisma.driverProfile.upsert({
    where: { userId: driverUser2.id },
    update: {
      licenseNumber: "DHK-DRV-1002",
      isAvailable: true,
      currentLatitude: 23.8203,
      currentLongitude: 90.4225,
      isDeleted: false,
      deletedAt: null,
    },
    create: {
      userId: driverUser2.id,
      licenseNumber: "DHK-DRV-1002",
      isAvailable: true,
      currentLatitude: 23.8203,
      currentLongitude: 90.4225,
    },
  });

  const ambulance1 = await prisma.ambulance.upsert({
    where: { vehicleNumber: "DHK-AMB-101" },
    update: {
      type: "ICU",
      driverId: driverProfile1.id,
      isActive: true,
      isDeleted: false,
      deletedAt: null,
    },
    create: {
      vehicleNumber: "DHK-AMB-101",
      type: "ICU",
      driverId: driverProfile1.id,
      isActive: true,
    },
  });

  const ambulance2 = await prisma.ambulance.upsert({
    where: { vehicleNumber: "DHK-AMB-102" },
    update: {
      type: "BASIC",
      driverId: driverProfile2.id,
      isActive: true,
      isDeleted: false,
      deletedAt: null,
    },
    create: {
      vehicleNumber: "DHK-AMB-102",
      type: "BASIC",
      driverId: driverProfile2.id,
      isActive: true,
    },
  });

  const patient1 = await upsertUser({
    email: "patient1@example.com",
    firstName: "Ayesha",
    lastName: "Khan",
    phone: "+8801000000004",
    role: "PATIENT",
    passwordHash,
  });

  const patient2 = await upsertUser({
    email: "patient2@example.com",
    firstName: "Tanvir",
    lastName: "Ahmed",
    phone: "+8801000000005",
    role: "PATIENT",
    passwordHash,
  });
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

  let completedDispatch = await prisma.dispatchRequest.findFirst({
    where: {
      patientId: patient1.id,
      pickupAddress: "House 12, Road 5, Gulshan, Dhaka",
      status: "COMPLETED",
      isDeleted: false,
    },
  });

  if (!completedDispatch) {
    completedDispatch = await prisma.dispatchRequest.create({
      data: {
        patientId: patient1.id,
        driverId: driverProfile1.id,
        ambulanceId: ambulance1.id,
        status: "COMPLETED",
        priority: "CRITICAL",
        pickupAddress: "House 12, Road 5, Gulshan, Dhaka",
        pickupLatitude: 23.7808,
        pickupLongitude: 90.4167,
        dropoffAddress: "Square Hospital, Panthapath, Dhaka",
        dropoffLatitude: 23.7536,
        dropoffLongitude: 90.3882,
        emergencyDetails: "Severe chest pain, suspected cardiac arrest.",
        estimatedArrival: thirtyMinutesAgo,
        dispatchedAt: oneHourAgo,
        enRouteAt: thirtyMinutesAgo,
        pickedUpAt: thirtyMinutesAgo,
        completedAt: now,
      },
    });
  }

  await prisma.payment.upsert({
    where: { dispatchRequestId: completedDispatch.id },
    update: {
      amount: "2500.00",
      currency: "BDT",
      status: "PAID",
      paymentMethod: "CASH",
      paidAt: now,
      failedAt: null,
      failureReason: null,
      isDeleted: false,
      deletedAt: null,
    },
    create: {
      dispatchRequestId: completedDispatch.id,
      amount: "2500.00",
      currency: "BDT",
      status: "PAID",
      paymentMethod: "CASH",
      transactionId: "TXN-SEED-COMPLETED-001",
      paidAt: now,
    },
  });

  await prisma.review.upsert({
    where: { dispatchRequestId: completedDispatch.id },
    update: {
      patientId: patient1.id,
      driverId: driverProfile1.id,
      rating: 5,
      feedback: "Driver arrived quickly and was professional.",
      isDeleted: false,
      deletedAt: null,
    },
    create: {
      dispatchRequestId: completedDispatch.id,
      patientId: patient1.id,
      driverId: driverProfile1.id,
      rating: 5,
      feedback: "Driver arrived quickly and was professional.",
    },
  });

  let activeDispatch = await prisma.dispatchRequest.findFirst({
    where: {
      patientId: patient2.id,
      pickupAddress: "Block C, Bashundhara R/A, Dhaka",
      status: "EN_ROUTE",
      isDeleted: false,
    },
  });

  if (!activeDispatch) {
    activeDispatch = await prisma.dispatchRequest.create({
      data: {
        patientId: patient2.id,
        driverId: driverProfile2.id,
        ambulanceId: ambulance2.id,
        status: "EN_ROUTE",
        priority: "HIGH",
        pickupAddress: "Block C, Bashundhara R/A, Dhaka",
        pickupLatitude: 23.8151,
        pickupLongitude: 90.4253,
        dropoffAddress: "Evercare Hospital, Bashundhara, Dhaka",
        dropoffLatitude: 23.8135,
        dropoffLongitude: 90.4312,
        emergencyDetails: "Road accident, leg fracture, urgent transport.",
        dispatchedAt: thirtyMinutesAgo,
        enRouteAt: new Date(now.getTime() - 10 * 60 * 1000),
      },
    });
  }

  await prisma.payment.upsert({
    where: { dispatchRequestId: activeDispatch.id },
    update: {
      amount: "1500.00",
      currency: "BDT",
      status: "PENDING",
      paymentMethod: "BKASH",
      isDeleted: false,
      deletedAt: null,
    },
    create: {
      dispatchRequestId: activeDispatch.id,
      amount: "1500.00",
      currency: "BDT",
      status: "PENDING",
      paymentMethod: "BKASH",
    },
  });

  const pendingExists = await prisma.dispatchRequest.findFirst({
    where: {
      patientId: patient1.id,
      pickupAddress: "House 8, Road 11, Banani, Dhaka",
      status: "PENDING",
      isDeleted: false,
    },
  });

  if (!pendingExists) {
    await prisma.dispatchRequest.create({
      data: {
        patientId: patient1.id,
        status: "PENDING",
        priority: "MEDIUM",
        pickupAddress: "House 8, Road 11, Banani, Dhaka",
        pickupLatitude: 23.7937,
        pickupLongitude: 90.4066,
        emergencyDetails: "High fever and breathing difficulty.",
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "DATABASE_SEEDED",
      entity: "System",
      details: {
        admin: admin.email,
        drivers: [driverUser1.email, driverUser2.email],
      },
    },
  });

  console.log("Seed completed successfully");
  console.log(`Admin: ${admin.email}`);
  console.log(`Drivers: ${driverUser1.email}, ${driverUser2.email}`);
  console.log(`Patients: ${patient1.email}, ${patient2.email}`);
  console.log(`Default password: ${DEFAULT_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


