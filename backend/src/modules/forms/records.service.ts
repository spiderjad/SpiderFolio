// Records (docs/spec/formularios.md), phase 2: filling in a form. Photos and the signature are
// uploaded first (a presigned upload that reserves quota, confirmed by its real bytes, like a page's
// images) and tied to the record when it's sent. A record is never edited or deleted. Filling in needs
// VIEW on the form (readers and PIN accounts too); the person sees their own records, and whoever can
// edit the form sees them all.
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import type { Prisma } from "../../generated/prisma/client.ts";
import { fileMessages, formMessages } from "../../i18n/index.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { IMAGE_EXTENSIONS, sniffImage, type ImageType } from "../../lib/image-sniff.ts";
import { decodeCursor, encodeCursor, type CursorQuery } from "../../lib/pagination.ts";
import type { Storage } from "../../lib/storage.ts";
import { atLeast } from "../access/access.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { assertStorageRoom, lockWorkspace } from "../files/files.service.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import { checkAnswers, type Answers } from "./answers.ts";
import { FieldsSchema, type FormField } from "./forms.schemas.ts";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 1024 * 1024;

export interface RecordDeps {
  storage: Storage;
}

async function formOf(ctx: AdminContext, id: string) {
  const form = await ctx.db.node.findFirst({
    where: { id, trashedAt: null, type: "FORM" },
    select: { id: true, spaceId: true, currentVersion: true },
  });
  if (form === null) throw notFound();
  return form;
}

async function fieldsOf(ctx: AdminContext, nodeId: string, version: number): Promise<FormField[]> {
  const row = await ctx.db.formVersion.findFirst({
    where: { nodeId, version },
    select: { fields: true },
  });
  if (row === null) throw new AppError("BAD_REQUEST", { message: formMessages.unknownVersion });
  return FieldsSchema.parse(row.fields);
}

/** Whoever can edit the form sees every record (the person in charge too, with phase 3). */
async function seesAll(ctx: AdminContext, nodeId: string): Promise<boolean> {
  return atLeast(await levelOfNode(ctx, nodeId), "EDIT");
}

// ─── Photos and signature ────────────────────────────────────────────────────────

export interface FileUpload {
  fileId: string;
  url: string;
}

