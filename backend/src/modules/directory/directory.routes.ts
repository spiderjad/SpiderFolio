// /api/v1/w/:slug/directory (CLAUDE.md, sección 9.3): directorio de solo lectura. Sin capacidad
// de panel: lo ven los miembros con plaza completa; el servicio decide quién ve a quién.
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { listOrgDepartmentMembers } from "../members/members.groups.ts";
import {
  DirectoryDepartmentMembersQuerySchema,
  DirectoryDepartmentParamsSchema,
  DirectoryQuerySchema,
} from "./directory.schemas.ts";
import { listDirectory } from "./directory.service.ts";

export function directoryRoutes(): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/directory",
      handler: async (req, res) => {
        res.json(await listDirectory(adminContextOf(req), DirectoryQuerySchema.parse(req.query)));
      },
    },
    {
      // Personas de un departamento, paginadas: el "Ver más" del organigrama.
      method: "get",
      path: "/directory/departments/:id/members",
      handler: async (req, res) => {
        const { id } = DirectoryDepartmentParamsSchema.parse(req.params);
        res.json(
          await listOrgDepartmentMembers(
            adminContextOf(req),
            id,
            DirectoryDepartmentMembersQuerySchema.parse(req.query),
          ),
        );
      },
    },
  ];
}
