// /api/v1/w/:slug/admin/roles y /admin/capabilities (CLAUDE.md, sección 9.4).
import { adminContextOf } from "../admin/admin-context.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { capabilities } from "./capabilities.ts";
import { capabilityGroups } from "./capability-groups.ts";
import {
  CreateRoleSchema,
  IdParamsSchema,
  ListRolesQuerySchema,
  RoleOptionsQuerySchema,
  UpdateRoleSchema,
} from "./roles.schemas.ts";
import { createRole, deleteRole, listRoleOptions, listRoles, updateRole } from "./roles.service.ts";

export function roleRoutes(deps: AppDeps): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/admin/roles",
      // También lo necesitan quienes invitan o gestionan miembros (para elegir el rol).
      anyCapability: ["roles.manage", "members.invite", "members.manage", "members.view"],
      handler: async (req, res) => {
        res.json(await listRoles(adminContextOf(req), ListRolesQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/admin/roles/options",
      anyCapability: ["roles.manage", "members.invite", "members.manage", "members.view"],
      // Jefes y subjefes eligen el rol para invitar a su área (el servicio solo les muestra los asignables).
      leaderAccess: true,
      handler: async (req, res) => {
        res.json(
          await listRoleOptions(adminContextOf(req), RoleOptionsQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "post",
      path: "/admin/roles",
      capability: "roles.manage",
      handler: async (req, res) => {
        const role = await createRole(adminContextOf(req), CreateRoleSchema.parse(req.body));
        res.status(201).json({ role });
      },
    },
    {
      method: "patch",
      path: "/admin/roles/:id",
      capability: "roles.manage",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        const role = await updateRole(adminContextOf(req), id, UpdateRoleSchema.parse(req.body));
        res.json({ role });
      },
    },
    {
      method: "delete",
      path: "/admin/roles/:id",
      capability: "roles.manage",
      handler: async (req, res) => {
        const { id } = IdParamsSchema.parse(req.params);
        await deleteRole(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/admin/capabilities",
      capability: "roles.manage",
      handler: (req, res) => {
        // Qué puede dar quien consulta: el editor deshabilita lo que no tiene.
        res.json({
          groups: [
            ...capabilityGroups,
            // Un grupo más con las capacidades de los plugins instalados.
            ...(deps.plugins.capabilities.length === 0
              ? []
              : [{ id: "plugins", capabilities: deps.plugins.capabilities.map((c) => c.id) }]),
          ],
          all: [...capabilities, ...deps.plugins.capabilities.map((capability) => capability.id)],
          // Las de los plugins instalados traen su propia etiqueta y explicación.
          plugins: deps.plugins.capabilities,
          grantable: adminContextOf(req).actor.capabilities,
        });
      },
    },
  ];
}
