// Company templates (docs/spec/plantillas.md). The logic is in the core, off, and the templates plugin
// turns it on with its license (feature custom_templates), like the connector for Claude. Saving copies
// what the person sees of a page or a folder (no files or forms, no comments or mentions); using one
// creates the tree with the same rules as the app: the destination's permissions, the company's
// storage, the audit log.
import { validateContent, withoutThreadMarks } from "@spiderfolio/content";
import { bytesToJson, templateLimits } from "@spiderfolio/limits";
import type { JSONContent } from "@tiptap/core";
import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, TemplateKind } from "../../generated/prisma/client.ts";
import { contentMessages, templateTexts } from "../../i18n/index.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import type { Storage } from "../../lib/storage.ts";
import type { PluginRuntime } from "../../plugins/runtime.ts";
import { atLeast } from "../access/access.ts";
import { accessFor, levelOfNode, levelOfSpace, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { controlNode, ensureTypes, publishedPageSnapshot } from "../documents/documents.service.ts";
import { assertStorageRoom, lockWorkspace } from "../files/files.service.ts";
import { assertDestination, lastPosition, MAX_TREE_DEPTH } from "../nodes/nodes.service.ts";
import { freeName } from "../nodes/pages.service.ts";
import {
  SNAPSHOT_FORMAT,
  TemplateSnapshotSchema,
  type SaveTemplateInput,
  type SnapshotNode,
  type TemplatesQuery,
  type UpdateTemplateInput,
  type UseTemplateInput,
} from "./templates.schemas.ts";

export const TEMPLATES_FEATURE = "custom_templates";
/** Declared by the templates plugin; the owner has it too. */
export const MANAGE_TEMPLATES = "templates:manage";

export interface TemplateDeps {
  storage: Pick<Storage, "stream" | "putStream" | "delete">;
  plugins: Pick<PluginRuntime, "hasFeature">;
}

/** Off without the plugin (404, as if it didn't exist); guests never use templates. */
export async function requireTemplates(ctx: AdminContext, deps: TemplateDeps): Promise<void> {
  if (!(await deps.plugins.hasFeature(ctx.tenant.workspaceId, TEMPLATES_FEATURE))) throw notFound();
  if (ctx.tenant.role.base === "GUEST") throw forbidden();
}

async function requireManage(ctx: AdminContext, deps: TemplateDeps): Promise<void> {
  await requireTemplates(ctx, deps);
  if (!(ctx.tenant.capabilities as readonly string[]).includes(MANAGE_TEMPLATES)) throw forbidden();
}

export function canManageTemplates(ctx: AdminContext): boolean {
  return (ctx.tenant.capabilities as readonly string[]).includes(MANAGE_TEMPLATES);
}

// ─── Views ───

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string | null;
  kind: TemplateKind;
  nodeCount: number;
  skippedFiles: number;
  packKey: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: Date;
}

/** The tree without its texts: what the preview shows. */
export interface OutlineNode {
  type: "PAGE" | "FOLDER";
  name: string;
  controlled: boolean;
  children: OutlineNode[];
}

export interface TemplateDetail extends TemplateSummary {
  /** null if the stored tree no longer passes the checks (it can't be used). */
  outline: OutlineNode | null;
  images: number;
}

const summarySelect = {
  id: true,
  name: true,
  description: true,
  category: true,
  kind: true,
  nodeCount: true,
  skippedFiles: true,
  packKey: true,
  createdById: true,
  createdAt: true,
} as const;

type SummaryRow = Prisma.TemplateGetPayload<{ select: typeof summarySelect }>;

async function authorsOf(
  ctx: AdminContext,
  ids: readonly string[],
): Promise<Map<string, { id: string; name: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, { id: row.id, name: row.user.name }]));
}

function summaryOf(
  row: SummaryRow,
  authors: ReadonlyMap<string, { id: string; name: string }>,
): TemplateSummary {
  const { createdById, ...rest } = row;
  return { ...rest, createdBy: authors.get(createdById) ?? null };
}

