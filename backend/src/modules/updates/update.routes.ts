// /api/v1/w/:slug/admin/updates: a newer version of SpiderFolio, for the owner's notice in
// Administration (null if there's none, it's unknown or UPDATE_CHECK=false).
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { createUpdateChecker, type UpdateChecker } from "./update-check.ts";

export function updateRoutes(
  deps: Pick<AppDeps, "env">,
  checker: UpdateChecker = createUpdateChecker(deps.env),
): TenantRoute[] {
  return [
    {
      method: "get",
      path: "/admin/updates",
      ownerOnly: true,
      handler: async (_req, res) => {
        res.json({ update: await checker.notice() });
      },
    },
  ];
}
