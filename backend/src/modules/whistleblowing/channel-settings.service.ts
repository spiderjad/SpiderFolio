// The whistleblowing channel's setup (docs/spec/canal-denuncias.md, «Activación»): only the owner,
// with their two-step verification on and confirmed recently. Turning it on needs the encryption key and
// the person responsible for the system; turning it off closes the form and never deletes a case.
import { whistleblowingLimits } from "@spiderfolio/limits";
import type { Request } from "express";
import { AppError } from "../../lib/errors.ts";
import { whistleblowingTexts } from "../../i18n/index.ts";
import type { AppDeps } from "../../routes.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { requireRecentMfa } from "../auth/mfa.service.ts";
import type { AuthContext } from "../auth/auth.service.ts";
import { readWhistleblowingSettings, type WhistleblowingSettings } from "../workspaces/settings.ts";
import { boxOf, categoriesOf, eligibleManagers } from "./whistleblowing-access.ts";

export interface ChannelManagerView {
  membershipId: string;
  name: string;
  email: string;
  responsible: boolean;
  /** Can work now (active, full seat, two-step verification on). */
  eligible: boolean;
}

export interface ChannelSettingsView {
  enabled: boolean;
  categories: string[];
  /** The company's own list is empty: the default categories apply. */
  defaultCategories: boolean;
  intro: string;
  externalChannels: string;
  retentionYears: number;
  managers: ChannelManagerView[];
  /** The server has the encryption key the channel needs. */
  keyConfigured: boolean;
  /** The owner has two-step verification on (needed to change anything here). */
  ownMfa: boolean;
}

export interface UpdateChannelInput {
  enabled?: boolean | undefined;
  categories?: string[] | undefined;
  intro?: string | undefined;
  externalChannels?: string | undefined;
  retentionYears?: number | undefined;
}

export interface ChannelManagerInput {
  membershipId: string;
  responsible: boolean;
}

type Deps = Pick<AppDeps, "env" | "prisma">;

async function workspaceOf(ctx: AdminContext) {
  return await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, settings: true },
  });
}

async function ownMfa(deps: Deps, auth: AuthContext): Promise<boolean> {
  const user = await deps.prisma.user.findUnique({
    where: { id: auth.userId },
    select: { totpEnabledAt: true },
  });
  return user?.totpEnabledAt != null;
}

/** Changing the channel: the owner, with their own 2FA confirmed recently. */
async function requireOwnerMfa(deps: Deps, auth: AuthContext): Promise<void> {
  if (!(await ownMfa(deps, auth))) {
    throw new AppError("FORBIDDEN", { message: whistleblowingTexts.managerNotEligible });
  }
  await requireRecentMfa(deps.prisma, auth);
}

async function managersOf(ctx: AdminContext): Promise<ChannelManagerView[]> {
  const rows = await ctx.db.whistleblowingManager.findMany({
    orderBy: [{ responsible: "desc" }, { addedAt: "asc" }],
    select: { membershipId: true, responsible: true },
  });
  const ids = rows.map((row) => row.membershipId);
  const people = await ctx.db.membership.findMany({
    where: { id: { in: ids } },
    select: { id: true, user: { select: { email: true, name: true } } },
  });
  const eligible = await eligibleManagers(ctx.db, ids);
  const byId = new Map(people.map((person) => [person.id, person]));
  return rows.map((row) => {
    const person = byId.get(row.membershipId);
    return {
      membershipId: row.membershipId,
      name: person?.user.name ?? "",
      email: person?.user.email ?? "",
      responsible: row.responsible,
      eligible: eligible.has(row.membershipId),
    };
  });
}

async function viewOf(
  ctx: AdminContext,
  deps: Deps,
  auth: AuthContext,
  settings: WhistleblowingSettings,
): Promise<ChannelSettingsView> {
  return {
    enabled: settings.enabled,
    categories: categoriesOf(settings),
    defaultCategories: settings.categories.length === 0,
    intro: settings.intro,
    externalChannels: settings.externalChannels,
    retentionYears: settings.retentionYears,
    managers: await managersOf(ctx),
    keyConfigured: deps.env.EMAIL_ENCRYPTION_KEY !== undefined,
    ownMfa: await ownMfa(deps, auth),
  };
}

export async function getChannelSettings(
  ctx: AdminContext,
  deps: Deps,
  auth: AuthContext,
): Promise<ChannelSettingsView> {
  return await viewOf(
    ctx,
    deps,
    auth,
    readWhistleblowingSettings((await workspaceOf(ctx)).settings),
  );
}