function outlineOf(node: SnapshotNode): OutlineNode {
  return {
    type: node.type,
    name: node.name,
    controlled: node.type === "PAGE" && node.controlled !== null,
    children: node.children.map(outlineOf),
  };
}

function parseSnapshot(value: unknown): SnapshotNode | null {
  const parsed = TemplateSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data.root : null;
}

function countNodes(node: SnapshotNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function depthOf(node: SnapshotNode): number {
  return 1 + Math.max(0, ...node.children.map(depthOf));
}

// ─── List, read, change, delete ───

export async function listTemplates(
  ctx: AdminContext,
  deps: TemplateDeps,
  query: TemplatesQuery,
): Promise<Page<TemplateSummary> & { canManage: boolean }> {
  await requireTemplates(ctx, deps);
  const q = query.q?.trim() ?? "";
  const category = query.category?.trim() ?? "";
  const where: Prisma.TemplateWhereInput = {
    AND: [
      q === ""
        ? {}
        : {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          },
      category === "" ? {} : { category },
      query.kind === undefined ? {} : { kind: query.kind },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.template.findMany({
      where,
      select: summarySelect,
      orderBy: stableOrder(
        query.sort === "name" ? { nameKey: query.dir } : { createdAt: query.dir },
      ),
      ...offsetArgs(query),
    }),
    ctx.db.template.count({ where }),
  ]);
  const authors = await authorsOf(
    ctx,
    rows.map((row) => row.createdById),
  );
  return {
    ...pageOf(
      rows.map((row) => summaryOf(row, authors)),
      total,
      query,
    ),
    canManage: canManageTemplates(ctx),
  };
}

/** The categories in use, for the filter. */
export async function templateCategories(ctx: AdminContext, deps: TemplateDeps): Promise<string[]> {
  await requireTemplates(ctx, deps);
  const rows = await ctx.db.template.findMany({
    where: { category: { not: null } },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
    take: templateLimits.categoriesMax,
  });
  return rows.flatMap((row) => (row.category === null ? [] : [row.category]));
}

export async function getTemplate(
  ctx: AdminContext,
  deps: TemplateDeps,
  id: string,
): Promise<TemplateDetail> {
  await requireTemplates(ctx, deps);
  const row = await ctx.db.template.findFirst({
    where: { id },
    select: { ...summarySelect, snapshot: true, _count: { select: { images: true } } },
  });
  if (row === null) throw notFound();
  const { snapshot, _count, ...summary } = row;
  const root = parseSnapshot(snapshot);
  const authors = await authorsOf(ctx, [summary.createdById]);
  return {
    ...summaryOf(summary, authors),
    outline: root === null ? null : outlineOf(root),
    images: _count.images,
  };
}

async function assertNameFree(ctx: AdminContext, name: string, exceptId?: string): Promise<void> {
  const taken = await ctx.db.template.count({
    where: {
      nameKey: nameKeyOf(name),
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
  });
  if (taken > 0) throw new AppError("CONFLICT", { message: templateTexts.nameTaken });
}

export async function updateTemplate(
  ctx: AdminContext,
  deps: TemplateDeps,
  id: string,
  input: UpdateTemplateInput,
): Promise<TemplateDetail> {
  await requireManage(ctx, deps);
  const row = await ctx.db.template.findFirst({ where: { id }, select: { id: true, name: true } });
  if (row === null) throw notFound();
  const data: Prisma.TemplateUpdateInput = {};
  if (input.name !== undefined) {
    await assertNameFree(ctx, input.name, id);
    data.name = input.name;
    data.nameKey = nameKeyOf(input.name);
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category === "" ? null : input.category;
  await ctx.db.$transaction(async (tx) => {
    await tx.template.update({ where: { id }, data });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "template.update",
        entityType: "Template",
        entityId: id,
        metadata: {
          name: input.name ?? row.name,
          renamedFrom: input.name === undefined ? null : row.name,
        },
      },
    );
  });
  return await getTemplate(ctx, deps, id);
}

export async function deleteTemplate(
  ctx: AdminContext,
  deps: TemplateDeps,
  id: string,
): Promise<void> {
  await requireManage(ctx, deps);
  const row = await ctx.db.template.findFirst({ where: { id }, select: { id: true, name: true } });
  if (row === null) throw notFound();
  const images = await ctx.db.templateImage.findMany({
    where: { templateId: id },
    select: { storageKey: true, sizeBytes: true },
  });
  const total = images.reduce((sum, image) => sum + image.sizeBytes, 0n);
  await ctx.db.$transaction(async (tx) => {
    await lockWorkspace(tx);
    await tx.template.delete({ where: { id } });
    if (total > 0n) {
      const workspace = await tx.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
      await tx.workspace.update({
        where: { id: workspace.id },
        data: { storageUsedBytes: { decrement: total } },
      });
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "template.delete",
        entityType: "Template",
        entityId: id,
        metadata: { name: row.name, images: images.length, bytes: bytesToJson(total) },
      },
    );
  });
  // After the commit: an object that fails to go stays under the company's prefix, which is removed
  // with the company.
  await Promise.allSettled(images.map((image) => deps.storage.delete(image.storageKey)));
}

