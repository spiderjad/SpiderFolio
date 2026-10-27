// Alta de un workspace con su dueño (CLAUDE.md, sección 7.2): el workspace, los 4 roles de
// sistema y la membresía OWNER. Sin planes ni prueba: no hay suscripción. Corre dentro de la transacción de
// quien lo llama (el registro también crea el usuario y la sesión en la misma); si otro alta
// tomó el mismo slug entretanto, withSlugRetry repite la transacción entera.
import { forTenant } from "../../db/tenant.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { violatedUniqueIndex } from "../../lib/prisma-errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { firstFreeSlug, slugify } from "../../lib/slug.ts";
import { audit } from "../audit/audit.service.ts";
import { systemRoles } from "../roles/capabilities.ts";
import { WorkspaceSettingsSchema, type WorkspaceSettings } from "./settings.ts";
import { defaultDataTexts } from "../../i18n/index.ts";

export interface CreateWorkspaceInput {
  name: string;
  ownerUserId: string;
  settings: WorkspaceSettings;
  request?: { ip?: string | null; userAgent?: string | null };
}

export interface CreatedWorkspace {
  workspaceId: string;
  slug: string;
  membershipId: string;
}

const MAX_SLUG_ATTEMPTS = 5;

/** Repite fn si falla por un slug de workspace tomado por otra alta simultánea. */
export async function withSlugRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const slugTaken = violatedUniqueIndex(error) === "Workspace_slug_key";
      if (!slugTaken || attempt >= MAX_SLUG_ATTEMPTS) throw error;
    }
  }
}

export async function createWorkspaceWithOwner(
  tx: Prisma.TransactionClient,
  input: CreateWorkspaceInput,
): Promise<CreatedWorkspace> {
  const settings = WorkspaceSettingsSchema.parse(input.settings);

  const base = slugify(input.name);
  const taken = await tx.workspace.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  const slug = firstFreeSlug(base, new Set(taken.map((w) => w.slug)));

  const workspace = await tx.workspace.create({
    data: { name: input.name, slug, settings },
    select: { id: true },
  });
  const db = forTenant(tx, workspace.id);

  const roles = await db.role.createManyAndReturn({
    data: systemRoles.map((role) => ({
      name: defaultDataTexts.roles[role.base].name,
      description: defaultDataTexts.roles[role.base].description,
      base: role.base,
      capabilities: [...role.capabilities],
      isSystem: true,
    })),
    select: { id: true, base: true },
  });
  const ownerRole = roles.find((role) => role.base === "OWNER");
  if (ownerRole === undefined) throw new Error("Falta el rol de sistema OWNER");

  const membership = await db.membership.create({
    data: { userId: input.ownerUserId, roleId: ownerRole.id, seatType: "FULL" },
    select: { id: true },
  });
  await audit(db, {
    actorId: input.ownerUserId,
    action: "workspace.create",
    entityType: "workspace",
    entityId: workspace.id,
    ip: input.request?.ip ?? null,
    userAgent: input.request?.userAgent ?? null,
  });
  return { workspaceId: workspace.id, slug, membershipId: membership.id };
}

/** Alta suelta (seed, tests): su propia transacción, con reintento por slug. */
export async function createWorkspace(
  prisma: PrismaClient,
  input: CreateWorkspaceInput,
): Promise<CreatedWorkspace> {
  return await withSlugRetry(() =>
    prisma.$transaction((tx) => createWorkspaceWithOwner(tx, input)),
  );
}
