import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config/index.js";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * Prisma ORM 7 no longer reads the connection URL from `schema.prisma`
 * nor generates into `node_modules`:
 * - the CLI gets its URL from `prisma.config.ts`,
 * - the runtime client gets it through a driver adapter (`pg`).
 * The schema therefore only declares `provider`.
 */
const adapter = new PrismaPg({ connectionString: config.DATABASE_URL });

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

