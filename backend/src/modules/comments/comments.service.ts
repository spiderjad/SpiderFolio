// Comentarios de una página: hilos generales o anclados a un fragmento (la marca `commentThread`
// del documento lleva el id del hilo), con respuestas, resolver y reabrir. Ver los hilos pide VIEW;
// comentar, responder y editar o borrar los propios pide COMMENT (los lectores pueden); resolver lo
// hace quien abrió el hilo o quien edita la página; borrar lo ajeno, MANAGE.
import type { AccessLevel } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { atLeast } from "../access/access.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { commentLevel } from "../documents/review-access.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { userMediaUrl } from "../profile-media/profile-media.service.ts";
import {
  mentionIdsOf,
  recordMentions,
  type MentionDeps,
  type MentionOutcome,
} from "./mentions.service.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import type { CreateThreadInput, ListThreadsQuery } from "./comments.schemas.ts";
import { contentMessages } from "../../i18n/index.ts";

export interface CommentView {
  id: string;
  author: { id: string; name: string; avatarUrl: string | null } | null;
  /** Vacío si lo borraron (queda el hueco por las respuestas). */
  body: string;
  deleted: boolean;
  createdAt: Date;
  editedAt: Date | null;
  mine: boolean;
  canDelete: boolean;
}

export interface ThreadView {
  id: string;
  /** Texto del fragmento comentado (null en un comentario general). */
  quote: string | null;
  status: "OPEN" | "RESOLVED";
  createdAt: Date;
  mine: boolean;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  canResolve: boolean;
  comments: CommentView[];
}

async function loadPage(ctx: AdminContext, pageId: string) {
  const page = await ctx.db.node.findFirst({
    where: { id: pageId, trashedAt: null, type: "PAGE" },
    select: { id: true, spaceId: true },
  });
  if (page === null) throw notFound();
  return page;
}

const threadSelect = {
  id: true,
  quote: true,
  status: true,
  createdAt: true,
  createdById: true,
  resolvedById: true,
  resolvedAt: true,
} as const;

