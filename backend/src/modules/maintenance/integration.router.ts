// /api/v1/integrations/maintenance — the API the warehouse system (SGA) talks to (docs/spec/mantenimiento.md,
// section 6). Outside any member's session: only an integration token (Authorization: Bearer sfm_…) that
// the company's owner created, with its scopes. Every invalid, revoked or foreign token gets the same 401.
//
//   PUT /parts         { mode?: "merge" | "replace", parts: [...], retire?: [codes] }   scope parts.write
//   GET /consumption   ?since=<ISO date-time>&cursor=<last id>&limit=<1-500>             scope consumption.read
import express, { type Request, type Router } from "express";
import { maintenanceLimits } from "@spiderfolio/limits";
import { z } from "zod";
import { maintenanceTexts } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import { clientIp, sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps } from "../../routes.ts";
import { authenticate, consumption, syncParts, type Integration } from "./parts.service.ts";

const L = maintenanceLimits;
const Amount = z.number().min(0).max(1e10).nullable().default(null);

const PartSchema = z.strictObject({
  code: z.string().trim().min(1).max(L.codeMax),
  description: z.string().trim().min(1).max(L.nameMax),
  unit: z.string().trim().min(1).max(20).default("ud"),
  stock: Amount,
  minStock: Amount,
  location: z.string().trim().max(L.shortMax).default(""),
});
const SyncSchema = z.strictObject({
  mode: z.enum(["merge", "replace"]).default("merge"),
  parts: z.array(PartSchema).max(L.partsPerCall),
  retire: z.array(z.string().trim().min(1).max(L.codeMax)).max(L.partsPerCall).default([]),
});
const ConsumptionQuery = z.object({
  since: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export function maintenanceIntegrationRouter(deps: AppDeps): Router {
  const router = express.Router();
  // Per address before knowing the token (guessing), and per token after.
  router.use(
    sensitiveRateLimit(deps, {
      name: "maintenance-integration-ip",
      windowMs: 60_000,
      limit: 120,
      key: (req) => clientIp(req),
    }),
  );
  const integrationOf = async (req: Request): Promise<Integration> => {
    const found = await authenticate(deps.prisma, req.get("authorization"));
    if (found === null) throw new AppError("UNAUTHENTICATED");
    return found;
  };

  router.put("/parts", async (req, res) => {
    const integration = await integrationOf(req);
    const input = SyncSchema.parse(req.body);
    // Text sent in another encoding (Latin-1, Windows-1252) arrives as «�»: refused, not stored.
    if (JSON.stringify(input).includes("\uFFFD")) {
      throw new AppError("BAD_REQUEST", { message: maintenanceTexts.errors.notUtf8 });
    }
    if (input.mode === "replace" && input.parts.length === 0) throw new AppError("BAD_REQUEST");
    res.json(await syncParts(integration, input));
  });

  router.get("/consumption", async (req, res) => {
    const integration = await integrationOf(req);
    res.json(await consumption(integration, ConsumptionQuery.parse(req.query)));
  });

  return router;
}
