// /api/v1/w/:slug/admin/members (CLAUDE.md, sección 9.4).
import type { Request } from "express";
import { AppError, forbidden } from "../../lib/errors.ts";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import { invitationDepsOf } from "../invitations/invitations.service.ts";
import { bulkMembers } from "./members.bulk.ts";
import { assertCanManageTarget } from "./member-rules.ts";
import { getPinSettings, updatePinSettings } from "../pin/pin-settings.ts";
import { createPinMember, pinDepsOf, resetPin } from "../pin/pin.service.ts";
import { assertGlobalManager } from "../people/people-scope.ts";
import { orgChartBranch, searchOrgChart } from "./members.groups.ts";
import { confirmImport, previewImport } from "./members.import.ts";
import {
  BulkMembersSchema,
  CreatePinMemberSchema,
  PinSettingsSchema,
  ResetPinSchema,
  ExportMembersQuerySchema,
  ImportCsvSchema,
  ListMembersQuerySchema,
  MemberParamsSchema,
  OrgChartQuerySchema,
  OrgSearchQuerySchema,
  RemoveMemberSchema,
  UpdateMemberSchema,
  UpdateProfileJobSchema,
} from "./members.schemas.ts";
import {
  exportMembers,
  getMember,
  listMembers,
  memberDepsOf,
  memberSummary,
  reactivateMember,
  removeMember,
  resetMemberTwoFactor,
  revokeMemberSessions,
  suspendMember,
  updateMember,
  updateOwnJobTitle,
} from "./members.service.ts";

const HOUR = 3_600_000;

