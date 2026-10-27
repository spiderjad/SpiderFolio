import { z } from "zod";
import { pageShape, SearchParam } from "../../lib/pagination.ts";

export const DirectoryQuerySchema = z.object({
  q: SearchParam,
  department: z.string().min(1).max(64).optional(),
  ...pageShape(["name"], "name"),
});

/** Personas de un departamento (Ver más del organigrama). `none` = sin departamento. */
export const DirectoryDepartmentMembersQuerySchema = z.object({
  q: SearchParam,
  positions: z.enum(["leaders", "members"]).optional(),
  ...pageShape(["name"], "name"),
});

export const DirectoryDepartmentParamsSchema = z.object({ id: z.string().min(1).max(64) });

export type DirectoryQuery = z.infer<typeof DirectoryQuerySchema>;
