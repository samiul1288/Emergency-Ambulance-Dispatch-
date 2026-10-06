import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validateRequest.js";
import {
  getAuditLogs,
  getStats,
  getUsers,
  patchUserRole,
} from "./admin.controller.js";
import {
  adminUsersQuerySchema,
  auditLogsQuerySchema,
  updateUserRoleParamsSchema,
  updateUserRoleSchema,
} from "./admin.validation.js";

const adminRouter: Router = Router();

adminRouter.use(auth("ADMIN"));

adminRouter.get(
  "/users",
  validateRequest({ query: adminUsersQuerySchema }),
  getUsers,
);
adminRouter.patch(
  "/users/:id/role",
  validateRequest({
    params: updateUserRoleParamsSchema,
    body: updateUserRoleSchema,
  }),
  patchUserRole,
);
adminRouter.get("/dashboard-stats", getStats);
adminRouter.get(
  "/audit-logs",
  validateRequest({ query: auditLogsQuerySchema }),
  getAuditLogs,
);

export default adminRouter;
