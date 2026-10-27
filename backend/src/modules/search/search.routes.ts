// /search/quick — la paleta Ctrl+K. Cualquier miembro con plaza puede buscar; lo que vuelve ya está
// filtrado por lo que esa persona ve.
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { quickSearch } from "./quick-search.service.ts";
import { fullTextSearch } from "./fulltext.service.ts";
import { FullTextQuerySchema, QuickQuerySchema } from "./search.schemas.ts";

export function searchRoutes(deps: Pick<AppDeps, "prisma">): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/search",
      handler: async (req, res) => {
        res.json(
          await fullTextSearch(adminContextOf(req), deps, FullTextQuerySchema.parse(req.query)),
        );
      },
    },
    {
      method: "get",
      path: "/search/quick",
      handler: async (req, res) => {
        res.json(await quickSearch(adminContextOf(req), QuickQuerySchema.parse(req.query)));
      },
    },
  ];
}
