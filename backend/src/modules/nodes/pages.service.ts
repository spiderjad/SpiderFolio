// Páginas (nodos PAGE): documentos tipo Notion dentro del árbol, con los mismos permisos que
// carpetas y archivos (resolveAccess). El texto es un documento Tiptap que `packages/content`
// valida y deja en su forma canónica; el guardado es optimista: cada página tiene una `revision` y
// quien guarda dice sobre cuál se basó (si otra persona guardó antes, 409 y se vuelve a pedir).
import { EMPTY_DOC, validateContent, withoutThreadMarks } from "@spiderfolio/content";
import { randomBytes, randomUUID } from "node:crypto";
import { bytesToJson } from "@spiderfolio/limits";
import type { JSONContent } from "@tiptap/core";
import type { DocStatus, Prisma } from "../../generated/prisma/client.ts";
import type { Storage } from "../../lib/storage.ts";
import { assertStorageRoom, lockWorkspace } from "../files/files.service.ts";
import { contentMessages } from "../../i18n/index.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf, numberedName } from "../../lib/names.ts";
import { atLeast } from "../access/access.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { ensureDraftVersion } from "../documents/controlled-guard.ts";
import { commentLevel, isReviewing } from "../documents/review-access.ts";
import { publishedPageSnapshot } from "../documents/documents.service.ts";
import { recordMentions, type MentionDeps } from "../comments/mentions.service.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import type { CreatePageInput, SavePageInput } from "./nodes.schemas.ts";
import {
  assertDestination,
  getNode,
  lastPosition,
  nodeSelect,
  type NodeDetail,
} from "./nodes.service.ts";

/** Cómo se ve la página si es un documento controlado. */
export interface PageControlled {
  code: string;
  status: DocStatus;
  publishedVersion: number | null;
  /** «published»: se muestra la versión vigente (quien no edita); «draft»: el borrador de trabajo. */
  showing: "published" | "draft";
  /** Está revisando este documento: ve lo que se revisa y puede comentarlo. */
  reviewer: boolean;
}

export interface PageDetail extends NodeDetail {
  controlled: PageControlled | null;
  content: Prisma.JsonValue;
  /** Sobre qué revisión se basa quien edita; se manda de vuelta al guardar. */
  revision: number;
  updatedAt: Date;
  updatedBy: { id: string; name: string } | null;
}

async function loadPage(ctx: AdminContext, id: string) {
  const row = await ctx.db.node.findFirst({
    where: { id, trashedAt: null, type: "PAGE" },
    select: { ...nodeSelect, nameKey: true },
  });
  if (row === null) throw notFound();
  return row;
}

/** «Sin título», «Sin título (2)»…: un nombre libre entre los hermanos. */
async function freeName(
  ctx: AdminContext,
  spaceId: string,
  parentId: string | null,
  base: string,
): Promise<string> {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : numberedName(base, n);
    const taken = await ctx.db.node.count({
      where: { spaceId, parentId, nameKey: nameKeyOf(candidate), trashedAt: null },
    });
    if (taken === 0) return candidate;
  }
  throw new AppError("CONFLICT", { message: contentMessages.nameTaken });
}

