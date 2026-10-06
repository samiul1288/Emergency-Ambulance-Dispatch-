import type { Server } from "node:http";
import app from "./app.js";
import { config } from "./config/index.js";
import { prisma } from "./lib/prisma.js";

const server: Server = app.listen(config.PORT, () => {
  console.log(
    `🚑 Emergency Ambulance Dispatch System listening on port ${config.PORT} [${config.NODE_ENV}]`,
  );
});

const shutdown = (signal: string): void => {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close((err) => {
    if (err) {
      console.error("Error during shutdown", err);
      process.exit(1);
    }
    void prisma
      .$disconnect()
      .catch((dbErr) => console.error("Error disconnecting Prisma", dbErr))
      .finally(() => process.exit(0));
  });
  // Force exit if connections hang
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  shutdown("unhandledRejection");
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  shutdown("uncaughtException");
});