export function memberRoutes(deps: AppDeps): TenantRoute[] {
  const memberDeps = memberDepsOf(deps);
  const invitationDeps = invitationDepsOf(deps);
  const byUser = (req: Request) => req.auth?.userId ?? "";
  const pinDeps = pinDepsOf(deps);

  return [
    {
      method: "get",
      path: "/admin/members",
      anyCapability: ["members.view", "members.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        res.json(await listMembers(adminContextOf(req), ListMembersQuerySchema.parse(req.query)));
      },
    },
    {
      // Antes de /:id para que "export" no se lea como un id.
      method: "get",
      path: "/admin/members/export",
      anyCapability: ["members.view", "members.manage"],
      leaderAccess: true,
      guards: [
        sensitiveRateLimit(deps, {
          name: "members-export",
          windowMs: HOUR,
          limit: 30,
          key: byUser,
        }),
      ],
      handler: async (req, res) => {
        res.json(
          await exportMembers(adminContextOf(req), ExportMembersQuerySchema.parse(req.query)),
        );
      },
    },
    {
      // Antes de /:id para que "pin-settings" no se lea como un id.
      method: "get",
      path: "/admin/members/pin-settings",
      capability: "members.pin",
      handler: async (req, res) => {
        res.json({ settings: await getPinSettings(adminContextOf(req)) });
      },
    },
    {
      method: "patch",
      path: "/admin/members/pin-settings",
      capability: "members.pin",
      handler: async (req, res) => {
        res.json({
          settings: await updatePinSettings(adminContextOf(req), PinSettingsSchema.parse(req.body)),
        });
      },
    },
    {
      // Crea a una persona sin email que entra con usuario + PIN (7.6). El PIN en claro se
      // devuelve una sola vez.
      method: "post",
      path: "/admin/members/pin",
      capability: "members.pin",
      guards: [
        sensitiveRateLimit(deps, { name: "pin-create", windowMs: HOUR, limit: 60, key: byUser }),
      ],
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        await assertGlobalManager(ctx);
        const input = CreatePinMemberSchema.parse(req.body);
        const created = await createPinMember(pinDeps, {
          workspaceId: ctx.tenant.workspaceId,
          actorUserId: ctx.info.actorId,
          name: input.name,
          loginName: input.loginName,
          roleId: input.roleId,
          departmentIds: input.departmentIds,
          ...(input.pin === undefined ? {} : { pin: input.pin }),
        });
        res
          .status(201)
          .json({ member: await getMember(ctx, created.membershipId), pin: created.pin });
      },
    },
    {
      method: "post",
      path: "/admin/members/:id/pin/reset",
      capability: "members.pin",
      guards: [
        sensitiveRateLimit(deps, { name: "pin-reset", windowMs: HOUR, limit: 60, key: byUser }),
      ],
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        await assertGlobalManager(ctx);
        const { id } = MemberParamsSchema.parse(req.params);
        const { pin } = ResetPinSchema.parse(req.body ?? {});
        // Misma regla que las demás acciones: no se gestiona a quien está por encima.
        const target = await getMember(ctx, id);
        assertCanManageTarget(ctx.actor, target.roleBase);
        const result = await resetPin(pinDeps, {
          workspaceId: ctx.tenant.workspaceId,
          actorUserId: ctx.info.actorId,
          membershipId: id,
          ...(pin === undefined ? {} : { pin }),
        });
        res.json({ member: await getMember(ctx, id), ...result });
      },
    },
    {
      method: "get",
      path: "/admin/members/summary",
      anyCapability: ["members.view", "members.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        res.json(await memberSummary(adminContextOf(req)));
      },
    },
    {
      method: "get",
      // Sin capacidad: el servicio decide quién ve el organigrama (docs/spec/personas.md).
      path: "/admin/members/org-chart",
      handler: async (req, res) => {
        res.json(await orgChartBranch(adminContextOf(req), OrgChartQuerySchema.parse(req.query)));
      },
    },
    {
      method: "get",
      path: "/admin/members/org-chart/search",
      handler: async (req, res) => {
        res.json({
          hits: await searchOrgChart(adminContextOf(req), OrgSearchQuerySchema.parse(req.query)),
        });
      },
    },
    {
      // Cada persona corrige su propio puesto: sin capacidades (solo toca su membresía).
      method: "patch",
      path: "/profile",
      handler: async (req, res) => {
        const { jobTitle } = UpdateProfileJobSchema.parse(req.body);
        await updateOwnJobTitle(adminContextOf(req), jobTitle === "" ? null : jobTitle);
        res.status(204).end();
      },
    },
    {
      method: "get",
      path: "/admin/members/:id",
      anyCapability: ["members.view", "members.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        const { id } = MemberParamsSchema.parse(req.params);
        res.json({ member: await getMember(adminContextOf(req), id) });
      },
    },
    {
      method: "patch",
      path: "/admin/members/:id",
      capability: "members.manage",
      handler: async (req, res) => {
        const { id } = MemberParamsSchema.parse(req.params);
        const member = await updateMember(
          adminContextOf(req),
          memberDeps,
          id,
          UpdateMemberSchema.parse(req.body),
        );
        res.json({ member });
      },
    },
    {
      method: "post",
      path: "/admin/members/:id/suspend",
      capability: "members.suspend",
      handler: async (req, res) => {
        const { id } = MemberParamsSchema.parse(req.params);
        res.json({ member: await suspendMember(adminContextOf(req), id) });
      },
    },
    {
      method: "post",
      path: "/admin/members/:id/reactivate",
      capability: "members.suspend",
      handler: async (req, res) => {
        const { id } = MemberParamsSchema.parse(req.params);
        res.json({ member: await reactivateMember(adminContextOf(req), memberDeps, id) });
      },
    },
    {
      method: "delete",
      path: "/admin/members/:id",
      capability: "members.manage",
      handler: async (req, res) => {
        const { id } = MemberParamsSchema.parse(req.params);
        const { transferToMembershipId } = RemoveMemberSchema.parse(req.body ?? {});
        await removeMember(adminContextOf(req), id, transferToMembershipId);
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/admin/members/:id/revoke-sessions",
      capability: "members.suspend",
      handler: async (req, res) => {
        const { id } = MemberParamsSchema.parse(req.params);
        res.json(await revokeMemberSessions(adminContextOf(req), memberDeps, id));
      },
    },
    {
      method: "post",
      path: "/admin/members/:id/2fa/reset",
      capability: "members.manage",
      guards: [
        sensitiveRateLimit(deps, {
          name: "member-2fa-reset",
          windowMs: HOUR,
          limit: 20,
          key: byUser,
        }),
      ],
      handler: async (req, res) => {
        const { id } = MemberParamsSchema.parse(req.params);
        if (req.auth === undefined) throw new AppError("UNAUTHENTICATED");
        await resetMemberTwoFactor(adminContextOf(req), memberDeps, req.auth, id);
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/admin/members/bulk",
      anyCapability: ["members.manage", "members.suspend"],
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        const input = BulkMembersSchema.parse(req.body);
        // Suspender y reactivar piden members.suspend; el resto, members.manage.
        const needed =
          input.action.type === "suspend" || input.action.type === "reactivate"
            ? "members.suspend"
            : "members.manage";
        if (!ctx.actor.capabilities.includes(needed)) throw forbidden();
        res.json(await bulkMembers(ctx, memberDeps, input));
      },
    },
    {
      method: "post",
      path: "/admin/members/import",
      capability: "members.invite",
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        await assertGlobalManager(ctx);
        const { csv } = ImportCsvSchema.parse(req.body);
        res.json(await previewImport(ctx, invitationDeps, csv));
      },
    },
    {
      method: "post",
      path: "/admin/members/import/confirm",
      capability: "members.invite",
      // Manda emails: rate limit compartido (Postgres) por persona (12).
      guards: [
        sensitiveRateLimit(deps, {
          name: "import-confirm",
          windowMs: HOUR,
          limit: 10,
          key: byUser,
        }),
      ],
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        await assertGlobalManager(ctx);
        const { csv } = ImportCsvSchema.parse(req.body);
        res.json(await confirmImport(ctx, invitationDeps, csv));
      },
    },
  ];
}
