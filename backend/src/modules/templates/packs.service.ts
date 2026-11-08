// Industry packs (docs/spec/plantillas.md, 2): ready-made sets the templates plugin brings as data
// (pluginApi 4). Installing one creates its tree in a space with the same rules as using a template,
// adds the document types the company lacks and the departments the person ticks, and keeps the
// pack's marked pages and folders as company templates.
import { markdownToContent } from "@spiderfolio/content";
import { templateLimits } from "@spiderfolio/limits";
import type { TemplatePack, TemplatePackNode } from "@spiderfolio/plugin-sdk/backend";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.ts";
import { templateTexts } from "../../i18n/index.ts";
import { currentLocale, readWorkspaceLocale, type Locale } from "../../i18n/locales.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { nameKeyOf, numberedName } from "../../lib/names.ts";
import type { PluginRuntime } from "../../plugins/runtime.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { createDepartment } from "../departments/departments.service.ts";
import { createType } from "../documents/admin-documents.service.ts";
import {
  SNAPSHOT_FORMAT,
  SnapshotNodeSchema,
  TemplateSnapshotSchema,
  type SnapshotNode,
  type UseTemplateInput,
} from "./templates.schemas.ts";
import {
  canManageTemplates,
  createTree,
  requireTemplates,
  type CreatedTree,
  type OutlineNode,
  type TemplateDeps,
} from "./templates.service.ts";

const PackId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/u);

export const PackParams = z.strictObject({ pluginId: PackId, packId: PackId });

export const InstallPackSchema = z.strictObject({
  spaceId: z.string().min(1).max(40),
  parentId: z.string().min(1).max(40).nullable(),
  /** Of the pack's suggested departments, the ones to create. */
  departments: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
});
export type InstallPackInput = z.infer<typeof InstallPackSchema>;

interface PackTemplate {
  name: string;
  description: string;
  category: string | null;
  node: SnapshotNode;
}

interface CheckedPack {
  pluginId: string;
  key: string;
  pack: TemplatePack;
  root: SnapshotNode;
  templates: PackTemplate[];
}

/** A pack turned into a template tree; null if something in it doesn't pass (it isn't offered). */
function checkPack(pluginId: string, pack: TemplatePack): CheckedPack | null {
  if (!PackId.safeParse(pack.id).success) return null;
  const templates: PackTemplate[] = [];
  let count = 0;
  const convert = (node: TemplatePackNode): SnapshotNode => {
    count += 1;
    const children = (node.children ?? []).map(convert);
    const converted: SnapshotNode =
      node.type === "folder"
        ? { type: "FOLDER", name: node.name, icon: node.icon ?? null, children }
        : {
            type: "PAGE",
            name: node.name,
            icon: node.icon ?? null,
            cover: null,
            content: markdownToContent(node.markdown).doc,
            controlled:
              node.docType === undefined
                ? null
                : { docType: node.docType, ownerDepartmentId: null },
            children,
          };
    if (node.template !== undefined) {
      templates.push({
        name: node.name.slice(0, templateLimits.nameMax),
        description: (node.template.description ?? "").slice(0, templateLimits.descriptionMax),
        category: node.template.category?.slice(0, templateLimits.categoryMax) ?? null,
        node: converted,
      });
    }
    return converted;
  };
  try {
    const root = SnapshotNodeSchema.parse(convert(pack.root));
    if (count > templateLimits.nodesMax) return null;
    return { pluginId, key: `${pluginId}/${pack.id}`, pack, root, templates };
  } catch {
    return null;
  }
}

async function packsIn(
  deps: PackDeps,
  workspaceId: string,
  locale: Locale,
): Promise<CheckedPack[]> {
  const found = await deps.plugins.templatePacks(workspaceId, locale);
  return found.flatMap(({ pluginId, pack }) => {
    const checked = checkPack(pluginId, pack);
    return checked === null ? [] : [checked];
  });
}

export interface PackDeps extends TemplateDeps {
  plugins: Pick<PluginRuntime, "hasFeature" | "templatePacks">;
}

async function requirePackManager(ctx: AdminContext, deps: PackDeps): Promise<void> {
  await requireTemplates(ctx, deps);
  if (!canManageTemplates(ctx)) throw forbidden();
}

export interface PackView {
  pluginId: string;
  id: string;
  name: string;
  description: string;
  folders: number;
  pages: number;
  controlled: number;
  documentTypes: { code: string; name: string; exists: boolean }[];
  departments: { name: string; exists: boolean }[];
  templates: number;
  /** When its templates were added (the pack was installed before), or null. */
  installedAt: Date | null;
  outline: OutlineNode;
}

function outline(node: SnapshotNode): OutlineNode {
  return {
    type: node.type,
    name: node.name,
    controlled: node.type === "PAGE" && node.controlled !== null,
    children: node.children.map(outline),
  };
}

function tally(node: SnapshotNode, into = { folders: 0, pages: 0, controlled: 0 }) {
  if (node.type === "FOLDER") into.folders += 1;
  else {
    into.pages += 1;
    if (node.controlled !== null) into.controlled += 1;
  }
  for (const child of node.children) tally(child, into);
  return into;
}