// ─── Content ───

/** A mention becomes its text («@Ana»): a template doesn't notify anyone. */
function withoutMentions(node: JSONContent): JSONContent {
  if (node.type === "mention") {
    const label: unknown = node.attrs?.label;
    return {
      type: "text",
      text: `@${typeof label === "string" ? label : ""}`,
      ...(node.marks === undefined ? {} : { marks: node.marks }),
    };
  }
  const { content, ...rest } = node;
  return content === undefined ? rest : { ...rest, content: content.map(withoutMentions) };
}

/** Image ids swapped by `ids`; an image not in it is dropped. */
function remapImages(node: JSONContent, ids: ReadonlyMap<string, string>): JSONContent | null {
  if (node.type === "pageImage") {
    const imageId: unknown = node.attrs?.imageId;
    const next = typeof imageId === "string" ? ids.get(imageId) : undefined;
    return next === undefined ? null : { ...node, attrs: { ...node.attrs, imageId: next } };
  }
  const { content, ...rest } = node;
  if (content === undefined) return rest;
  return {
    ...rest,
    content: content.flatMap((child) => {
      const mapped = remapImages(child, ids);
      return mapped === null ? [] : [mapped];
    }),
  };
}

function invalidTemplate(): AppError {
  return new AppError("BAD_REQUEST", { message: templateTexts.invalid });
}

// ─── Save as template ───

interface TreeRow {
  id: string;
  parentId: string | null;
  type: "FOLDER" | "FILE" | "PAGE" | "FORM";
  name: string;
  icon: string | null;
  cover: string | null;
}

const treeSelect = {
  id: true,
  parentId: true,
  type: true,
  name: true,
  icon: true,
  cover: true,
} as const;

interface ImageCopy {
  sourceKey: string;
  newId: string;
  newKey: string;
  mimeType: string;
  sizeBytes: bigint;
}

function newImageKey(workspaceId: string, folder: string, sourceKey: string): string {
  const extension = sourceKey.split(".").pop() ?? "bin";
  return `${workspaceId}/${folder}/img-${randomBytes(16).toString("hex")}.${extension}`;
}

async function copyObjects(
  deps: TemplateDeps,
  copies: readonly ImageCopy[],
  copied: string[],
): Promise<void> {
  for (const copy of copies) {
    await deps.storage.putStream(copy.newKey, await deps.storage.stream(copy.sourceKey), {
      size: Number(copy.sizeBytes),
      contentType: copy.mimeType,
    });
    copied.push(copy.newKey);
  }
}

