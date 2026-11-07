// The CAE folders (docs/spec/cae.md, «Activación»): «Contratas» in the module's space and, inside it,
// one folder per company named after it, where its documents go (phase 2). They're created by the
// system on behalf of whoever manages CAE, without asking for edit access to the space: whoever
// sees the documents is decided by the folder's access, like any other file.
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { withLocale, readWorkspaceLocale } from "../../i18n/locales.ts";
import { caeTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { lastPosition } from "../nodes/nodes.service.ts";
import { readSafetySettings, type SafetySettings } from "../workspaces/settings.ts";

/** A valid node name from a company name: no slashes nor control characters. */
function folderName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = cleanName(name.replace(/[/\\]/gu, "-").replace(/[\x00-\x1f\x7f]/gu, ""));
  return clean === "" || clean === "." || clean === ".." ? "-" : clean;
}

/** The name, or «name (2)», «name (3)»… if a sibling already has it. */
async function freeName(
  ctx: Pick<AdminContext, "db">,
  spaceId: string,
  parentId: string | null,
  name: string,
  exceptId?: string,
): Promise<string> {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? name : `${name} (${String(n)})`;
    const taken = await ctx.db.node.count({
      where: {
        spaceId,
        parentId,
        nameKey: nameKeyOf(candidate),
        trashedAt: null,
        ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
      },
    });
    if (taken === 0) return candidate;
  }
  return `${name} (${String(Date.now())})`;
}

/** A live folder of the space, or null. */
async function liveFolder(
  ctx: Pick<AdminContext, "db">,
  spaceId: string,
  id: string | null | undefined,
): Promise<{ id: string; name: string; parentId: string | null } | null> {
  if (id === undefined || id === null) return null;
  return await ctx.db.node.findFirst({
    where: { id, spaceId, type: "FOLDER", trashedAt: null },
    select: { id: true, name: true, parentId: true },
  });
}

async function createFolder(
  ctx: AdminContext,
  spaceId: string,
  parentId: string | null,
  wanted: string,
): Promise<string> {
  const name = await freeName(ctx, spaceId, parentId, folderName(wanted));
  const created = await ctx.db.node.create({
    data: {
      spaceId,
      parentId,
      type: "FOLDER",
      name,
      nameKey: nameKeyOf(name),
      position: await lastPosition(ctx, spaceId, parentId),
      createdById: ctx.tenant.membershipId,
      updatedById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "folder.create",
    entityType: "Node",
    entityId: created.id,
    metadata: { spaceId, parentId, name },
  });
  return created.id;
}

/** The space of the module, if it still exists. */
async function moduleSpaceId(
  ctx: Pick<AdminContext, "db">,
  settings: SafetySettings,
): Promise<string | null> {
  if (settings.spaceId === undefined) return null;
  const space = await ctx.db.space.findFirst({
    where: { id: settings.spaceId, archivedAt: null },
    select: { id: true },
  });
  return space?.id ?? null;
}

/**
 * The «Contratas» folder (created if it's not there or went to the trash). Returns its id, or null
 * without the module's space. The caller saves the id in the settings.
 */
export async function ensureCaeRoot(
  ctx: AdminContext,
  settings: SafetySettings,
  companySettings: unknown,
): Promise<string | null> {
  const spaceId = await moduleSpaceId(ctx, settings);
  if (spaceId === null) return null;
  const current = await liveFolder(ctx, spaceId, settings.cae.folderId);
  if (current !== null) return current.id;
  const name = withLocale(
    readWorkspaceLocale(companySettings),
    () => caeTexts.folder[settings.terms],
  );
  return await createFolder(ctx, spaceId, null, name);
}

/** The root folder for a company's folder, saving it in the settings if it had to be recreated. */
async function rootForCompanies(
  ctx: AdminContext,
): Promise<{ spaceId: string; rootId: string } | null> {
  const workspace = await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, settings: true },
  });
  const settings = readSafetySettings(workspace.settings);
  const spaceId = await moduleSpaceId(ctx, settings);
  if (spaceId === null) return null;
  const rootId = await ensureCaeRoot(ctx, settings, workspace.settings);
  if (rootId === null) return null;
  if (rootId !== settings.cae.folderId) {
    const current =
      typeof workspace.settings === "object" && workspace.settings !== null
        ? (workspace.settings as Record<string, unknown>)
        : {};
    await ctx.db.workspace.update({
      where: { id: workspace.id },
      data: {
        settings: {
          ...current,
          safety: { ...settings, cae: { ...settings.cae, folderId: rootId } },
        },
      },
    });
  }
  return { spaceId, rootId };
}

/**
 * The company's folder inside «Contratas», named after it: created if it's missing, renamed if the
 * company's name changed. Returns its id (null without the module's space).
 */
export async function syncCompanyFolder(
  ctx: AdminContext,
  company: { name: string; folderId: string | null },
): Promise<string | null> {
  const root = await rootForCompanies(ctx);
  if (root === null) return company.folderId;
  const folder = await liveFolder(ctx, root.spaceId, company.folderId);
  if (folder === null) return await createFolder(ctx, root.spaceId, root.rootId, company.name);
  const wanted = folderName(company.name);
  if (nameKeyOf(folder.name) === nameKeyOf(wanted) && folder.name === wanted) return folder.id;
  const name = await freeName(ctx, root.spaceId, folder.parentId, wanted, folder.id);
  await ctx.db.node.update({
    where: { id: folder.id },
    data: { name, nameKey: nameKeyOf(name), updatedById: ctx.tenant.membershipId },
  });
  await auditAdmin(ctx, {
    action: "node.update",
    entityType: "Node",
    entityId: folder.id,
    metadata: { renamedFrom: folder.name, nodeType: "FOLDER" },
  });
  return folder.id;
}
