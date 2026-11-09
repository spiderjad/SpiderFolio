// The whistleblowing channel inside a company (docs/spec/canal-denuncias.md): /admin/whistleblowing is
// its setup (only the owner); /whistleblowing/* is management's, open only to the designated managers
// (checked in every service, not by role: no capability gives access to the cases).
import { whistleblowingLimits } from "@spiderfolio/limits";
import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { actOnCase, caseCounts, getCase, listCases, type CaseAction } from "./cases.service.ts";
import {
  authOf,
  getChannelSettings,
  setChannelManagers,
  updateChannelSettings,
} from "./channel-settings.service.ts";
import { boxOf } from "./whistleblowing-access.ts";

const L = whistleblowingLimits;
const Id = z.string().min(1).max(64);
const Text = (max: number) => z.string().trim().min(1).max(max);

const UpdateSchema = z.strictObject({
  enabled: z.boolean().optional(),
  categories: z.array(Text(L.categoryMax)).max(L.categoriesMax).optional(),
  intro: z.string().trim().max(L.pageTextMax).optional(),
  externalChannels: z.string().trim().max(L.pageTextMax).optional(),
  retentionYears: z.number().int().min(1).max(L.retentionYearsMax).optional(),
});

const ManagersSchema = z.strictObject({
  managers: z
    .array(z.strictObject({ membershipId: Id, responsible: z.boolean() }))
    .max(L.managersMax),
});

const CasesQuery = z.object({
  ...pageShape(["receivedAt", "dueOn"], "receivedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["RECEIVED", "ADMITTED", "NOT_ADMITTED", "INVESTIGATING", "CLOSED"]).optional(),
  category: z.string().trim().min(1).max(L.categoryMax).optional(),
});

const CaseParams = z.object({ caseId: Id });

const ActionSchema: z.ZodType<CaseAction> = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("admit") }),
  z.strictObject({ action: z.literal("not_admit"), reason: Text(L.messageMax) }),
  z.strictObject({ action: z.literal("investigate") }),
  z.strictObject({
    action: z.literal("close"),
    outcome: z.enum(["SUBSTANTIATED", "NOT_SUBSTANTIATED", "PARTIAL", "REFERRED"]),
    summary: Text(L.messageMax),
  }),
  z.strictObject({ action: z.literal("extend"), reason: Text(L.messageMax) }),
  z.strictObject({ action: z.literal("refer") }),
  z.strictObject({ action: z.literal("affected_informed") }),
  z.strictObject({ action: z.literal("instructor"), membershipId: Id.nullable() }),
  z.strictObject({ action: z.literal("note"), body: Text(L.messageMax) }),
  z.strictObject({ action: z.literal("message"), body: Text(L.messageMax) }),
  z.strictObject({ action: z.literal("recuse") }),
]);

export function whistleblowingRoutes(deps: AppDeps): TenantRoute[] {
  const caseDeps = () => ({ box: boxOf(deps.env) });
  return [
    {
      method: "get",
      path: "/admin/whistleblowing",
      ownerOnly: true,
      handler: async (req, res) => {
        res.json({
          channel: await getChannelSettings(adminContextOf(req), deps, authOf(req)),
        });
      },
    },
    {
      method: "put",
      path: "/admin/whistleblowing",
      ownerOnly: true,
      handler: async (req, res) => {
        const input = UpdateSchema.parse(req.body);
        res.json({
          channel: await updateChannelSettings(adminContextOf(req), deps, authOf(req), input),
        });
      },
    },
    {
      method: "put",
      path: "/admin/whistleblowing/managers",
      ownerOnly: true,
      handler: async (req, res) => {
        const { managers } = ManagersSchema.parse(req.body);
        res.json({
          channel: await setChannelManagers(adminContextOf(req), deps, authOf(req), managers),
        });
      },
    },
    {
      method: "get",
      path: "/whistleblowing/cases",
      handler: async (req, res) => {
        res.json(await listCases(adminContextOf(req), CasesQuery.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/whistleblowing/counts",
      handler: async (req, res) => {
        res.json(await caseCounts(adminContextOf(req)));
      },
    },
    {
      method: "get",
      path: "/whistleblowing/cases/:caseId",
      handler: async (req, res) => {
        const { caseId } = CaseParams.parse(req.params);
        res.json({ case: await getCase(adminContextOf(req), caseDeps(), caseId) });
      },
    },
    {
      method: "post",
      path: "/whistleblowing/cases/:caseId/actions",
      handler: async (req, res) => {
        const { caseId } = CaseParams.parse(req.params);
        const input = ActionSchema.parse(req.body);
        const ctx = adminContextOf(req);
        await actOnCase(ctx, caseDeps(), caseId, input);
        res.json({ case: await getCase(ctx, caseDeps(), caseId) });
      },
    },
  ];
}