export async function saveAsTemplate(
  ctx: AdminContext,
  deps: TemplateDeps,
  nodeId: string,
  input: SaveTemplateInput,
): Promise<TemplateDetail> {
  await requireManage(ctx, deps);
  const root = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: treeSelect,
  });
  if (root === null) throw notFound();
  requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  if (root.type !== "FOLDER" && root.type !== "PAGE") {
    throw new AppError("BAD_REQUEST", { message: templateTexts.notTemplatable });
  }
  await assertNameFree(ctx, input.name);

  // The tree under it, level by level; files and forms are only counted.
  const rows = new Map<string, TreeRow>([[root.id, root]]);
  const leftOut: string[] = [];
  let frontier = [root.id];
  for (let depth = 0; frontier.length > 0; depth += 1) {
    const children = await ctx.db.node.findMany({
      where: { parentId: { in: frontier }, trashedAt: null },
      select: treeSelect,
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: templateLimits.nodesMax * 20,
    });
    const kept = children.filter((child) => child.type === "FOLDER" || child.type === "PAGE");
    if (kept.length > 0 && depth >= templateLimits.depthMax) {
      throw new AppError("BAD_REQUEST", { message: templateTexts.tooDeep });
    }
    for (const child of children) {
      if (child.type === "FOLDER" || child.type === "PAGE") rows.set(child.id, child);
      else leftOut.push(child.id);
    }
    if (rows.size > templateLimits.nodesMax * 4) {
      throw new AppError("BAD_REQUEST", { message: templateTexts.tooBig(templateLimits.nodesMax) });
    }
    frontier = kept.map((child) => child.id);
  }

  // Only what the person sees, and only under something kept.
  const access = await accessFor(ctx, { nodeIds: [...rows.keys(), ...leftOut] });
  const childrenOf = new Map<string, TreeRow[]>();
  for (const row of rows.values()) {
    if (row.id === root.id || row.parentId === null) continue;
    const list = childrenOf.get(row.parentId) ?? [];
    list.push(row);
    childrenOf.set(row.parentId, list);
  }
  const kept: TreeRow[] = [];
  const walk = (row: TreeRow) => {
    kept.push(row);
    for (const child of childrenOf.get(row.id) ?? []) {
      if (access.ofNode(child.id) !== null) walk(child);
    }
  };
  walk(root);
  if (kept.length > templateLimits.nodesMax) {
    throw new AppError("BAD_REQUEST", { message: templateTexts.tooBig(templateLimits.nodesMax) });
  }
  const keptIds = new Set(kept.map((row) => row.id));
  const leftOutRows =
    leftOut.length === 0
      ? []
      : await ctx.db.node.findMany({
          where: { id: { in: leftOut } },
          select: { id: true, parentId: true },
        });
  const skippedFiles = leftOutRows.filter(
    (row) => row.parentId !== null && keptIds.has(row.parentId) && access.ofNode(row.id) !== null,
  ).length;

  // Page texts: the working draft for whoever edits it; the version in force otherwise.
  const pageIds = kept.filter((row) => row.type === "PAGE").map((row) => row.id);
  const [contents, controlledRows] = await Promise.all([
    ctx.db.pageContent.findMany({
      where: { nodeId: { in: pageIds } },
      select: { nodeId: true, content: true },
    }),
    ctx.db.controlledDocument.findMany({
      where: { nodeId: { in: pageIds } },
      select: { nodeId: true, docType: true, ownerDepartmentId: true },
    }),
  ]);
  const contentOf = new Map(contents.map((row) => [row.nodeId, row.content]));
  const controlledOf = new Map(controlledRows.map((row) => [row.nodeId, row]));
  const checkedOf = new Map<string, { content: JSONContent; imageIds: string[] }>();
  for (const pageId of pageIds) {
    let content: unknown = contentOf.get(pageId);
    const level = access.ofNode(pageId);
    if (controlledOf.has(pageId) && (level === null || !atLeast(level, "EDIT"))) {
      const published = await publishedPageSnapshot(ctx, pageId);
      if (published !== null) content = published.content;
    }
    const first = validateContent(content);
    if (!first.ok) throw new AppError("BAD_REQUEST", { message: contentMessages.pageInvalid });
    const checked = validateContent(withoutMentions(withoutThreadMarks(first.content)));
    if (!checked.ok) throw new AppError("BAD_REQUEST", { message: contentMessages.pageInvalid });
    checkedOf.set(pageId, { content: checked.content, imageIds: checked.imageIds });
  }

  // Images: copied now under the template, so they outlive the page.
  const wanted = [...checkedOf].flatMap(([pageId, page]) =>
    page.imageIds.map((imageId) => ({ pageId, imageId })),
  );
  const imageRows =
    wanted.length === 0
      ? []
      : await ctx.db.pageImage.findMany({
          where: {
            nodeId: { in: pageIds },
            id: { in: wanted.map((item) => item.imageId) },
            confirmedAt: { not: null },
          },
          select: { id: true, nodeId: true, storageKey: true, mimeType: true, sizeBytes: true },
        });
  const usable = imageRows.filter((image) =>
    wanted.some((item) => item.imageId === image.id && item.pageId === image.nodeId),
  );
  if (usable.length > templateLimits.imagesMax) {
    throw new AppError("BAD_REQUEST", {
      message: templateTexts.tooManyImages(templateLimits.imagesMax),
    });
  }
  const folder = `templates/${randomBytes(12).toString("hex")}`;
  const copies: ImageCopy[] = usable.map((image) => ({
    sourceKey: image.storageKey,
    newId: randomUUID(),
    newKey: newImageKey(ctx.tenant.workspaceId, folder, image.storageKey),
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
  }));
  const idMap = new Map(usable.map((image, index) => [image.id, copies[index]?.newId ?? ""]));

  const build = (row: TreeRow): SnapshotNode => {
    const children = (childrenOf.get(row.id) ?? [])
      .filter((child) => keptIds.has(child.id))
      .map(build);
    if (row.type === "FOLDER") return { type: "FOLDER", name: row.name, icon: row.icon, children };
    const page = checkedOf.get(row.id);
    const content = page === undefined ? null : remapImages(page.content, idMap);
    const controlled = controlledOf.get(row.id);
    return {
      type: "PAGE",
      name: row.name,
      icon: row.icon,
      cover: row.cover,
      content,
      controlled:
        controlled === undefined
          ? null
          : { docType: controlled.docType, ownerDepartmentId: controlled.ownerDepartmentId },
      children,
    };
  };
  const tree = build(root);
  const snapshot = TemplateSnapshotSchema.parse({ format: SNAPSHOT_FORMAT, root: tree });

  const copied: string[] = [];
  try {
    await copyObjects(deps, copies, copied);
    const total = copies.reduce((sum, copy) => sum + copy.sizeBytes, 0n);
    const id = await ctx.db.$transaction(async (tx) => {
      await lockWorkspace(tx);
      if (total > 0n) await assertStorageRoom(tx, total);
      const created = await tx.template.create({
        data: {
          name: input.name,
          nameKey: nameKeyOf(input.name),
          description: input.description,
          category: input.category === "" ? null : input.category,
          kind: root.type === "FOLDER" ? "FOLDER" : "PAGE",
          snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
          nodeCount: countNodes(tree),
          skippedFiles,
          createdById: ctx.tenant.membershipId,
        },
        select: { id: true },
      });
      if (copies.length > 0) {
        await tx.templateImage.createMany({
          data: copies.map((copy) => ({
            id: copy.newId,
            templateId: created.id,
            storageKey: copy.newKey,
            mimeType: copy.mimeType,
            sizeBytes: copy.sizeBytes,
          })),
        });
        const workspace = await tx.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
        await tx.workspace.update({
          where: { id: workspace.id },
          data: { storageUsedBytes: { increment: total } },
        });
      }
      await auditAdmin(
        { db: tx, info: ctx.info },
        {
          action: "template.create",
          entityType: "Template",
          entityId: created.id,
          metadata: {
            name: input.name,
            from: nodeId,
            nodes: countNodes(tree),
            skippedFiles,
            images: copies.length,
            bytes: bytesToJson(total),
          },
        },
      );
      return created.id;
    });
    return await getTemplate(ctx, deps, id);
  } catch (error) {
    await Promise.allSettled(copied.map((key) => deps.storage.delete(key)));
    throw error;
  }
}

