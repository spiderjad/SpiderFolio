// The contractor's portal, host side (docs/spec/cae.md, «Portal de contratas»): whoever manages CAE
// issues a link with a code for one company (shown once: only its hash is kept), sees when it was last
// used and revokes it. One active access per company: issuing a new one revokes the previous one and
// ends its sessions.
import { caeLimits } from "@spiderfolio/limits";
import { AppError, forbidden } from "../../lib/errors.ts";
import { caeTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { newPortalCode, portalCodeHash } from "./cae-portal-codes.ts";
import { accessOf, loadCompany } from "./cae.service.ts";
import { canManageCae, requireCae } from "./safety-access.ts";

export interface PortalAccessView {
  id: string;
  url: string;
  createdAt: Date;
  createdBy: { id: string; name: string };
  expiresAt: Date;
  lastUsedAt: Date | null;
  /** Too many wrong codes: it has to be issued again. */
  locked: boolean;
  expired: boolean;
  email: string | null;
}

export const portalUrl = (appUrl: string, accessId: string): string =>
  `${appUrl.replace(/\/$/u, "")}/contratas/${accessId}`;

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireCae(ctx);
  if (!canManageCae(ctx)) throw forbidden();
}

/** The company's active access (not revoked), if any. */
export async function getPortalAccess(
  ctx: AdminContext,
  appUrl: string,
  companyId: string,
): Promise<PortalAccessView | null> {
  await requireManager(ctx);
  await loadCompany(ctx, await accessOf(ctx), companyId);
  const row = await ctx.db.caePortalAccess.findFirst({
    where: { companyId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (row === null) return null;
  const issuer = await ctx.db.membership.findFirst({
    where: { id: row.createdById },
    select: { user: { select: { name: true } } },
  });
  return {
    id: row.id,
    url: portalUrl(appUrl, row.id),
    createdAt: row.createdAt,
    createdBy: { id: row.createdById, name: issuer?.user.name ?? "" },
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    locked: row.failedAttempts >= caeLimits.portalMaxFailedAttempts,
    expired: row.expiresAt <= new Date(),
    email: row.email,
  };
}

/** Revokes the company's active access and ends its sessions (inside the caller's transaction). */
async function revokeActive(
  db: AdminContext["db"],
  companyId: string,
  by: string,
): Promise<string[]> {
  const active = await db.caePortalAccess.findMany({
    where: { companyId, revokedAt: null },
    select: { id: true },
  });
  if (active.length === 0) return [];
  const ids = active.map((row) => row.id);
  const now = new Date();
  await db.caePortalAccess.updateMany({
    where: { id: { in: ids } },
    data: { revokedAt: now, revokedById: by },
  });
  await db.caePortalSession.updateMany({
    where: { accessId: { in: ids }, endedAt: null },
    data: { endedAt: now },
  });
  return ids;
}

/** A new access: the link and the code, the code only this once. */
export async function issuePortalAccess(
  ctx: AdminContext,
  appUrl: string,
  companyId: string,
  input: { days: number; email?: string | null | undefined },
): Promise<{ access: PortalAccessView; code: string }> {
  await requireManager(ctx);
  const company = await loadCompany(ctx, await accessOf(ctx), companyId);
  if (company.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.archived });
  }
  const days = Math.min(Math.max(1, input.days), caeLimits.portalAccessMaxDays);
  const code = newPortalCode();
  const id = crypto.randomUUID();
  const { revoked } = await ctx.db.$transaction(async (tx) => {
    const previous = await revokeActive(tx, companyId, ctx.tenant.membershipId);
    await tx.caePortalAccess.create({
      data: {
        id,
        companyId,
        codeHash: portalCodeHash(id, code),
        createdById: ctx.tenant.membershipId,
        expiresAt: new Date(Date.now() + days * 86_400_000),
        email: input.email ?? null,
      },
      select: { id: true },
    });
    return { revoked: previous };
  });
  // Never the code, not even hashed.
  await auditAdmin(ctx, {
    action: "cae.portal.issue",
    entityType: "CaeCompany",
    entityId: companyId,
    metadata: { portalAccessId: id, days, revoked },
  });
  const access = await getPortalAccess(ctx, appUrl, companyId);
  if (access === null) throw new Error("portal access not created");
  return { access, code };
}

export async function revokePortalAccess(ctx: AdminContext, companyId: string): Promise<void> {
  await requireManager(ctx);
  await loadCompany(ctx, await accessOf(ctx), companyId);
  const revoked = await ctx.db.$transaction((tx) =>
    revokeActive(tx, companyId, ctx.tenant.membershipId),
  );
  if (revoked.length === 0) return;
  await auditAdmin(ctx, {
    action: "cae.portal.revoke",
    entityType: "CaeCompany",
    entityId: companyId,
    metadata: { portalAccessIds: revoked },
  });
}
