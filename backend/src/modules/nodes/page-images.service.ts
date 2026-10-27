// Imágenes dentro de una página: se piden con una URL prefirmada de subida (reservan cuota), se
// confirman mirando sus bytes reales (JPG, PNG o WebP) y cuentan para el almacenamiento del
// workspace. El documento guarda el `imageId`; para verla se pide una URL de lectura corta con los
// permisos de la página. Las que quedan sin usar las limpia el worker (page-image-sweep.ts).
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import { bytesToJson } from "@spiderfolio/limits";
import { AppError, notFound } from "../../lib/errors.ts";
import { IMAGE_EXTENSIONS, sniffImage, type ImageType } from "../../lib/image-sniff.ts";
import type { Storage } from "../../lib/storage.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { assertStorageRoom, lockWorkspace } from "../files/files.service.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import { fileMessages } from "../../i18n/index.ts";

export const MAX_PAGE_IMAGE_BYTES = 10 * 1024 * 1024;

export interface PageImageDeps {
  storage: Storage;
}

async function pageOf(ctx: AdminContext, pageId: string) {
  const page = await ctx.db.node.findFirst({
    where: { id: pageId, trashedAt: null, type: "PAGE" },
    select: { id: true, spaceId: true },
  });
  if (page === null) throw notFound();
  return page;
}

export interface ImageUpload {
  imageId: string;
  url: string;
}

export async function startImageUpload(
  ctx: AdminContext,
  deps: PageImageDeps,
  pageId: string,
  input: { contentType: ImageType; size: number },
): Promise<ImageUpload> {
  const page = await pageOf(ctx, pageId);
  requireLevel(await levelOfNode(ctx, pageId), "EDIT");
  await assertSpaceWritable(ctx, page.spaceId);
  if (input.size > MAX_PAGE_IMAGE_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", { message: fileMessages.pageImageTooLarge });
  }
  const storageKey = `${ctx.tenant.workspaceId}/${pageId}/img-${randomBytes(16).toString("hex")}.${IMAGE_EXTENSIONS[input.contentType]}`;
  const image = await ctx.db.$transaction(async (tx) => {
    // Cuota: usado + reservado + nuevo <= límite, sin que dos subidas en paralelo la pasen.
    await lockWorkspace(tx);
    await assertStorageRoom(tx, BigInt(input.size));
    return await tx.pageImage.create({
      data: {
        nodeId: pageId,
        storageKey,
        mimeType: input.contentType,
        sizeBytes: BigInt(input.size),
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
  });
  const url = await deps.storage.presignPut(storageKey, {
    size: input.size,
    contentType: input.contentType,
  });
  return { imageId: image.id, url };
}

async function readHead(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Confirma lo subido: mira su tamaño y bytes reales; si no son los pedidos, lo descarta. */
export async function confirmImageUpload(
  ctx: AdminContext,
  deps: PageImageDeps,
  pageId: string,
  imageId: string,
): Promise<{ imageId: string }> {
  await pageOf(ctx, pageId);
  requireLevel(await levelOfNode(ctx, pageId), "EDIT");
  const row = await ctx.db.pageImage.findFirst({
    where: { id: imageId, nodeId: pageId, confirmedAt: null, createdById: ctx.tenant.membershipId },
  });
  if (row === null) throw notFound();
  const discard = async (message: string): Promise<never> => {
    await deps.storage.delete(row.storageKey).catch(() => undefined);
    await ctx.db.pageImage.deleteMany({ where: { id: row.id } });
    throw new AppError("BAD_REQUEST", { message });
  };
  const head = await deps.storage.head(row.storageKey);
  if (head === null) return await discard(fileMessages.imageNotReceived);
  if (BigInt(head.size) !== row.sizeBytes) return await discard(fileMessages.imageMismatch);
  const bytes = await readHead(
    await deps.storage.rangeStream(row.storageKey, 0, Math.min(head.size, 16)),
  );
  if (sniffImage(bytes) !== row.mimeType) {
    return await discard(fileMessages.imageTypes);
  }
  await ctx.db.$transaction(async (tx) => {
    await lockWorkspace(tx);
    await tx.pageImage.update({ where: { id: row.id }, data: { confirmedAt: new Date() } });
    const workspace = await tx.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
    await tx.workspace.update({
      where: { id: workspace.id },
      data: { storageUsedBytes: { increment: row.sizeBytes } },
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "page.image",
        entityType: "Node",
        entityId: pageId,
        metadata: { sizeBytes: bytesToJson(row.sizeBytes) },
      },
    );
  });
  return { imageId: row.id };
}

/** URL de lectura corta (60 s) de una imagen, con los permisos de lectura de la página. */
export async function imageUrl(
  ctx: AdminContext,
  deps: PageImageDeps,
  pageId: string,
  imageId: string,
): Promise<{ url: string }> {
  await pageOf(ctx, pageId);
  requireLevel(await levelOfNode(ctx, pageId), "VIEW");
  const image = await ctx.db.pageImage.findFirst({
    where: { id: imageId, nodeId: pageId, confirmedAt: { not: null } },
    select: { storageKey: true, mimeType: true },
  });
  if (image === null) throw notFound();
  const url = await deps.storage.presignGet(image.storageKey, {
    fileName: "imagen",
    inline: true,
    contentType: image.mimeType,
  });
  return { url };
}
