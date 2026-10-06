import { z } from "zod";

const userRoles = ["PATIENT", "DRIVER", "ADMIN"] as const;

export const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  role: z.enum(userRoles).optional(),
  sortBy: z
    .enum(["createdAt", "email", "firstName", "lastName", "role"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const updateUserRoleParamsSchema = z.object({
  id: z.string().trim().uuid("User id must be a valid UUID"),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(userRoles),
});

export const auditLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type UpdateUserRoleParams = z.infer<typeof updateUserRoleParamsSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
