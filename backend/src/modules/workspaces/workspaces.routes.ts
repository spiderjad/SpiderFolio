import { notFound } from "../../lib/errors.ts";
import { tenantOf } from "../../middleware/tenant.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { homeOverview } from "./home.service.ts";

export function workspaceRoutes(deps: AppDeps): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/",
      // Datos del workspace y del rol de quien consulta (cabecera de la app).
      handler: async (req, res) => {
        const { tenant, db } = tenantOf(req);
        const workspace = await db.workspace.findUnique({
          where: { id: tenant.workspaceId },
          select: { id: true, name: true, slug: true, logoKey: true, accentColor: true },
        });
        if (workspace === null) throw notFound();
        res.json({
          workspace,
          membership: {
            id: tenant.membershipId,
            role: tenant.role,
            capabilities: tenant.capabilities,
            departmentIds: tenant.departmentIds,
          },
        });
      },
    },
    {
      method: "get",
      path: "/overview",
      // Inicio: lo pendiente de la persona y, según su alcance, su área o la empresa.
      handler: async (req, res) => {
        res.json(await homeOverview(adminContextOf(req), deps));
      },
    },
  ];
}