export async function createPage(
  ctx: AdminContext,
  spaceId: string,
  input: CreatePageInput,
): Promise<PageDetail> {
  const parentId = input.parentId ?? null;
  await assertDestination(ctx, spaceId, parentId);
  const requested = input.name === undefined ? "" : cleanName(input.name);
  const name = await freeName(
    ctx,
    spaceId,
    parentId,
    requested === "" ? contentMessages.untitledPage : requested,
  );
  // Una plantilla: se valida igual que cualquier texto; sin imágenes, menciones ni hilos (no existen aún).
  let initial = EMPTY_DOC;
  let text = "";
  if (input.content !== undefined) {
    const checked = validateContent(input.content);
    if (
      !checked.ok ||
      checked.imageIds.length + checked.mentionIds.length + checked.threadIds.length > 0
    ) {
      throw new AppError("BAD_REQUEST", { message: contentMessages.pageInvalid });
    }
    initial = checked.content;
    text = checked.text;
  }
  const id = await ctx.db.$transaction(async (tx) => {
    const created = await tx.node.create({
      data: {
        spaceId,
        parentId,
        type: "PAGE",
        name,
        nameKey: nameKeyOf(name),
        position: await lastPosition({ db: tx }, spaceId, parentId),
        createdById: ctx.tenant.membershipId,
        updatedById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    await tx.pageContent.create({
      data: {
        nodeId: created.id,
        content: initial,
        textPlain: text,
        updatedById: ctx.tenant.membershipId,
      },
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "page.create",
        entityType: "Node",
        entityId: created.id,
        metadata: { name, parentId },
      },
    );
    return created.id;
  });
  return await getPage(ctx, id);
}

export async function getPage(ctx: AdminContext, id: string): Promise<PageDetail> {
  await loadPage(ctx, id);
  const detail = await getNode(ctx, id);
  const page = await ctx.db.pageContent.findFirst({ where: { nodeId: id } });
  if (page === null) throw notFound();
  const author = await ctx.db.membership.findFirst({
    where: { id: page.updatedById },
    select: { id: true, user: { select: { name: true } } },
  });
  // Documento controlado: quien no edita lee la versión vigente, no el borrador de trabajo.
  const controlledRow = await ctx.db.controlledDocument.findFirst({ where: { nodeId: id } });
  let content: Prisma.JsonValue = page.content;
  let controlled: PageControlled | null = null;
  if (controlledRow !== null) {
    const latest = await ctx.db.documentVersion.findFirst({
      where: { nodeId: id },
      orderBy: { version: "desc" },
      select: { status: true },
    });
    const published = await publishedPageSnapshot(ctx, id);
    const reviewer = await isReviewing(ctx.db, id, ctx.tenant.membershipId);
    // Quien revisa ve lo que está en revisión, no la versión vigente.
    const showPublished = published !== null && !atLeast(detail.node.level, "EDIT") && !reviewer;
    if (showPublished) content = published.content as Prisma.JsonValue;
    controlled = {
      code: controlledRow.code,
      status: latest?.status ?? "DRAFT",
      publishedVersion: controlledRow.publishedVersion,
      showing: showPublished ? "published" : "draft",
      reviewer,
    };
  }
  return {
    ...detail,
    controlled,
    content,
    revision: page.revision,
    updatedAt: page.updatedAt,
    updatedBy: author === null ? null : { id: author.id, name: author.user.name },
  };
}

export interface SavedPage {
  revision: number;
  updatedAt: Date;
  /** Personas mencionadas que no ven la página (no se les avisó). */
  withoutAccess: { id: string; name: string }[];
}

export async function savePage(
  ctx: AdminContext,
  deps: MentionDeps,
  id: string,
  input: SavePageInput,
): Promise<SavedPage> {
  const row = await loadPage(ctx, id);
  // Editar el texto pide EDIT; quien solo puede comentar (COMMENT) guarda únicamente lo que agrega o
  // quita marcas de comentarios anclados, y nada más.
  const level = requireLevel(
    await commentLevel(ctx.db, id, ctx.tenant.membershipId, await levelOfNode(ctx, id)),
    "COMMENT",
  );
  await assertSpaceWritable(ctx, row.spaceId);

  const checked = validateContent(input.content);
  if (!checked.ok) {
    if (checked.issue === "too_large") {
      throw new AppError("PAYLOAD_TOO_LARGE", { message: contentMessages.pageTooLarge });
    }
    throw new AppError("BAD_REQUEST", {
      message:
        checked.issue === "unsafe_link" ? contentMessages.pageUnsafe : contentMessages.pageInvalid,
    });
  }
  const stored = await ctx.db.pageContent.findFirst({
    where: { nodeId: id },
    select: { content: true },
  });
  const before = validateContent(stored?.content);
  if (!atLeast(level, "EDIT")) {
    if (
      !before.ok ||
      JSON.stringify(withoutThreadMarks(before.content)) !==
        JSON.stringify(withoutThreadMarks(checked.content))
    ) {
      throw forbidden();
    }
  }
  if (checked.threadIds.length > 0) {
    const own = await ctx.db.commentThread.count({
      where: { nodeId: id, id: { in: checked.threadIds } },
    });
    if (own !== checked.threadIds.length) {
      throw new AppError("BAD_REQUEST", { message: contentMessages.pageInvalid });
    }
  }
  // Solo imágenes de esta página, ya confirmadas, y personas de esta empresa.
  if (checked.imageIds.length > 0) {
    const own = await ctx.db.pageImage.count({
      where: { nodeId: id, id: { in: checked.imageIds }, confirmedAt: { not: null } },
    });
    if (own !== checked.imageIds.length) {
      throw new AppError("BAD_REQUEST", { message: contentMessages.pageForeignImage });
    }
  }
  if (checked.mentionIds.length > 0) {
    const known = await ctx.db.membership.count({ where: { id: { in: checked.mentionIds } } });
    if (known !== checked.mentionIds.length) {
      throw new AppError("BAD_REQUEST", { message: contentMessages.pageInvalid });
    }
  }

  // Un cambio de texto (no solo comentarios anclados) sobre un documento controlado: si está en
  // revisión se rechaza, y si estaba publicado abre el borrador siguiente.
  const changesText =
    !before.ok ||
    JSON.stringify(withoutThreadMarks(before.content)) !==
      JSON.stringify(withoutThreadMarks(checked.content));
  const saved = await ctx.db.$transaction(async (tx) => {
    if (changesText) await ensureDraftVersion(tx, ctx.tenant.membershipId, id);
    // Compara y guarda de un solo paso: si otra persona guardó antes, no se pisa su trabajo.
    const updated = await tx.pageContent.updateMany({
      where: { nodeId: id, revision: input.baseRevision },
      data: {
        content: checked.content,
        textPlain: checked.text,
        revision: { increment: 1 },
        updatedById: ctx.tenant.membershipId,
      },
    });
    if (updated.count === 0) {
      throw new AppError("CONFLICT", { message: contentMessages.pageConflict });
    }
    await tx.node.update({ where: { id }, data: { updatedById: ctx.tenant.membershipId } });
    return await tx.pageContent.findFirst({
      where: { nodeId: id },
      select: { revision: true, updatedAt: true },
    });
  });
  if (saved === null) throw notFound();
  // Menciones nuevas en el texto: avisan a quien ve la página; el resto queda pendiente.
  const previous = new Set(before.ok ? before.mentionIds : []);
  const added = checked.mentionIds.filter((mentioned) => !previous.has(mentioned));
  const outcome = await recordMentions(ctx, deps, { id, spaceId: row.spaceId }, added, null);
  return { ...saved, withoutAccess: outcome.withoutAccess };
}

export interface DuplicateDeps {
  storage: Storage;
}

/** Reemplaza los ids de imagen del documento por los de sus copias. */
function remapImages(node: JSONContent, ids: ReadonlyMap<string, string>): JSONContent {
  const { content, attrs, ...rest } = node;
  const imageId: unknown = attrs?.imageId;
  return {
    ...rest,
    ...(attrs === undefined
      ? {}
      : {
          attrs:
            node.type === "pageImage" && typeof imageId === "string"
              ? { ...attrs, imageId: ids.get(imageId) ?? imageId }
              : attrs,
        }),
    ...(content === undefined ? {} : { content: content.map((child) => remapImages(child, ids)) }),
  };
}

/**
 * Duplica una página en la misma carpeta: «Nombre (copia)», con el mismo texto y copias de sus
 * imágenes (cuentan para el almacenamiento). No copia comentarios, menciones pendientes ni accesos
 * propios: la copia hereda los de su carpeta. Hace falta ver la original y poder crear donde queda.
 */
export async function duplicatePage(
  ctx: AdminContext,
  deps: DuplicateDeps,
  id: string,
): Promise<PageDetail> {
  const source = await loadPage(ctx, id);
  requireLevel(await levelOfNode(ctx, id), "VIEW");
  await assertDestination(ctx, source.spaceId, source.parentId);
  const stored = await ctx.db.pageContent.findFirst({ where: { nodeId: id } });
  if (stored === null) throw notFound();
  const checked = validateContent(stored.content);
  if (!checked.ok) throw new AppError("BAD_REQUEST", { message: contentMessages.pageInvalid });
  const name = await freeName(
    ctx,
    source.spaceId,
    source.parentId,
    `${source.name} ${contentMessages.copySuffix}`,
  );

  // Imágenes: se copian los objetos antes de tocar la base; si algo falla, se borran las copias.
  const images =
    checked.imageIds.length === 0
      ? []
      : await ctx.db.pageImage.findMany({
          where: { nodeId: id, id: { in: checked.imageIds }, confirmedAt: { not: null } },
          select: { id: true, storageKey: true, mimeType: true, sizeBytes: true },
        });
  const copies = images.map((image) => ({
    ...image,
    newId: randomUUID(),
    newKey: `${ctx.tenant.workspaceId}/${id}/img-${randomBytes(16).toString("hex")}.${image.storageKey.split(".").pop() ?? "bin"}`,
  }));
  const copied: string[] = [];
  try {
    for (const copy of copies) {
      await deps.storage.putStream(copy.newKey, await deps.storage.stream(copy.storageKey), {
        size: Number(copy.sizeBytes),
        contentType: copy.mimeType,
      });
      copied.push(copy.newKey);
    }
    const idMap = new Map(copies.map((copy) => [copy.id, copy.newId]));
    const next = validateContent(remapImages(withoutThreadMarks(checked.content), idMap));
    if (!next.ok) throw new AppError("BAD_REQUEST", { message: contentMessages.pageInvalid });
    const total = copies.reduce((sum, copy) => sum + copy.sizeBytes, 0n);
    const newId = await ctx.db.$transaction(async (tx) => {
      await lockWorkspace(tx);
      if (total > 0n) await assertStorageRoom(tx, total);
      const created = await tx.node.create({
        data: {
          spaceId: source.spaceId,
          parentId: source.parentId,
          type: "PAGE",
          name,
          nameKey: nameKeyOf(name),
          position: await lastPosition({ db: tx }, source.spaceId, source.parentId),
          createdById: ctx.tenant.membershipId,
          updatedById: ctx.tenant.membershipId,
        },
        select: { id: true },
      });
      await tx.pageContent.create({
        data: {
          nodeId: created.id,
          content: next.content,
          textPlain: next.text,
          updatedById: ctx.tenant.membershipId,
        },
      });
      for (const copy of copies) {
        await tx.pageImage.create({
          data: {
            id: copy.newId,
            nodeId: created.id,
            storageKey: copy.newKey,
            mimeType: copy.mimeType,
            sizeBytes: copy.sizeBytes,
            createdById: ctx.tenant.membershipId,
            confirmedAt: new Date(),
          },
        });
      }
      if (total > 0n) {
        const workspace = await tx.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
        await tx.workspace.update({
          where: { id: workspace.id },
          data: { storageUsedBytes: { increment: total } },
        });
      }
      await auditAdmin(
        { db: tx, info: ctx.info },
        {
          action: "page.duplicate",
          entityType: "Node",
          entityId: created.id,
          metadata: { from: id, name, images: copies.length, bytes: bytesToJson(total) },
        },
      );
      return created.id;
    });
    return await getPage(ctx, newId);
  } catch (error) {
    for (const key of copied) await deps.storage.delete(key).catch(() => undefined);
    throw error;
  }
}
