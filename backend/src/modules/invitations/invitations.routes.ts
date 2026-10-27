// /api/v1/w/:slug/admin/invitations y /admin/seats (CLAUDE.md, sección 9.4).
import { assertGlobalScope, resolveMemberScope } from "../departments/departments.scope.ts";
import type { Request } from "express";
import { sensitiveRateLimit } from "../../middleware/rate-limit.ts";
import type { AppDeps, TenantRoute } from "../../routes.ts";
import { adminContextOf } from "../admin/admin-context.ts";
import {
  CreateInvitationsSchema,
  InvitationParamsSchema,
  ListInvitationsQuerySchema,
} from "./invitations.schemas.ts";
import {
  createInvitations,
  invitationDepsOf,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  seats,
} from "./invitations.service.ts";

const HOUR = 3_600_000;

export function invitationRoutes(deps: AppDeps): TenantRoute[] {
  const invitationDeps = invitationDepsOf(deps);
  // Invitar y reenviar mandan emails: rate limit compartido (Postgres) por persona (12).
  const byUser = (req: Request) => req.auth?.userId ?? "";
  const emailLimit = (name: string, limit: number) =>
    sensitiveRateLimit(deps, { name, windowMs: HOUR, limit, key: byUser });

  return [
    {
      method: "get",
      path: "/admin/invitations",
      anyCapability: ["members.view", "members.invite", "members.manage"],
      leaderAccess: true,
      handler: async (req, res) => {
        res.json(
          await listInvitations(
            adminContextOf(req),
            invitationDeps,
            ListInvitationsQuerySchema.parse(req.query),
          ),
        );
      },
    },
    {
      method: "post",
      path: "/admin/invitations",
      anyCapability: ["members.invite"],
      leaderAccess: true,
      guards: [emailLimit("invite", 30)],
      handler: async (req, res) => {
        const result = await createInvitations(
          adminContextOf(req),
          invitationDeps,
          CreateInvitationsSchema.parse(req.body),
        );
        res.status(result.invitations.length > 0 ? 201 : 200).json(result);
      },
    },
    {
      method: "delete",
      path: "/admin/invitations/:id",
      capability: "members.invite",
      handler: async (req, res) => {
        const { id } = InvitationParamsSchema.parse(req.params);
        await revokeInvitation(adminContextOf(req), id);
        res.status(204).end();
      },
    },
    {
      method: "post",
      path: "/admin/invitations/:id/resend",
      capability: "members.invite",
      guards: [emailLimit("invite-resend", 60)],
      handler: async (req, res) => {
        const { id } = InvitationParamsSchema.parse(req.params);
        res.json({
          invitation: await resendInvitation(adminContextOf(req), invitationDeps, id),
        });
      },
    },
    {
      method: "get",
      path: "/admin/seats",
      anyCapability: ["members.view", "members.invite", "members.manage", "workspace.settings"],
      handler: async (req, res) => {
        const ctx = adminContextOf(req);
        assertGlobalScope(await resolveMemberScope(ctx));
        res.json({ seats: await seats(ctx) });
      },
    },
  ];
}
