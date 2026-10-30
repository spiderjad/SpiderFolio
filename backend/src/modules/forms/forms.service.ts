// Forms (docs/spec/formularios.md), phase 1: the form lives in the tree like a page (node FORM: same
// access, trash, moving and search) and its template is a list of versions. Saving a changed template
// adds a version; the versions are never edited or deleted, so every record will keep the fields it
// was filled with. Creating one needs EDIT where it goes, changing its template EDIT on it, and VIEW
// is enough to read it (and, later, to fill it).
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "../../generated/prisma/client.ts";
import { formMessages } from "../../i18n/index.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf, numberedName } from "../../lib/names.ts";
import { offsetArgs, pageOf, type Page, type PageQuery } from "../../lib/pagination.ts";
import { atLeast } from "../access/access.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import {
  assertDestination,
  getNode,
  lastPosition,
  type NodeDetail,
} from "../nodes/nodes.service.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import {
  FieldsSchema,
  type CreateFormInput,
  type FormField,
  type SaveTemplateInput,
} from "./forms.schemas.ts";

export interface FormVersionView {
  version: number;
  fields: FormField[];
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
}

export interface FormDetail extends NodeDetail {
  /** The current version (the latest). */
  template: FormVersionView;
  /** Whoever asks can change the template. */
  canEdit: boolean;
}

/** A stored version's fields: they were checked when saved, read back as the same shape. */
const fieldsOf = (value: Prisma.JsonValue): FormField[] => FieldsSchema.parse(value);

async function loadForm(ctx: AdminContext, id: string) {
  const node = await ctx.db.node.findFirst({
    where: { id, trashedAt: null },
    select: { id: true, type: true, spaceId: true, currentVersion: true },
  });
  if (node === null) throw notFound();
  if (node.type !== "FORM") throw new AppError("BAD_REQUEST", { message: formMessages.notAForm });
  return node;
}

async function authors(ctx: AdminContext, ids: string[]) {
  const people = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(people.map((person) => [person.id, { id: person.id, name: person.user.name }]));
}

async function versionView(
  ctx: AdminContext,
  nodeId: string,
  version: number,
): Promise<FormVersionView> {
  const row = await ctx.db.formVersion.findFirst({ where: { nodeId, version } });
  if (row === null) throw notFound();
  const who = await authors(ctx, [row.createdById]);
  return {
    version: row.version,
    fields: fieldsOf(row.fields),
    createdAt: row.createdAt,
    createdBy: who.get(row.createdById) ?? null,
  };
}

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
  throw new AppError("CONFLICT");
}

/** A new form, with an empty template (version 1), where the person can edit. */
export async function createForm(
  ctx: AdminContext,
  spaceId: string,
  input: CreateFormInput,
): Promise<FormDetail> {
  const parentId = input.parentId ?? null;
  await assertDestination(ctx, spaceId, parentId);
  await assertSpaceWritable(ctx, spaceId);
  const requested = input.name === undefined ? "" : cleanName(input.name);
  const name = await freeName(
    ctx,
    spaceId,
    parentId,
    requested === "" ? formMessages.untitledForm : requested,
  );
  const id = await ctx.db.$transaction(async (tx) => {
    const created = await tx.node.create({
      data: {
        spaceId,
        parentId,
        type: "FORM",
        name,
        nameKey: nameKeyOf(name),
        position: await lastPosition({ db: tx }, spaceId, parentId),
        currentVersion: 1,
        createdById: ctx.tenant.membershipId,
        updatedById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    await tx.formVersion.create({
      data: { nodeId: created.id, version: 1, fields: [], createdById: ctx.tenant.membershipId },
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "form.create",
        entityType: "Node",
        entityId: created.id,
        metadata: { name, parentId },
      },
    );
    return created.id;
  });
  return await getForm(ctx, id);
}

export async function getForm(ctx: AdminContext, id: string): Promise<FormDetail> {
  const form = await loadForm(ctx, id);
  const detail = await getNode(ctx, id);
  return {
    ...detail,
    template: await versionView(ctx, id, form.currentVersion),
    canEdit: atLeast(detail.node.level, "EDIT"),
  };
}

/**
 * Saves the template. Based on the version the editor loaded: if someone saved another one since, nothing
 * is saved (CONFLICT). The same fields as now add nothing; changed ones add the next version.
 */
export async function saveTemplate(
  ctx: AdminContext,
  id: string,
  input: SaveTemplateInput,
): Promise<FormDetail> {
  const form = await loadForm(ctx, id);
  requireLevel(await levelOfNode(ctx, id), "EDIT");
  await assertSpaceWritable(ctx, form.spaceId);
  if (input.baseVersion !== form.currentVersion) {
    throw new AppError("CONFLICT", { message: formMessages.templateChanged });
  }
  const current = await ctx.db.formVersion.findFirst({
    where: { nodeId: id, version: form.currentVersion },
    select: { fields: true },
  });
  if (current !== null && isDeepStrictEqual(fieldsOf(current.fields), input.fields)) {
    return await getForm(ctx, id);
  }
  const version = form.currentVersion + 1;
  await ctx.db.$transaction(async (tx) => {
    // Only from the version the editor saw: two saves at once can't both win.
    const moved = await tx.node.updateMany({
      where: { id, currentVersion: form.currentVersion },
      data: { currentVersion: version, updatedById: ctx.tenant.membershipId },
    });
    if (moved.count === 0) {
      throw new AppError("CONFLICT", { message: formMessages.templateChanged });
    }
    await tx.formVersion.create({
      data: {
        nodeId: id,
        version,
        fields: input.fields,
        createdById: ctx.tenant.membershipId,
      },
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "form.version.create",
        entityType: "Node",
        entityId: id,
        metadata: { version, fields: input.fields.length },
      },
    );
  });
  return await getForm(ctx, id);
}

export interface FormVersionSummary {
  version: number;
  fieldCount: number;
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
}

/** The template's versions, newest first. */
export async function listVersions(
  ctx: AdminContext,
  id: string,
  query: PageQuery,
): Promise<Page<FormVersionSummary>> {
  await loadForm(ctx, id);
  requireLevel(await levelOfNode(ctx, id), "VIEW");
  const [rows, total] = await Promise.all([
    ctx.db.formVersion.findMany({
      where: { nodeId: id },
      orderBy: [{ version: "desc" }, { id: "asc" }],
      ...offsetArgs(query),
    }),
    ctx.db.formVersion.count({ where: { nodeId: id } }),
  ]);
  const who = await authors(
    ctx,
    rows.map((row) => row.createdById),
  );
  return pageOf(
    rows.map((row) => ({
      version: row.version,
      fieldCount: fieldsOf(row.fields).length,
      createdAt: row.createdAt,
      createdBy: who.get(row.createdById) ?? null,
    })),
    total,
    query,
  );
}

/** One version, as it was saved. */
export async function getVersion(
  ctx: AdminContext,
  id: string,
  version: number,
): Promise<FormVersionView> {
  await loadForm(ctx, id);
  requireLevel(await levelOfNode(ctx, id), "VIEW");
  return await versionView(ctx, id, version);
}
