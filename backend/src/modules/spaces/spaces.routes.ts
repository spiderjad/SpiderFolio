// /api/v1/w/:slug/spaces (docs/spec/modelo-de-datos.md). El acceso lo decide resolveAccess en los
// servicios; crear espacios pide la capacidad spaces.create.
import type { TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  CreateSpaceSchema,
  FavoriteOrderSchema,
  FavoriteSpaceSchema,
  ListSpaceMembersQuerySchema,
  ListSpacesQuerySchema,
  SpaceParamsSchema,
  UpdateSpaceSchema,
} from "./spaces.schemas.ts";
import {
  createSpace,
  getSpace,
  listDepartmentOptions,
  listSpaceDepartmentChoices,
  listRecentSpaces,
  listSpaces,
  recordSpaceVisit,
  setSpaceArchived,
  reorderFavoriteSpaces,
  setSpaceFavorite,
  updateSpace,
} from "./spaces.service.ts";

export function spaceRoutes(): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/spaces",
      handler: async (req, res) => {
        res.json(await listSpaces(adminContextOf(req), ListSpacesQuerySchema.parse(req.query)));
      },
    },
    {
      method: "post",
      path: "/spaces",
      // Con spaces.create, espacios de la empresa o de cualquier departamento; un jefe o subjefe,
      // solo de sus departamentos (lo decide el servicio).
      anyCapability: ["spaces.create"],
      leaderAccess: true,
      handler: async (req, res) => {
        const space = await createSpace(
          adminContextOf(req),
          CreateSpaceSchema.parse(req.body),
        );
        res.status(201).json({ space });
      },
    },
    {
      // Antes de /spaces/:id para que "recent" no se lea como un id.
      method: "get",
      path: "/spaces/recent",
      handler: async (req, res) => {
        res.json({ items: await listRecentSpaces(adminContextOf(req)) });
      },
    },
    {
      method: "put",
      path: "/spaces/favorites/order",
      handler: async (req, res) => {
        await reorderFavoriteSpaces(adminContextOf(req), FavoriteOrderSchema.parse(req.body).ids);
        res.status(204).end();
      },
    },
    {
      method: "put",
      path: "/spaces/:id/favorite",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        await setSpaceFavorite(
          adminContextOf(req),
          id,
          FavoriteSpaceSchema.parse(req.body).favorite,
        );
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/spaces/:id/visit",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        await recordSpaceVisit(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      // Antes de /spaces/:id para que "department-options" no se lea como un id.
      method: "get",
      path: "/spaces/department-options",
      anyCapability: ["spaces.create"],
      leaderAccess: true,
      handler: async (req, res) => {
        res.json(
          await listSpaceDepartmentChoices(
            adminContextOf(req),
            ListSpaceMembersQuerySchema.parse(req.query),
          ),
        );
      },
    },
    {
      method: "get",
      path: "/spaces/:id",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        res.json({ space: await getSpace(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/spaces/:id",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        res.json({
          space: await updateSpace(adminContextOf(req), id, UpdateSpaceSchema.parse(req.body)),
        });
      },
    },
    {
      method: "post",
      path: "/spaces/:id/archive",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        res.json({ space: await setSpaceArchived(adminContextOf(req), id, true) });
      },
    },
    {
      method: "post",
      path: "/spaces/:id/restore",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        res.json({ space: await setSpaceArchived(adminContextOf(req), id, false) });
      },
    },
    {
      method: "get",
      path: "/spaces/:id/members/options",
      handler: async (req, res) => {
        const { id } = SpaceParamsSchema.parse(req.params);
        res.json(
          await listDepartmentOptions(
            adminContextOf(req),
            id,
            ListSpaceMembersQuerySchema.parse(req.query),
          ),
        );
      },
    },
  ];
}