async function toViews(
  ctx: AdminContext,
  level: AccessLevel,
  threads: readonly {
    id: string;
    quote: string | null;
    status: string;
    createdAt: Date;
    createdById: string;
    resolvedById: string | null;
    resolvedAt: Date | null;
  }[],
): Promise<ThreadView[]> {
  if (threads.length === 0) return [];
  const comments = await ctx.db.comment.findMany({
    where: { threadId: { in: threads.map((thread) => thread.id) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const people = await ctx.db.membership.findMany({
    where: {
      id: {
        in: [
          ...new Set([
            ...comments.map((comment) => comment.authorId),
            ...threads.flatMap((thread) =>
              thread.resolvedById === null ? [] : [thread.resolvedById],
            ),
          ]),
        ],
      },
    },
    select: { id: true, user: { select: { id: true, name: true, avatarKey: true } } },
  });
  const byId = new Map(people.map((person) => [person.id, person.user]));
  const me = ctx.tenant.membershipId;
  const canManage = atLeast(level, "MANAGE");
  const canEdit = atLeast(level, "EDIT");
  return threads.map((thread) => ({
    id: thread.id,
    quote: thread.quote,
    status: thread.status === "RESOLVED" ? "RESOLVED" : "OPEN",
    createdAt: thread.createdAt,
    mine: thread.createdById === me,
    resolvedBy: thread.resolvedById === null ? null : (byId.get(thread.resolvedById)?.name ?? null),
    resolvedAt: thread.resolvedAt,
    canResolve: thread.createdById === me || canEdit,
    comments: comments
      .filter((comment) => comment.threadId === thread.id)
      .map((comment) => {
        const author = byId.get(comment.authorId);
        const deleted = comment.deletedAt !== null;
        return {
          id: comment.id,
          author:
            author === undefined
              ? null
              : {
                  id: comment.authorId,
                  name: author.name,
                  avatarUrl: userMediaUrl("avatar", author.id, author.avatarKey),
                },
          body: deleted ? "" : comment.body,
          deleted,
          createdAt: comment.createdAt,
          editedAt: comment.editedAt,
          mine: comment.authorId === me,
          canDelete: !deleted && (comment.authorId === me || canManage),
        };
      }),
  }));
}

export async function listThreads(
  ctx: AdminContext,
  pageId: string,
  query: ListThreadsQuery,
): Promise<Page<ThreadView>> {
  await loadPage(ctx, pageId);
  const level = requireLevel(await levelOfNode(ctx, pageId), "VIEW");
  const where = {
    nodeId: pageId,
    ...(query.status === "all" ? {} : { status: query.status === "open" ? "OPEN" : "RESOLVED" }),
    ...(query.mine ? { createdById: ctx.tenant.membershipId } : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.commentThread.findMany({
      where,
      select: threadSelect,
      orderBy: stableOrder({ createdAt: query.dir === "asc" ? "asc" : "desc" }),
      ...offsetArgs(query),
    }),
    ctx.db.commentThread.count({ where }),
  ]);
  return pageOf(await toViews(ctx, level, rows), total, query);
}

/** Quién puede comentar la página (y que el espacio no esté archivado). */
async function assertCanComment(
  ctx: AdminContext,
  pageId: string,
): Promise<{ level: AccessLevel; spaceId: string }> {
  const page = await loadPage(ctx, pageId);
  // Quien revisa el documento comenta aunque solo lo vea (el texto sigue congelado).
  const level = requireLevel(
    await commentLevel(ctx.db, pageId, ctx.tenant.membershipId, await levelOfNode(ctx, pageId)),
    "COMMENT",
  );
  await assertSpaceWritable(ctx, page.spaceId);
  return { level, spaceId: page.spaceId };
}

async function loadThread(ctx: AdminContext, pageId: string, threadId: string) {
  const thread = await ctx.db.commentThread.findFirst({
    where: { id: threadId, nodeId: pageId },
    select: threadSelect,
  });
  if (thread === null) throw notFound();
  return thread;
}

async function oneView(ctx: AdminContext, level: AccessLevel, pageId: string, threadId: string) {
  const [view] = await toViews(ctx, level, [await loadThread(ctx, pageId, threadId)]);
  if (view === undefined) throw notFound();
  return view;
}

export interface ThreadResult extends MentionOutcome {
  thread: ThreadView;
}

export async function createThread(
  ctx: AdminContext,
  deps: MentionDeps,
  pageId: string,
  input: CreateThreadInput,
): Promise<ThreadResult> {
  const { level, spaceId } = await assertCanComment(ctx, pageId);
  const created = await ctx.db.$transaction(async (tx) => {
    const thread = await tx.commentThread.create({
      data: {
        nodeId: pageId,
        quote: input.quote ?? null,
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    const first = await tx.comment.create({
      data: { threadId: thread.id, authorId: ctx.tenant.membershipId, body: input.body },
      select: { id: true },
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "comment.create",
        entityType: "Node",
        entityId: pageId,
        metadata: { threadId: thread.id, anchored: input.quote !== undefined },
      },
    );
    return { threadId: thread.id, commentId: first.id };
  });
  const outcome = await recordMentions(
    ctx,
    deps,
    { id: pageId, spaceId },
    mentionIdsOf(input.body),
    created.commentId,
  );
  return { thread: await oneView(ctx, level, pageId, created.threadId), ...outcome };
}

export async function reply(
  ctx: AdminContext,
  deps: MentionDeps,
  pageId: string,
  threadId: string,
  body: string,
): Promise<ThreadResult> {
  const { level, spaceId } = await assertCanComment(ctx, pageId);
  const thread = await loadThread(ctx, pageId, threadId);
  if (thread.status !== "OPEN") {
    throw new AppError("CONFLICT", { message: contentMessages.threadResolved });
  }
  const created = await ctx.db.comment.create({
    data: { threadId, authorId: ctx.tenant.membershipId, body },
    select: { id: true },
  });
  const outcome = await recordMentions(
    ctx,
    deps,
    { id: pageId, spaceId },
    mentionIdsOf(body),
    created.id,
  );
  return { thread: await oneView(ctx, level, pageId, threadId), ...outcome };
}

async function loadComment(ctx: AdminContext, threadId: string, commentId: string) {
  const comment = await ctx.db.comment.findFirst({ where: { id: commentId, threadId } });
  if (comment === null) throw notFound();
  return comment;
}

export async function editComment(
  ctx: AdminContext,
  deps: MentionDeps,
  pageId: string,
  threadId: string,
  commentId: string,
  body: string,
): Promise<ThreadResult> {
  const { level, spaceId } = await assertCanComment(ctx, pageId);
  await loadThread(ctx, pageId, threadId);
  const comment = await loadComment(ctx, threadId, commentId);
  if (comment.deletedAt !== null) throw notFound();
  // Solo se edita lo propio.
  if (comment.authorId !== ctx.tenant.membershipId) throw forbidden();
  await ctx.db.comment.update({ where: { id: commentId }, data: { body, editedAt: new Date() } });
  // Las menciones agregadas al editar avisan; las que ya estaban, no.
  const outcome = await recordMentions(
    ctx,
    deps,
    { id: pageId, spaceId },
    mentionIdsOf(body),
    commentId,
  );
  return { thread: await oneView(ctx, level, pageId, threadId), ...outcome };
}

export interface DeleteResult {
  /** El hilo entero se borró (era el único mensaje): hay que quitar su marca del texto. */
  threadDeleted: boolean;
  thread: ThreadView | null;
}

export async function deleteComment(
  ctx: AdminContext,
  pageId: string,
  threadId: string,
  commentId: string,
): Promise<DeleteResult> {
  const { level } = await assertCanComment(ctx, pageId);
  await loadThread(ctx, pageId, threadId);
  const comment = await loadComment(ctx, threadId, commentId);
  if (comment.deletedAt !== null) throw notFound();
  if (comment.authorId !== ctx.tenant.membershipId && !atLeast(level, "MANAGE")) throw forbidden();
  const others = await ctx.db.comment.count({
    where: { threadId, deletedAt: null, NOT: { id: commentId } },
  });
  if (others === 0) {
    // Era lo único que decía el hilo: se va entero.
    await ctx.db.commentThread.deleteMany({ where: { id: threadId } });
    return { threadDeleted: true, thread: null };
  }
  await ctx.db.comment.update({
    where: { id: commentId },
    data: { deletedAt: new Date(), body: "" },
  });
  return { threadDeleted: false, thread: await oneView(ctx, level, pageId, threadId) };
}

export async function setResolved(
  ctx: AdminContext,
  pageId: string,
  threadId: string,
  resolved: boolean,
): Promise<ThreadView> {
  const { level } = await assertCanComment(ctx, pageId);
  const thread = await loadThread(ctx, pageId, threadId);
  if (thread.createdById !== ctx.tenant.membershipId && !atLeast(level, "EDIT")) throw forbidden();
  await ctx.db.commentThread.update({
    where: { id: threadId },
    data: resolved
      ? { status: "RESOLVED", resolvedById: ctx.tenant.membershipId, resolvedAt: new Date() }
      : { status: "OPEN", resolvedById: null, resolvedAt: null },
  });
  await auditAdmin(ctx, {
    action: resolved ? "comment.resolve" : "comment.reopen",
    entityType: "Node",
    entityId: pageId,
    metadata: { threadId },
  });
  return await oneView(ctx, level, pageId, threadId);
}
