// The CAE catalog (docs/spec/cae.md, «Catálogo por defecto»): the documents asked of each company or
// of each of its workers, in their order. The company edits, adds or archives them (archived instead
// of deleted: documents given point at them). Only `cae.manage`.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { caeTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { defaultCatalog } from "./cae-catalog.ts";
import type {
  CreateRequirementInput,
  ListRequirementsQuery,
  OrderRequirementsInput,
  UpdateRequirementInput,
} from "./cae.schemas.ts";
import { canManageCae, requireCae } from "./safety-access.ts";
import type { SafetySettings } from "../workspaces/settings.ts";

export interface RequirementView {
  id: string;
  name: string;
  scope: "COMPANY" | "WORKER";
  validityMonths: number | null;
  appliesTo: "ALL" | "CONTRACTOR" | "CONCURRENT";
  required: boolean;
  archived: boolean;
  position: number;
}

const requirementSelect = {
  id: true,
  name: true,
  scope: true,
  validityMonths: true,
  appliesTo: true,
  required: true,
  archivedAt: true,
  position: true,
} as const;

const view = (row: {
  id: string;
  name: string;
  scope: "COMPANY" | "WORKER";
  validityMonths: number | null;
  appliesTo: "ALL" | "CONTRACTOR" | "CONCURRENT";
  required: boolean;
  archivedAt: Date | null;
  position: number;
}): RequirementView => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  validityMonths: row.validityMonths,
  appliesTo: row.appliesTo,
  required: row.required,
  archived: row.archivedAt !== null,
  position: row.position,
});

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireCae(ctx);
  if (!canManageCae(ctx)) throw forbidden();
}

async function assertNameFree(ctx: AdminContext, name: string, exceptId?: string) {
  const taken = await ctx.db.caeRequirement.findFirst({
    where: {
      nameKey: nameKeyOf(name),
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
    select: { id: true },
  });
  if (taken !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.requirementNameTaken });
  }
}

