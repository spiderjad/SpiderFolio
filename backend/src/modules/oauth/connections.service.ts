// Connected apps (docs/spec/conector-mcp.md): each person sees and disconnects theirs in the company
// (Mi perfil); the owner sees and disconnects anyone's and turns the connector on or off for the company
// (Administración › Seguridad). Disconnecting revokes the connection and every token it has.
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.ts";
import { notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, pageShape, stableOrder, type Page } from "../../lib/pagination.ts";
import type { AppDeps } from "../../routes.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { MCP_PATH, oauthUrls } from "./oauth.config.ts";

export const ConnectionsQuerySchema = z.object({ ...pageShape(["createdAt"], "createdAt") });
export type ConnectionsQuery = z.infer<typeof ConnectionsQuerySchema>;
export const ConnectorSchema = z.strictObject({ enabled: z.boolean() });

export interface ConnectionView {
  id: string;
  client: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  /** Only in the owner's list: whose connection it is. */
  person?: { name: string; email: string | null };
}

export interface ConnectorState {
  /** A plugin gives the connector to the company (Conector para Claude, free or paid). */
  available: boolean;
  /** The owner didn't turn it off. */
  enabled: boolean;
  /** The paid plugin lets Claude write. */
  canWrite: boolean;
  /** What people paste in Claude. */
  url: string;
}

type Deps = Pick<AppDeps, "prisma" | "plugins" | "env">;

async function connectorState(ctx: AdminContext, deps: Deps): Promise<ConnectorState> {
  const workspace = await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { settings: true },
  });
  const disabled =
    (workspace.settings as { mcpDisabled?: unknown } | null | undefined)?.mcpDisabled === true;
  const workspaceId = ctx.tenant.workspaceId;
  return {
    available: await deps.plugins.hasFeature(workspaceId, "mcp_read"),
    enabled: !disabled,
    canWrite: await deps.plugins.hasFeature(workspaceId, "mcp_write"),
    url: `${oauthUrls(deps.env).issuer}${MCP_PATH}`,
  };
}

async function listGrants(
  ctx: AdminContext,
  query: ConnectionsQuery,
  userId: string | null,
): Promise<Page<ConnectionView>> {
  const where = { revokedAt: null, ...(userId === null ? {} : { userId }) };
  const [rows, total] = await Promise.all([
    ctx.db.oAuthGrant.findMany({
      where,
      select: {
        id: true,
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
        client: { select: { clientName: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: stableOrder({ createdAt: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.oAuthGrant.count({ where }),
  ]);
  return pageOf(
    rows.map((row) => ({
      id: row.id,
      client: row.client.clientName,
      scopes: row.scopes,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      ...(userId === null ? { person: { name: row.user.name, email: row.user.email } } : {}),
    })),
    total,
    query,
  );
}

async function revoke(ctx: AdminContext, deps: Deps, grantId: string, userId: string | null) {
  const grant = await ctx.db.oAuthGrant.findFirst({
    where: { id: grantId, revokedAt: null, ...(userId === null ? {} : { userId }) },
    select: { id: true, client: { select: { clientName: true } } },
  });
  if (grant === null) throw notFound();
  const at = new Date();
  await ctx.db.oAuthGrant.updateMany({ where: { id: grant.id }, data: { revokedAt: at } });
  // Tokens are found by their hash, outside any company: revoked here by their connection.
  await deps.prisma.oAuthToken.updateMany({
    where: { grantId: grant.id, revokedAt: null },
    data: { revokedAt: at },
  });
  await auditAdmin(ctx, {
    action: "connector.disconnect",
    entityType: "OAuthGrant",
    entityId: grant.id,
    metadata: { client: grant.client.clientName, byOwner: userId === null },
  });
}

/** Mi perfil › Aplicaciones conectadas. */
export async function myConnections(ctx: AdminContext, deps: Deps, query: ConnectionsQuery) {
  return {
    connector: await connectorState(ctx, deps),
    connections: await listGrants(ctx, query, ctx.info.actorId),
  };
}

export const disconnectMine = (ctx: AdminContext, deps: Deps, grantId: string) =>
  revoke(ctx, deps, grantId, ctx.info.actorId);

/** Administración › Seguridad: every connection in the company. */
export async function companyConnections(ctx: AdminContext, deps: Deps, query: ConnectionsQuery) {
  return {
    connector: await connectorState(ctx, deps),
    connections: await listGrants(ctx, query, null),
  };
}

export const disconnectAny = (ctx: AdminContext, deps: Deps, grantId: string) =>
  revoke(ctx, deps, grantId, null);

/** The owner turns the connector on or off for the company (off: calls are refused at once). */
export async function setConnector(ctx: AdminContext, deps: Deps, enabled: boolean) {
  const workspace = await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, settings: true },
  });
  const settings =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Prisma.InputJsonObject)
      : {};
  const rest: Prisma.InputJsonObject = Object.fromEntries(
    Object.entries(settings).filter(([name]) => name !== "mcpDisabled"),
  );
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: { settings: enabled ? rest : { ...rest, mcpDisabled: true } },
  });
  await auditAdmin(ctx, { action: enabled ? "connector.enable" : "connector.disable" });
  return await connectorState(ctx, deps);
}
