// Menciones con @ (en el texto de una página y en comentarios). Mencionar solo AVISA: nunca da
// acceso. A quien no tiene acceso a la página no se le escribe (el aviso nombraría la página): la
// mención queda pendiente, quien menciona recibe la lista de personas sin acceso y, si puede
// gestionar la página, ofrece darles acceso; al darlo se envía el aviso pendiente.
import type { AccessLevel } from "../../generated/prisma/client.ts";
import type { Jobs } from "../../jobs/boss.ts";
import { AppError } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { loadTenantContext } from "../../middleware/tenant.ts";
import { accessActorOf, loadAccess } from "../access/access.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { DirectoryQuerySchema } from "../directory/directory.schemas.ts";
import { listDirectory } from "../directory/directory.service.ts";
import type { AppDeps } from "../../routes.ts";
import { userMediaUrl } from "../profile-media/profile-media.service.ts";

export interface MentionDeps {
  prisma: PrismaClient;
  jobs: Pick<Jobs, "enqueue">;
}

/** Dependencias de este módulo, tomadas de las de la app. */
export function mentionDepsOf(deps: AppDeps): MentionDeps {
  return { prisma: deps.prisma, jobs: deps.jobs };
}

/** En el cuerpo de un comentario, una mención se escribe `@[Nombre](id de la membresía)`. */
const MENTION_TOKEN = /@\[[^\]\n]{1,80}\]\(([a-z0-9]{10,40})\)/gu;

export function mentionIdsOf(body: string): string[] {
  return [
    ...new Set([...body.matchAll(MENTION_TOKEN)].flatMap((match) => (match[1] ? [match[1]] : []))),
  ];
}

/** Nivel de acceso de otras personas sobre una página (null: no la ven). */
export async function accessOfMembers(
  ctx: AdminContext,
  deps: Pick<MentionDeps, "prisma">,
  pageId: string,
  spaceId: string,
  membershipIds: readonly string[],
): Promise<Map<string, AccessLevel | null>> {
  const result = new Map<string, AccessLevel | null>();
  const people = await ctx.db.membership.findMany({
    where: { id: { in: [...membershipIds] }, status: "ACTIVE" },
    select: { id: true, userId: true },
  });
  for (const person of people) {
    const loaded = await loadTenantContext(
      deps.prisma,
      { id: ctx.tenant.workspaceId },
      person.userId,
    );
    if (loaded === null) {
      result.set(person.id, null);
      continue;
    }
    const access = await loadAccess(loaded.db, accessActorOf({ tenant: loaded.tenant }), {
      nodeIds: [pageId],
      spaceIds: [spaceId],
    });
    result.set(person.id, access.ofNode(pageId));
  }
  return result;
}

export interface MentionOutcome {
  /** Personas mencionadas que no ven la página (no se les avisó). */
  withoutAccess: { id: string; name: string }[];
}

/**
 * Registra las menciones nuevas y avisa por email a quienes ven la página. Una mención ya
 * registrada (misma página sin comentario, o mismo comentario) no vuelve a avisar.
 */
export async function recordMentions(
  ctx: AdminContext,
  deps: MentionDeps,
  page: { id: string; spaceId: string },
  ids: readonly string[],
  commentId: string | null,
): Promise<MentionOutcome> {
  const wanted = [...new Set(ids)].filter((id) => id !== ctx.tenant.membershipId);
  if (wanted.length === 0) return { withoutAccess: [] };
  const people = await ctx.db.membership.findMany({
    where: { id: { in: wanted }, status: "ACTIVE" },
    select: { id: true, user: { select: { name: true } } },
  });
  const already = await ctx.db.mention.findMany({
    where: { nodeId: page.id, commentId, mentionedId: { in: people.map((person) => person.id) } },
    select: { mentionedId: true },
  });
  const known = new Set(already.map((row) => row.mentionedId));
  const fresh = people.filter((person) => !known.has(person.id));
  if (fresh.length === 0) return { withoutAccess: [] };
  const access = await accessOfMembers(
    ctx,
    deps,
    page.id,
    page.spaceId,
    fresh.map((person) => person.id),
  );
  const withoutAccess: { id: string; name: string }[] = [];
  for (const person of fresh) {
    const sees = access.get(person.id) !== null && access.get(person.id) !== undefined;
    const mention = await ctx.db.mention.create({
      data: {
        nodeId: page.id,
        commentId,
        mentionedId: person.id,
        createdById: ctx.tenant.membershipId,
        ...(sees ? { notifiedAt: new Date() } : {}),
      },
      select: { id: true },
    });
    if (sees) await deps.jobs.enqueue("email-send", { kind: "mention", mentionId: mention.id });
    else withoutAccess.push({ id: person.id, name: person.user.name });
  }
  return { withoutAccess };
}

export interface MentionCandidate {
  id: string;
  name: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  /** Ya ve la página: si no, al mencionarla se ofrece darle acceso. */
  hasAccess: boolean;
}

/** Personas que se pueden mencionar (las que el directorio le muestra a quien pregunta). */
export async function mentionCandidates(
  ctx: AdminContext,
  deps: Pick<MentionDeps, "prisma">,
  pageId: string,
  q: string,
): Promise<MentionCandidate[]> {
  const page = await ctx.db.node.findFirst({
    where: { id: pageId, trashedAt: null, type: "PAGE" },
    select: { id: true, spaceId: true },
  });
  if (page === null) throw new AppError("NOT_FOUND");
  requireLevel(await levelOfNode(ctx, pageId), "VIEW");
  const found = await listDirectory(ctx, DirectoryQuerySchema.parse({ q, pageSize: 8 }));
  const ids = found.items.map((entry) => entry.id);
  const [access, avatars] = await Promise.all([
    accessOfMembers(ctx, deps, pageId, page.spaceId, ids),
    ctx.db.membership.findMany({
      where: { id: { in: ids } },
      select: { id: true, user: { select: { id: true, avatarKey: true } } },
    }),
  ]);
  const avatarOf = new Map(avatars.map((row) => [row.id, row.user]));
  return found.items.map((entry) => ({
    id: entry.id,
    name: entry.name,
    jobTitle: entry.jobTitle,
    avatarUrl: (() => {
      const user = avatarOf.get(entry.id);
      return user === undefined ? null : userMediaUrl("avatar", user.id, user.avatarKey);
    })(),
    hasAccess: (access.get(entry.id) ?? null) !== null,
  }));
}