async function nextPosition(ctx: Pick<AdminContext, "db">, scope: "COMPANY" | "WORKER") {
  const last = await ctx.db.caeRequirement.findFirst({
    where: { scope },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

/**
 * The default catalog, in the company's language and with its country's terms. Never over what the
 * company already has with the same name. Runs inside `withLocale`.
 */
export async function seedDefaultCatalog(
  ctx: Pick<AdminContext, "db">,
  terms: SafetySettings["terms"],
): Promise<void> {
  const items =
    terms === "es"
      ? defaultCatalog.es.map((item) => ({ ...item, name: caeTexts.catalog.es[item.key] }))
      : defaultCatalog.latam.map((item) => ({ ...item, name: caeTexts.catalog.latam[item.key] }));
  const start = {
    COMPANY: await nextPosition(ctx, "COMPANY"),
    WORKER: await nextPosition(ctx, "WORKER"),
  };
  const offset = { COMPANY: 0, WORKER: 0 };
  await ctx.db.caeRequirement.createMany({
    skipDuplicates: true,
    data: items.map((item) => {
      const position = start[item.scope] + offset[item.scope];
      offset[item.scope] += 1;
      return {
        name: item.name,
        nameKey: nameKeyOf(item.name),
        scope: item.scope,
        validityMonths: item.validityMonths,
        appliesTo: item.appliesTo,
        required: true,
        position,
      };
    }),
  });
}

export async function listRequirements(
  ctx: AdminContext,
  query: ListRequirementsQuery,
): Promise<Page<RequirementView>> {
  await requireManager(ctx);
  const where = {
    ...(query.scope === undefined ? {} : { scope: query.scope }),
    ...(query.status === "all"
      ? {}
      : { archivedAt: query.status === "archived" ? { not: null } : null }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.caeRequirement.findMany({
      where,
      select: requirementSelect,
      orderBy: [{ scope: "asc" }, { position: query.dir }, { id: "asc" }],
      ...offsetArgs(query),
    }),
    ctx.db.caeRequirement.count({ where }),
  ]);
  return pageOf(rows.map(view), total, query);
}

export async function createRequirement(
  ctx: AdminContext,
  input: CreateRequirementInput,
): Promise<RequirementView> {
  await requireManager(ctx);
  const name = cleanName(input.name);
  await assertNameFree(ctx, name);
  const row = await ctx.db.caeRequirement.create({
    data: {
      name,
      nameKey: nameKeyOf(name),
      scope: input.scope,
      validityMonths: input.validityMonths ?? null,
      appliesTo: input.appliesTo,
      required: input.required,
      position: await nextPosition(ctx, input.scope),
    },
    select: requirementSelect,
  });
  await auditAdmin(ctx, {
    action: "cae.requirement.create",
    entityType: "CaeRequirement",
    entityId: row.id,
    metadata: { name: row.name, scope: row.scope },
  });
  return view(row);
}

export async function updateRequirement(
  ctx: AdminContext,
  id: string,
  input: UpdateRequirementInput,
): Promise<RequirementView> {
  await requireManager(ctx);
  const current = await ctx.db.caeRequirement.findFirst({
    where: { id },
    select: requirementSelect,
  });
  if (current === null) throw notFound();
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name !== undefined) await assertNameFree(ctx, name, id);
  const restoring = input.archived === false && current.archivedAt !== null;
  const row = await ctx.db.caeRequirement.update({
    where: { id },
    data: {
      ...(name === undefined ? {} : { name, nameKey: nameKeyOf(name) }),
      ...(input.validityMonths === undefined ? {} : { validityMonths: input.validityMonths }),
      ...(input.appliesTo === undefined ? {} : { appliesTo: input.appliesTo }),
      ...(input.required === undefined ? {} : { required: input.required }),
      // Back from the archive, at the end of its list.
      ...(restoring ? { archivedAt: null, position: await nextPosition(ctx, current.scope) } : {}),
    },
    select: requirementSelect,
  });
  await auditAdmin(ctx, {
    action: restoring ? "cae.requirement.restore" : "cae.requirement.update",
    entityType: "CaeRequirement",
    entityId: id,
    metadata: { before: { ...view(current) }, after: { ...view(row) } },
  });
  return view(row);
}

export async function archiveRequirement(ctx: AdminContext, id: string): Promise<RequirementView> {
  await requireManager(ctx);
  const current = await ctx.db.caeRequirement.findFirst({
    where: { id },
    select: requirementSelect,
  });
  if (current === null) throw notFound();
  if (current.archivedAt !== null) {
    throw new AppError("CONFLICT", { message: caeTexts.messages.alreadyArchived });
  }
  const row = await ctx.db.caeRequirement.update({
    where: { id },
    data: { archivedAt: new Date() },
    select: requirementSelect,
  });
  await auditAdmin(ctx, {
    action: "cae.requirement.archive",
    entityType: "CaeRequirement",
    entityId: id,
    metadata: { name: row.name },
  });
  return view(row);
}

/** The new order of a scope's active requirements: all of them, once each. */
export async function orderRequirements(
  ctx: AdminContext,
  input: OrderRequirementsInput,
): Promise<RequirementView[]> {
  await requireManager(ctx);
  const active = await ctx.db.caeRequirement.findMany({
    where: { scope: input.scope, archivedAt: null },
    select: { id: true },
  });
  const ids = new Set(input.ids);
  if (
    ids.size !== input.ids.length ||
    ids.size !== active.length ||
    active.some((row) => !ids.has(row.id))
  ) {
    throw new AppError("BAD_REQUEST", { message: caeTexts.messages.orderMismatch });
  }
  await ctx.db.$transaction(async (tx) => {
    for (const [position, id] of input.ids.entries()) {
      await tx.caeRequirement.update({ where: { id }, data: { position }, select: { id: true } });
    }
  });
  await auditAdmin(ctx, {
    action: "cae.requirement.order",
    entityType: "Workspace",
    entityId: ctx.db.workspaceId,
    metadata: { scope: input.scope, ids: input.ids },
  });
  const rows = await ctx.db.caeRequirement.findMany({
    where: { scope: input.scope, archivedAt: null },
    select: requirementSelect,
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  return rows.map(view);
}