// ─── Use a template ───

export interface CreatedTree {
  node: { id: string; type: "PAGE" | "FOLDER"; spaceId: string; name: string };
  /** Controlled documents created as plain pages: the person can't manage documents there. */
  controlledSkipped: number;
}

interface TreeSource {
  root: SnapshotNode;
  /** The template's images by id (none for a pack). */
  images: ReadonlyMap<string, { storageKey: string; mimeType: string; sizeBytes: bigint }>;
}

/**
 * Creates `source` under the destination with the app's rules: the person must be able to create
 * there, the pages inherit the destination's permissions and the images count towards storage.
 * Controlled documents are only created as such if the person can manage documents there.
 */
export async function createTree(
  ctx: AdminContext,
  deps: TemplateDeps,
  source: TreeSource,
  destination: UseTemplateInput,
  audit: {
    action: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
): Promise<CreatedTree> {
  const { spaceId, parentId } = destination;
  const { depth } = await assertDestination(ctx, spaceId, parentId);
  if (depth + depthOf(source.root) > MAX_TREE_DEPTH) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.tooDeep });
  }
  const level =
    parentId === null ? await levelOfSpace(ctx, spaceId) : await levelOfNode(ctx, parentId);
  const canControl = level !== null && atLeast(level, "MANAGE");

  // Every page's text checked as any other; images only from the template.
  interface Prepared {
    node: SnapshotNode;
    content: JSONContent | null;
    text: string;
    images: ImageCopy[];
    children: Prepared[];
  }
  const allCopies: ImageCopy[] = [];
  const prepare = (node: SnapshotNode): Prepared => {
    const children = node.children.map(prepare);
    if (node.type === "FOLDER") return { node, content: null, text: "", images: [], children };
    const checked = validateContent(node.content);
    if (!checked.ok || checked.mentionIds.length + checked.threadIds.length > 0) {
      throw invalidTemplate();
    }
    const images: ImageCopy[] = [];
    const ids = new Map<string, string>();
    for (const imageId of checked.imageIds) {
      const image = source.images.get(imageId);
      if (image === undefined) continue;
      const copy: ImageCopy = {
        sourceKey: image.storageKey,
        newId: randomUUID(),
        newKey: "",
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
      };
      images.push(copy);
      ids.set(imageId, copy.newId);
    }
    const remapped = remapImages(checked.content, ids);
    const final = remapped === null ? null : validateContent(remapped);
    if (final === null || !final.ok) throw invalidTemplate();
    allCopies.push(...images);
    return { node, content: final.content, text: final.text, images, children };
  };
  const prepared = prepare(source.root);
  const anyControlled = (node: SnapshotNode): boolean =>
    (node.type === "PAGE" && node.controlled !== null) || node.children.some(anyControlled);
  const types = new Map<string, string>();
  const departments = new Set<string>();
  let spaceDepartment: string | null = null;
  if (canControl && anyControlled(source.root)) {
    await ensureTypes(ctx);
    const [typeRows, departmentRows, space] = await Promise.all([
      ctx.db.documentType.findMany({ select: { id: true, code: true } }),
      ctx.db.department.findMany({ select: { id: true } }),
      ctx.db.space.findFirst({ where: { id: spaceId }, select: { departmentId: true } }),
    ]);
    for (const row of typeRows) types.set(row.code, row.id);
    for (const row of departmentRows) departments.add(row.id);
    spaceDepartment = space?.departmentId ?? null;
  }
  const rootName = await freeName(ctx, spaceId, parentId, source.root.name);

  const copied: string[] = [];
  try {
    // The page ids are only known inside the transaction: the objects go to a folder of their own.
    const folder = `template-use/${randomBytes(12).toString("hex")}`;
    for (const copy of allCopies) {
      copy.newKey = newImageKey(ctx.tenant.workspaceId, folder, copy.sourceKey);
    }
    await copyObjects(deps, allCopies, copied);
    const total = allCopies.reduce((sum, copy) => sum + copy.sizeBytes, 0n);
    let controlledSkipped = 0;
    const rootId = await ctx.db.$transaction(
      async (tx) => {
        await lockWorkspace(tx);
        if (total > 0n) await assertStorageRoom(tx, total);
        const scoped = { db: tx, info: ctx.info, tenant: ctx.tenant };
        const create = async (item: Prepared, under: string | null, name: string) => {
          const created = await tx.node.create({
            data: {
              spaceId,
              parentId: under,
              type: item.node.type,
              name,
              nameKey: nameKeyOf(name),
              icon: item.node.icon,
              ...(item.node.type === "PAGE" ? { cover: item.node.cover } : {}),
              position: await lastPosition({ db: tx }, spaceId, under),
              createdById: ctx.tenant.membershipId,
              updatedById: ctx.tenant.membershipId,
            },
            select: { id: true },
          });
          if (item.node.type === "PAGE" && item.content !== null) {
            await tx.pageContent.create({
              data: {
                nodeId: created.id,
                content: item.content,
                textPlain: item.text,
                updatedById: ctx.tenant.membershipId,
              },
            });
            for (const copy of item.images) {
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
            const controlled = item.node.controlled;
            if (controlled !== null) {
              const typeId = types.get(controlled.docType);
              if (canControl && typeId !== undefined) {
                const owner =
                  controlled.ownerDepartmentId !== null &&
                  departments.has(controlled.ownerDepartmentId)
                    ? controlled.ownerDepartmentId
                    : spaceDepartment;
                await controlNode(scoped, {
                  nodeId: created.id,
                  name,
                  nodeType: "PAGE",
                  typeId,
                  ownerDepartmentId: owner,
                });
              } else {
                controlledSkipped += 1;
              }
            }
          }
          for (const child of item.children) await create(child, created.id, child.node.name);
          return created.id;
        };
        const id = await create(prepared, parentId, rootName);
        if (total > 0n) {
          const workspace = await tx.workspace.findFirstOrThrow({
            where: {},
            select: { id: true },
          });
          await tx.workspace.update({
            where: { id: workspace.id },
            data: { storageUsedBytes: { increment: total } },
          });
        }
        await auditAdmin(
          { db: tx, info: ctx.info },
          {
            ...audit,
            metadata: {
              ...audit.metadata,
              nodeId: id,
              spaceId,
              parentId,
              nodes: countNodes(source.root),
              images: allCopies.length,
              bytes: bytesToJson(total),
              controlledSkipped,
            },
          },
        );
        return id;
      },
      { timeout: 60_000 },
    );
    return {
      node: { id: rootId, type: source.root.type, spaceId, name: rootName },
      controlledSkipped,
    };
  } catch (error) {
    await Promise.allSettled(copied.map((key) => deps.storage.delete(key)));
    throw error;
  }
}

export async function useTemplate(
  ctx: AdminContext,
  deps: TemplateDeps,
  id: string,
  input: UseTemplateInput,
): Promise<CreatedTree> {
  await requireTemplates(ctx, deps);
  const row = await ctx.db.template.findFirst({
    where: { id },
    select: { id: true, name: true, snapshot: true },
  });
  if (row === null) throw notFound();
  const root = parseSnapshot(row.snapshot);
  if (root === null) throw invalidTemplate();
  const images = await ctx.db.templateImage.findMany({
    where: { templateId: id },
    select: { id: true, storageKey: true, mimeType: true, sizeBytes: true },
  });
  return await createTree(
    ctx,
    deps,
    { root, images: new Map(images.map((image) => [image.id, image])) },
    input,
    {
      action: "template.use",
      entityType: "Template",
      entityId: id,
      metadata: { name: row.name },
    },
  );
}