/** A photo or signature for a field of the current version: a presigned upload that reserves quota. */
export async function startFileUpload(
  ctx: AdminContext,
  deps: RecordDeps,
  formId: string,
  input: { fieldId: string; contentType: ImageType; size: number },
): Promise<FileUpload> {
  const form = await formOf(ctx, formId);
  requireLevel(await levelOfNode(ctx, formId), "VIEW");
  await assertSpaceWritable(ctx, form.spaceId);
  const field = (await fieldsOf(ctx, formId, form.currentVersion)).find(
    (candidate) => candidate.id === input.fieldId,
  );
  if (field?.type !== "photo" && field?.type !== "signature") {
    throw new AppError("BAD_REQUEST", { message: formMessages.notAFileField });
  }
  if (field.type === "signature" && input.contentType !== "image/png") {
    throw new AppError("BAD_REQUEST", { message: formMessages.signatureType });
  }
  const max = field.type === "signature" ? MAX_SIGNATURE_BYTES : MAX_PHOTO_BYTES;
  if (input.size > max) {
    throw new AppError("PAYLOAD_TOO_LARGE", { message: formMessages.fileTooLarge });
  }
  const storageKey = `${ctx.tenant.workspaceId}/forms/${formId}/${randomBytes(16).toString("hex")}.${IMAGE_EXTENSIONS[input.contentType]}`;
  const file = await ctx.db.$transaction(async (tx) => {
    await lockWorkspace(tx);
    await assertStorageRoom(tx, BigInt(input.size));
    return await tx.formFile.create({
      data: {
        nodeId: formId,
        fieldId: input.fieldId,
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
  return { fileId: file.id, url };
}

async function readHead(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Confirms an upload by its real size and bytes; it takes its quota from now on. */
export async function confirmFileUpload(
  ctx: AdminContext,
  deps: RecordDeps,
  formId: string,
  fileId: string,
): Promise<{ fileId: string }> {
  await formOf(ctx, formId);
  requireLevel(await levelOfNode(ctx, formId), "VIEW");
  const row = await ctx.db.formFile.findFirst({
    where: {
      id: fileId,
      nodeId: formId,
      confirmedAt: null,
      recordId: null,
      createdById: ctx.tenant.membershipId,
    },
  });
  if (row === null) throw notFound();
  const discard = async (message: string): Promise<never> => {
    await deps.storage.delete(row.storageKey).catch(() => undefined);
    await ctx.db.formFile.deleteMany({ where: { id: row.id } });
    throw new AppError("BAD_REQUEST", { message });
  };
  const head = await deps.storage.head(row.storageKey);
  if (head === null) return await discard(fileMessages.imageNotReceived);
  if (BigInt(head.size) !== row.sizeBytes) return await discard(fileMessages.imageMismatch);
  const bytes = await readHead(
    await deps.storage.rangeStream(row.storageKey, 0, Math.min(head.size, 16)),
  );
  if (sniffImage(bytes) !== row.mimeType) return await discard(fileMessages.imageTypes);
  await ctx.db.$transaction(async (tx) => {
    await lockWorkspace(tx);
    await tx.formFile.updateMany({ where: { id: row.id }, data: { confirmedAt: new Date() } });
    const workspace = await tx.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
    await tx.workspace.update({
      where: { id: workspace.id },
      data: { storageUsedBytes: { increment: row.sizeBytes } },
    });
  });
  return { fileId: row.id };
}

// ─── Sending a record ──────────────────────────────────────────────────────────

export interface RecordView {
  id: string;
  formId: string;
  version: number;
  answers: Answers;
  nonConforming: string[];
  source: string;
  submittedAt: Date;
  submittedBy: { id: string; name: string } | null;
  voided: { at: Date; reason: string; by: { id: string; name: string } | null } | null;
}

async function people(ctx: AdminContext, ids: string[]) {
  const rows = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, { id: row.id, name: row.user.name }]));
}

type RecordRow = Prisma.FormRecordGetPayload<object>;

async function viewsOf(ctx: AdminContext, rows: RecordRow[]): Promise<RecordView[]> {
  const who = await people(
    ctx,
    rows.flatMap((row) => [
      row.submittedById,
      ...(row.voidedById === null ? [] : [row.voidedById]),
    ]),
  );
  return rows.map((row) => ({
    id: row.id,
    formId: row.nodeId,
    version: row.version,
    answers: row.answers as Answers,
    nonConforming: row.nonConforming,
    source: row.source,
    submittedAt: row.submittedAt,
    submittedBy: who.get(row.submittedById) ?? null,
    voided:
      row.voidedAt === null
        ? null
        : {
            at: row.voidedAt,
            reason: row.voidReason ?? "",
            by: row.voidedById === null ? null : (who.get(row.voidedById) ?? null),
          },
  }));
}

/**
 * Sends a record: the answers checked against the version it was filled with, its photos and signature
 * (uploaded and confirmed by this person for those fields) tied to it, and what's non-conforming worked
 * out here. Nothing is stored unless all of it checks out.
 */
export async function submitRecord(
  ctx: AdminContext,
  formId: string,
  input: { version: number; answers: Record<string, unknown>; source: "app" | "qr" },
): Promise<RecordView> {
  const form = await formOf(ctx, formId);
  requireLevel(await levelOfNode(ctx, formId), "VIEW");
  await assertSpaceWritable(ctx, form.spaceId);
  if (input.version > form.currentVersion) {
    throw new AppError("BAD_REQUEST", { message: formMessages.unknownVersion });
  }
  const fields = await fieldsOf(ctx, formId, input.version);
  const checked = checkAnswers(fields, input.answers);
  if (checked.problems.length > 0) {
    throw new AppError("BAD_REQUEST", {
      message: formMessages.answersInvalid,
      details: { fields: checked.problems },
    });
  }
  const fileIds = checked.files.flatMap((entry) => entry.ids);
  const id = await ctx.db.$transaction(async (tx) => {
    const usable = await tx.formFile.findMany({
      where: {
        id: { in: fileIds },
        nodeId: formId,
        recordId: null,
        confirmedAt: { not: null },
        createdById: ctx.tenant.membershipId,
      },
      select: { id: true, fieldId: true },
    });
    const fieldOf = new Map(usable.map((file) => [file.id, file.fieldId]));
    const fits = checked.files.every((entry) =>
      entry.ids.every((fileId) => fieldOf.get(fileId) === entry.fieldId),
    );
    if (!fits || fieldOf.size !== new Set(fileIds).size) {
      throw new AppError("BAD_REQUEST", { message: formMessages.filesInvalid });
    }
    const record = await tx.formRecord.create({
      data: {
        nodeId: formId,
        version: input.version,
        answers: checked.answers,
        nonConforming: checked.nonConforming,
        source: input.source,
        submittedById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    if (fileIds.length > 0) {
      const tied = await tx.formFile.updateMany({
        where: { id: { in: fileIds }, recordId: null },
        data: { recordId: record.id },
      });
      if (tied.count !== fileIds.length) {
        throw new AppError("BAD_REQUEST", { message: formMessages.filesInvalid });
      }
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "form.record.create",
        entityType: "Node",
        entityId: formId,
        // Never the answers: they can hold anything.
        metadata: {
          recordId: record.id,
          version: input.version,
          nonConforming: checked.nonConforming.length,
        },
      },
    );
    return record.id;
  });
  return await getRecord(ctx, formId, id).then((detail) => detail.record);
}

// ─── Reading records ─────────────────────────────────────────────────────────────

/** The form's records the person can see, newest first: theirs, or all if they can edit the form. */
export async function listRecords(
  ctx: AdminContext,
  formId: string,
  query: CursorQuery,
): Promise<{ items: RecordView[]; total: number; nextCursor: string | null }> {
  await formOf(ctx, formId);
  requireLevel(await levelOfNode(ctx, formId), "VIEW");
  const where: Prisma.FormRecordWhereInput = {
    nodeId: formId,
    ...((await seesAll(ctx, formId)) ? {} : { submittedById: ctx.tenant.membershipId }),
  };
  const position = decodeCursor(query.cursor);
  const after: Prisma.FormRecordWhereInput =
    position === null
      ? {}
      : {
          OR: [
            { submittedAt: { lt: new Date(String(position.v)) } },
            { submittedAt: new Date(String(position.v)), id: { lt: position.id } },
          ],
        };
  const [rows, total] = await Promise.all([
    ctx.db.formRecord.findMany({
      where: { AND: [where, after] },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    ctx.db.formRecord.count({ where }),
  ]);
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items: await viewsOf(ctx, items),
    total,
    nextCursor:
      rows.length > query.limit && last !== undefined
        ? encodeCursor({ v: last.submittedAt.toISOString(), id: last.id })
        : null,
  };
}

export interface RecordDetail {
  record: RecordView;
  /** The fields of the version it was filled with. */
  fields: FormField[];
  files: { id: string; fieldId: string; mimeType: string }[];
}

/** One record, with the fields it was filled with: its author, or whoever sees all of the form's. */
export async function getRecord(
  ctx: AdminContext,
  formId: string,
  recordId: string,
): Promise<RecordDetail> {
  await formOf(ctx, formId);
  requireLevel(await levelOfNode(ctx, formId), "VIEW");
  const row = await ctx.db.formRecord.findFirst({ where: { id: recordId, nodeId: formId } });
  if (row === null) throw notFound();
  if (row.submittedById !== ctx.tenant.membershipId && !(await seesAll(ctx, formId))) {
    throw notFound();
  }
  const [views, fields, files] = await Promise.all([
    viewsOf(ctx, [row]),
    fieldsOf(ctx, formId, row.version),
    ctx.db.formFile.findMany({
      where: { recordId: row.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, fieldId: true, mimeType: true },
    }),
  ]);
  const [record] = views;
  if (record === undefined) throw notFound();
  return { record, fields, files };
}

/** A short (60 s) URL to see a record's photo or signature, with the record's own access. */
export async function recordFileUrl(
  ctx: AdminContext,
  deps: RecordDeps,
  formId: string,
  recordId: string,
  fileId: string,
): Promise<{ url: string }> {
  await getRecord(ctx, formId, recordId);
  const file = await ctx.db.formFile.findFirst({
    where: { id: fileId, recordId },
    select: { storageKey: true, mimeType: true },
  });
  if (file === null) throw notFound();
  const url = await deps.storage.presignGet(file.storageKey, {
    fileName: "registro",
    inline: true,
    contentType: file.mimeType,
  });
  return { url };
}