export async function updateChannelSettings(
  ctx: AdminContext,
  deps: Deps,
  auth: AuthContext,
  input: UpdateChannelInput,
): Promise<ChannelSettingsView> {
  await requireOwnerMfa(deps, auth);
  const workspace = await workspaceOf(ctx);
  const before = readWhistleblowingSettings(workspace.settings);
  const after: WhistleblowingSettings = {
    enabled: input.enabled ?? before.enabled,
    categories: input.categories ?? before.categories,
    intro: input.intro ?? before.intro,
    externalChannels: input.externalChannels ?? before.externalChannels,
    retentionYears: input.retentionYears ?? before.retentionYears,
  };
  if (after.enabled && !before.enabled) {
    boxOf(deps.env);
    const responsible = await ctx.db.whistleblowingManager.findFirst({
      where: { responsible: true },
      select: { membershipId: true },
    });
    if (
      responsible === null ||
      !(await eligibleManagers(ctx.db, [responsible.membershipId])).has(responsible.membershipId)
    ) {
      throw new AppError("BAD_REQUEST", { message: whistleblowingTexts.needsResponsible });
    }
  }
  const current =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Record<string, unknown>)
      : {};
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: { settings: { ...current, whistleblowing: after } },
  });
  if (after.enabled !== before.enabled) {
    await auditAdmin(ctx, {
      action: after.enabled ? "whistleblowing.enable" : "whistleblowing.disable",
      entityType: "Workspace",
      entityId: workspace.id,
    });
  } else {
    await auditAdmin(ctx, {
      action: "whistleblowing.settings",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: { retentionYears: after.retentionYears, categories: after.categories.length },
    });
  }
  return await viewOf(ctx, deps, auth, after);
}

/**
 * Replaces the list of managers. Exactly one of them is responsible for the system; while the channel
 * is on, that person has to be there. Everyone on the list, before and after, is told (without names).
 */
export async function setChannelManagers(
  ctx: AdminContext,
  deps: Deps,
  auth: AuthContext,
  input: ChannelManagerInput[],
): Promise<ChannelSettingsView> {
  await requireOwnerMfa(deps, auth);
  const unique = [...new Map(input.map((entry) => [entry.membershipId, entry])).values()];
  if (unique.length > whistleblowingLimits.managersMax) {
    throw new AppError("BAD_REQUEST", { message: whistleblowingTexts.tooManyManagers });
  }
  const responsibles = unique.filter((entry) => entry.responsible);
  if (responsibles.length > 1 || (unique.length > 0 && responsibles.length === 0)) {
    throw new AppError("BAD_REQUEST", { message: whistleblowingTexts.keepResponsible });
  }
  const before = await ctx.db.whistleblowingManager.findMany({
    select: { membershipId: true, responsible: true },
  });
  const known = new Set(before.map((row) => row.membershipId));
  // Whoever is added must be able to work now; someone already there may stay while they fix it.
  const added = unique.filter((entry) => !known.has(entry.membershipId));
  const eligible = await eligibleManagers(
    ctx.db,
    added.map((entry) => entry.membershipId),
  );
  if (added.some((entry) => !eligible.has(entry.membershipId))) {
    throw new AppError("BAD_REQUEST", { message: whistleblowingTexts.managerNotEligible });
  }
  const workspace = await workspaceOf(ctx);
  const settings = readWhistleblowingSettings(workspace.settings);
  if (settings.enabled && responsibles.length === 0) {
    throw new AppError("BAD_REQUEST", { message: whistleblowingTexts.keepResponsible });
  }
  const keep = new Set(unique.map((entry) => entry.membershipId));
  const removed = before
    .filter((row) => !keep.has(row.membershipId))
    .map((row) => row.membershipId);
  await ctx.db.$transaction(async (tx) => {
    await tx.whistleblowingManager.deleteMany({ where: { membershipId: { in: removed } } });
    for (const entry of unique) {
      await tx.whistleblowingManager.upsert({
        where: {
          workspaceId_membershipId: {
            workspaceId: tx.workspaceId,
            membershipId: entry.membershipId,
          },
        },
        create: {
          membershipId: entry.membershipId,
          responsible: entry.responsible,
          addedById: ctx.tenant.membershipId,
        },
        update: { responsible: entry.responsible },
      });
    }
  });
  const responsibleBefore = before.find((row) => row.responsible)?.membershipId ?? null;
  const responsibleAfter = responsibles[0]?.membershipId ?? null;
  if (added.length > 0 || removed.length > 0 || responsibleBefore !== responsibleAfter) {
    await auditAdmin(ctx, {
      action: "whistleblowing.managers",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: {
        added: added.map((entry) => entry.membershipId).join(","),
        removed: removed.join(","),
        responsible: responsibleAfter,
      },
    });
    const told = new Set([...before.map((row) => row.membershipId), ...keep]);
    told.delete(ctx.tenant.membershipId);
    for (const membershipId of told) {
      await ctx.db.notification.create({
        data: {
          membershipId,
          kind: "whistleblowing",
          actorId: ctx.tenant.membershipId,
          detail: "managers",
        },
        select: { id: true },
      });
    }
  }
  return await viewOf(ctx, deps, auth, settings);
}

/** For the routes: who is asking, from the request. */
export function authOf(req: Request): AuthContext {
  if (req.auth === undefined) throw new AppError("UNAUTHENTICATED");
  return req.auth;
}
