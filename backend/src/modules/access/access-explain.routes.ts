// GET /nodes/:id/access y GET /spaces/:id/access: «quién accede y por qué». El nivel lo decide el
// servicio (hace falta gestionar el elemento).
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { ExplainParamsSchema, ExplainQuerySchema } from "./access-explain.schemas.ts";
import {
  InheritanceSchema,
  SetPermissionSchema,
  SharingParamsSchema,
} from "./sharing.schemas.ts";
import {
  removePermission,
  setInheritance,
  setPermission,
  sharingDepsOf,
} from "./sharing.service.ts";
import { explainNodeAccess, explainSpaceAccess } from "./access-explain.service.ts";

export function accessExplainRoutes(deps: AppDeps): TenantRoute[] {
  const sharing = sharingDepsOf(deps);
  return [
    {
      method: "get",
      path: "/nodes/:id/access",
      handler: async (req, res) => {
        const { id } = ExplainParamsSchema.parse(req.params);
        res.json(
          await explainNodeAccess(adminContextOf(req), id, ExplainQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/spaces/:id/access",
      handler: async (req, res) => {
        const { id } = ExplainParamsSchema.parse(req.params);
        res.json(
          await explainSpaceAccess(adminContextOf(req), id, ExplainQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "put",
      path: "/nodes/:id/permissions",
      handler: async (req, res) => {
        const { id } = SharingParamsSchema.parse(req.params);
        const input = SetPermissionSchema.parse(req.body);
        const permission = await setPermission(adminContextOf(req), sharing, { type: "node", id }, input);
        res.json({ permission });
      },
    },
    {
      method: "put",
      path: "/spaces/:id/permissions",
      handler: async (req, res) => {
        const { id } = SharingParamsSchema.parse(req.params);
        const input = SetPermissionSchema.parse(req.body);
        const permission = await setPermission(
          adminContextOf(req),
          sharing,
          { type: "space", id },
          input,
        );
        res.json({ permission });
      },
    },
    {
      method: "delete",
      path: "/permissions/:id",
      handler: async (req, res) => {
        const { id } = SharingParamsSchema.parse(req.params);
        await removePermission(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "patch",
      path: "/nodes/:id/inheritance",
      handler: async (req, res) => {
        const { id } = SharingParamsSchema.parse(req.params);
        res.json(await setInheritance(adminContextOf(req), id, InheritanceSchema.parse(req.body)));
      },
    },
  ];
}