async function viewsOf(ctx: AdminContext, packs: readonly CheckedPack[]): Promise<PackView[]> {
  const [types, departments, installed] = await Promise.all([
    ctx.db.documentType.findMany({ select: { code: true } }),
    ctx.db.department.findMany({ select: { name: true } }),
    ctx.db.template.findMany({
      where: { packKey: { in: packs.map((pack) => pack.key) } },
      select: { packKey: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const typeCodes = new Set(types.map((row) => row.code));
  const departmentKeys = new Set(departments.map((row) => nameKeyOf(row.name)));
  const installedAt = new Map<string, Date>();
  for (const row of installed) {
    if (row.packKey !== null && !installedAt.has(row.packKey)) {
      installedAt.set(row.packKey, row.createdAt);
    }
  }
  return packs.map((checked) => ({
    pluginId: checked.pluginId,
    id: checked.pack.id,
    name: checked.pack.name,
    description: checked.pack.description,
    ...tally(checked.root),
    documentTypes: (checked.pack.documentTypes ?? []).map((type) => ({
      code: type.code,
      name: type.name,
      exists: typeCodes.has(type.code),
    })),
    departments: (checked.pack.departments ?? []).map((name) => ({
      name,
      exists: departmentKeys.has(nameKeyOf(name)),
    })),
    templates: checked.templates.length,
    installedAt: installedAt.get(checked.key) ?? null,
    outline: outline(checked.root),
  }));
}

/** The packs of the active plugins, in the app's language. */
export async function listPacks(ctx: AdminContext, deps: PackDeps): Promise<PackView[]> {
  await requirePackManager(ctx, deps);
  return await viewsOf(ctx, await packsIn(deps, ctx.tenant.workspaceId, currentLocale()));
}

export interface InstalledPack extends CreatedTree {
  templatesAdded: number;
  departmentsAdded: number;
  typesAdded: number;
}

/**
 * Installs a pack in the company's language. Document types the company lacks are added if the
 * person sets up documents (workspace.settings); ticked departments need departments.manage.
 */
export async function installPack(
  ctx: AdminContext,
  deps: PackDeps,
  pluginId: string,
  packId: string,
  input: InstallPackInput,
): Promise<InstalledPack> {
  await requirePackManager(ctx, deps);
  const workspace = await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { settings: true },
  });
  const locale = readWorkspaceLocale(workspace.settings);
  const checked = (await packsIn(deps, ctx.tenant.workspaceId, locale)).find(
    (pack) => pack.pluginId === pluginId && pack.pack.id === packId,
  );
  if (checked === undefined) throw notFound();

  // Departments: only the pack's, only the ticked ones, never one that already exists.
  const offered = new Map((checked.pack.departments ?? []).map((name) => [nameKeyOf(name), name]));
  const wanted = [...new Set(input.departments.map(nameKeyOf))];
  if (wanted.some((key) => !offered.has(key))) {
    throw new AppError("BAD_REQUEST", { message: templateTexts.packUnknown });
  }
  if (wanted.length > 0 && !ctx.tenant.capabilities.includes("departments.manage")) {
    throw forbidden();
  }
  const existing = new Set(
    (await ctx.db.department.findMany({ select: { name: true } })).map((row) =>
      nameKeyOf(row.name),
    ),
  );
  let departmentsAdded = 0;
  for (const key of wanted) {
    const name = offered.get(key);
    if (name === undefined || existing.has(key)) continue;
    await createDepartment(ctx, { name, createSpace: false });
    departmentsAdded += 1;
  }

  // Document types the company doesn't have, if the person sets them up; otherwise those pages are
  // created as plain pages (createTree counts them).
  let typesAdded = 0;
  if (ctx.tenant.capabilities.includes("workspace.settings")) {
    const codes = new Set(
      (await ctx.db.documentType.findMany({ select: { code: true } })).map((row) => row.code),
    );
    for (const type of checked.pack.documentTypes ?? []) {
      if (codes.has(type.code) || !/^[A-Z0-9]{1,10}$/u.test(type.code)) continue;
      await createType(ctx, {
        code: type.code,
        name: type.name.slice(0, 80),
        ...(type.prefix === undefined ? {} : { prefix: type.prefix }),
        ...(type.reviewMonths === undefined ? {} : { reviewMonths: type.reviewMonths }),
      });
      typesAdded += 1;
    }
  }

  const destination: UseTemplateInput = { spaceId: input.spaceId, parentId: input.parentId };
  const created = await createTree(
    ctx,
    deps,
    { root: checked.root, images: new Map() },
    destination,
    {
      action: "template.pack.install",
      entityType: "TemplatePack",
      entityId: checked.key,
      metadata: { name: checked.pack.name, departmentsAdded, typesAdded },
    },
  );

  // Its templates, the first time only.
  let templatesAdded = 0;
  const already = await ctx.db.template.count({ where: { packKey: checked.key } });
  if (already === 0 && checked.templates.length > 0) {
    templatesAdded = await ctx.db.$transaction(async (tx) => {
      let added = 0;
      for (const template of checked.templates) {
        let name = template.name;
        for (let n = 2; n < 100; n += 1) {
          if ((await tx.template.count({ where: { nameKey: nameKeyOf(name) } })) === 0) break;
          name = numberedName(template.name, n).slice(0, templateLimits.nameMax);
        }
        const snapshot = TemplateSnapshotSchema.parse({
          format: SNAPSHOT_FORMAT,
          root: template.node,
        });
        const countOf = (node: SnapshotNode): number =>
          1 + node.children.reduce((sum, child) => sum + countOf(child), 0);
        await tx.template.create({
          data: {
            name,
            nameKey: nameKeyOf(name),
            description: template.description,
            category: template.category,
            kind: template.node.type,
            snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
            nodeCount: countOf(template.node),
            packKey: checked.key,
            createdById: ctx.tenant.membershipId,
          },
        });
        added += 1;
      }
      await auditAdmin(
        { db: tx, info: ctx.info },
        {
          action: "template.pack.templates",
          entityType: "TemplatePack",
          entityId: checked.key,
          metadata: { added },
        },
      );
      return added;
    });
  }
  return { ...created, templatesAdded, departmentsAdded, typesAdded };
}
