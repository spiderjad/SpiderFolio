// The HACCP plan (docs/spec/calidad.md, «Fase 2»): the APPCC controlled document type, the table of
// critical control points (CCP) linked to the forms that monitor them, and the meat industry template.
// quality.manage changes the table; quality.view reads it.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { qualityTexts } from "../../i18n/index.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { ensureTypes } from "../documents/documents.service.ts";
import { createForm, saveTemplate } from "../forms/forms.service.ts";
import { lastPosition } from "../nodes/nodes.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import type { CcpInput, UpdateCcpInput } from "./haccp.schemas.ts";
import { haccpTemplate } from "./haccp-template.ts";

/** The HACCP plan's controlled document type (reviewed every 12 months). */
export const HACCP_TYPE = "APPCC";
const DAYS_SHOWN = 30;

/** Creates the APPCC document type if the company doesn't have it (named in its language). */
export async function ensureHaccpType(ctx: AdminContext): Promise<void> {
  await ensureTypes(ctx);
  if ((await ctx.db.documentType.count({ where: { code: HACCP_TYPE } })) > 0) return;
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const name = withLocale(readWorkspaceLocale(workspace?.settings), () => qualityTexts.haccpType);
  await ctx.db.documentType.create({
    data: {
      code: HACCP_TYPE,
      name,
      prefix: HACCP_TYPE,
      reviewMonths: 12,
      position: await ctx.db.documentType.count(),
    },
  });
}

export interface CcpView {
  id: string;
  code: string;
  name: string;
  step: string;
  hazard: string;
  hazardType: "BIOLOGICAL" | "CHEMICAL" | "PHYSICAL" | "ALLERGEN";
  criticalLimit: string;
  form: { id: string; name: string; spaceId: string } | null;
  frequency: string;
  responsible: { id: string; name: string } | null;
  correctiveAction: string;
  verification: string;
  archived: boolean;
  /** The last 30 days of its form: records, out of limits, and its open nonconformities. */
  stats: { records: number; outOfLimits: number; openNcs: number } | null;
}

const ccpSelect = {
  id: true,
  code: true,
  name: true,
  step: true,
  hazard: true,
  hazardType: true,
  criticalLimit: true,
  formId: true,
  frequency: true,
  responsibleId: true,
  correctiveAction: true,
  verification: true,
  archivedAt: true,
} as const;

type CcpRow = Prisma.QualityCcpGetPayload<{ select: typeof ccpSelect }>;

async function views(ctx: AdminContext, rows: CcpRow[], withStats: boolean): Promise<CcpView[]> {
  const formIds = [
    ...new Set(rows.map((row) => row.formId).filter((id): id is string => id !== null)),
  ];
  const people = [
    ...new Set(rows.map((row) => row.responsibleId).filter((id): id is string => id !== null)),
  ];
  const since = new Date(Date.now() - DAYS_SHOWN * 86_400_000);
  const [forms, members, records, failing, openNcs] = await Promise.all([
    formIds.length === 0
      ? Promise.resolve([])
      : ctx.db.node.findMany({
          where: { id: { in: formIds }, type: "FORM", trashedAt: null },
          select: { id: true, name: true, spaceId: true },
        }),
    people.length === 0
      ? Promise.resolve([])
      : ctx.db.membership.findMany({
          where: { id: { in: people } },
          select: { id: true, user: { select: { name: true } } },
        }),
    !withStats || formIds.length === 0
      ? Promise.resolve([])
      : ctx.db.formRecord.groupBy({
          by: ["nodeId"],
          where: { nodeId: { in: formIds }, voidedAt: null, submittedAt: { gte: since } },
          _count: { _all: true },
        }),
    !withStats || formIds.length === 0
      ? Promise.resolve([])
      : ctx.db.formRecord.groupBy({
          by: ["nodeId"],
          where: {
            nodeId: { in: formIds },
            voidedAt: null,
            submittedAt: { gte: since },
            NOT: { nonConforming: { isEmpty: true } },
          },
          _count: { _all: true },
        }),
    !withStats || formIds.length === 0
      ? Promise.resolve([])
      : ctx.db.qualityNc.findMany({
          where: { status: { notIn: ["CLOSED", "CANCELLED"] }, recordId: { not: null } },
          select: { recordId: true },
          take: 2000,
        }),
  ]);
  const formOf = new Map(forms.map((form) => [form.id, form]));
  const nameOf = new Map(members.map((member) => [member.id, member.user.name]));
  const recordsOf = new Map(records.map((row) => [row.nodeId, row._count._all]));
  const failingOf = new Map(failing.map((row) => [row.nodeId, row._count._all]));
  // The open NCs' records, by form.
  const ncRecordIds = openNcs.map((nc) => nc.recordId).filter((id): id is string => id !== null);
  const ncForms =
    ncRecordIds.length === 0
      ? []
      : await ctx.db.formRecord.findMany({
          where: { id: { in: ncRecordIds }, nodeId: { in: formIds } },
          select: { nodeId: true },
        });
  const ncsOf = new Map<string, number>();
  for (const row of ncForms) ncsOf.set(row.nodeId, (ncsOf.get(row.nodeId) ?? 0) + 1);
  return rows.map((row) => {
    const form = row.formId === null ? undefined : formOf.get(row.formId);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      step: row.step,
      hazard: row.hazard,
      hazardType: row.hazardType,
      criticalLimit: row.criticalLimit,
      form: form ?? null,
      frequency: row.frequency,
      responsible:
        row.responsibleId === null
          ? null
          : { id: row.responsibleId, name: nameOf.get(row.responsibleId) ?? "" },
      correctiveAction: row.correctiveAction,
      verification: row.verification,
      archived: row.archivedAt !== null,
      stats:
        !withStats || form === undefined
          ? null
          : {
              records: recordsOf.get(form.id) ?? 0,
              outOfLimits: failingOf.get(form.id) ?? 0,
              openNcs: ncsOf.get(form.id) ?? 0,
            },
    };
  });
}

async function requireReader(ctx: AdminContext): Promise<void> {
  await requireQuality(ctx);
  if (!canViewQuality(ctx)) throw forbidden();
}

async function requireManager(ctx: AdminContext): Promise<void> {
  await requireQuality(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
}

/** The plan: its current controlled document and the table of CCPs with their figures. */
export async function haccpOverview(
  ctx: AdminContext,
  archived: boolean,
): Promise<{
  plan: { nodeId: string; code: string; name: string; spaceId: string; page: boolean } | null;
  ccps: CcpView[];
}> {
  await requireReader(ctx);
  const document = await ctx.db.controlledDocument.findFirst({
    where: { docType: HACCP_TYPE, node: { trashedAt: null } },
    select: {
      nodeId: true,
      code: true,
      node: { select: { name: true, spaceId: true, type: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = await ctx.db.qualityCcp.findMany({
    where: archived ? {} : { archivedAt: null },
    select: ccpSelect,
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 200,
  });
  return {
    plan:
      document === null
        ? null
        : {
            nodeId: document.nodeId,
            code: document.code,
            name: document.node.name,
            spaceId: document.node.spaceId,
            page: document.node.type === "PAGE",
          },
    ccps: await views(ctx, rows, true),
  };
}

async function assertForm(ctx: AdminContext, formId: string | null | undefined): Promise<void> {
  if (formId === null || formId === undefined) return;
  const found = await ctx.db.node.count({ where: { id: formId, type: "FORM", trashedAt: null } });
  if (found === 0) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.haccpMessages.formNotFound });
  }
}

async function assertMember(ctx: AdminContext, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const found = await ctx.db.membership.count({ where: { id, status: "ACTIVE" } });
  if (found === 0) throw notFound();
}

async function assertFreeCode(ctx: AdminContext, code: string, exceptId?: string): Promise<void> {
  const taken = await ctx.db.qualityCcp.count({
    where: {
      codeKey: nameKeyOf(code),
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
  });
  if (taken > 0) throw new AppError("CONFLICT", { message: qualityTexts.haccpMessages.codeTaken });
}

async function oneView(ctx: AdminContext, id: string): Promise<CcpView> {
  const row = await ctx.db.qualityCcp.findFirst({ where: { id }, select: ccpSelect });
  if (row === null) throw notFound();
  const [view] = await views(ctx, [row], false);
  if (view === undefined) throw notFound();
  return view;
}

export async function createCcp(ctx: AdminContext, input: CcpInput): Promise<CcpView> {
  await requireManager(ctx);
  await assertFreeCode(ctx, input.code);
  await assertForm(ctx, input.formId);
  await assertMember(ctx, input.responsibleId);
  const created = await ctx.db.qualityCcp.create({
    data: {
      ...input,
      codeKey: nameKeyOf(input.code),
      position: await ctx.db.qualityCcp.count(),
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.ccp.create",
    entityType: "QualityCcp",
    entityId: created.id,
    metadata: { code: input.code },
  });
  return await oneView(ctx, created.id);
}

export async function updateCcp(
  ctx: AdminContext,
  id: string,
  input: UpdateCcpInput,
): Promise<CcpView> {
  await requireManager(ctx);
  const current = await ctx.db.qualityCcp.findFirst({ where: { id }, select: { id: true } });
  if (current === null) throw notFound();
  if (input.code !== undefined) await assertFreeCode(ctx, input.code, id);
  await assertForm(ctx, input.formId);
  await assertMember(ctx, input.responsibleId);
  const data = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Prisma.QualityCcpUncheckedUpdateInput;
  await ctx.db.qualityCcp.update({
    where: { id },
    data: { ...data, ...(input.code === undefined ? {} : { codeKey: nameKeyOf(input.code) }) },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "quality.ccp.update",
    entityType: "QualityCcp",
    entityId: id,
    metadata: { fields: Object.keys(data) },
  });
  return await oneView(ctx, id);
}

export async function setCcpArchived(
  ctx: AdminContext,
  id: string,
  archived: boolean,
): Promise<CcpView> {
  await requireManager(ctx);
  const current = await ctx.db.qualityCcp.findFirst({ where: { id }, select: { id: true } });
  if (current === null) throw notFound();
  await ctx.db.qualityCcp.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: archived ? "quality.ccp.archive" : "quality.ccp.restore",
    entityType: "QualityCcp",
    entityId: id,
  });
  return await oneView(ctx, id);
}

/** The order of the active CCPs (every one of them, once). */
export async function orderCcps(ctx: AdminContext, ids: string[]): Promise<void> {
  await requireManager(ctx);
  const active = await ctx.db.qualityCcp.findMany({
    where: { archivedAt: null },
    select: { id: true },
  });
  const wanted = new Set(ids);
  if (
    wanted.size !== ids.length ||
    active.length !== ids.length ||
    active.some((row) => !wanted.has(row.id))
  ) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.haccpMessages.orderInvalid });
  }
  await ctx.db.$transaction(async (tx) => {
    for (const [position, id] of ids.entries()) {
      await tx.qualityCcp.update({ where: { id }, data: { position }, select: { id: true } });
    }
  });
  await auditAdmin(ctx, {
    action: "quality.ccp.order",
    entityType: "Workspace",
    entityId: ctx.db.workspaceId,
  });
}

/**
 * The meat industry template: the monitoring forms (in «Registros de vigilancia (PCC)» of the module's
 * space, opening a nonconformity by themselves) and the six CCPs linked to them. Never over what the
 * company already has with the same name or code.
 */
export async function loadMeatTemplate(
  ctx: AdminContext,
  spaceId: string | undefined,
): Promise<{ forms: number; ccps: number }> {
  await requireQuality(ctx);
  if (spaceId === undefined) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.haccpMessages.noSpace });
  }
  const space = await ctx.db.space.findFirst({ where: { id: spaceId }, select: { id: true } });
  if (space === null) {
    throw new AppError("BAD_REQUEST", { message: qualityTexts.haccpMessages.noSpace });
  }
  await ensureHaccpType(ctx);
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const template = withLocale(readWorkspaceLocale(workspace?.settings), haccpTemplate);
  let folderId = (
    await ctx.db.node.findFirst({
      where: {
        spaceId,
        parentId: null,
        type: "FOLDER",
        nameKey: nameKeyOf(template.folder),
        trashedAt: null,
      },
      select: { id: true },
    })
  )?.id;
  if (folderId === undefined) {
    const folder = await ctx.db.node.create({
      data: {
        spaceId,
        parentId: null,
        type: "FOLDER",
        name: template.folder,
        nameKey: nameKeyOf(template.folder),
        position: await lastPosition(ctx, spaceId, null),
        createdById: ctx.tenant.membershipId,
        updatedById: ctx.tenant.membershipId,
      },
      select: { id: true },
    });
    folderId = folder.id;
  }
  let forms = 0;
  let ccps = 0;
  let position = await ctx.db.qualityCcp.count();
  for (const item of template.items) {
    let formId = (
      await ctx.db.node.findFirst({
        where: {
          spaceId,
          parentId: folderId,
          type: "FORM",
          nameKey: nameKeyOf(item.form.name),
          trashedAt: null,
        },
        select: { id: true },
      })
    )?.id;
    if (formId === undefined) {
      const form = await createForm(ctx, spaceId, { name: item.form.name, parentId: folderId });
      await saveTemplate(ctx, form.node.id, { baseVersion: 1, fields: item.form.fields });
      await ctx.db.formSettings.create({
        data: {
          nodeId: form.node.id,
          qualityAutoNc: true,
          qualitySeverity: item.severity,
        },
      });
      formId = form.node.id;
      forms += 1;
    }
    const taken = await ctx.db.qualityCcp.count({ where: { codeKey: nameKeyOf(item.ccp.code) } });
    if (taken === 0) {
      await ctx.db.qualityCcp.create({
        data: {
          ...item.ccp,
          codeKey: nameKeyOf(item.ccp.code),
          formId,
          position,
        },
        select: { id: true },
      });
      position += 1;
      ccps += 1;
    }
  }
  if (forms === 0 && ccps === 0) {
    throw new AppError("CONFLICT", { message: qualityTexts.haccpMessages.templateDone });
  }
  await auditAdmin(ctx, {
    action: "quality.template",
    entityType: "Workspace",
    entityId: ctx.db.workspaceId,
    metadata: { forms, ccps },
  });
  return { forms, ccps };
}

/**
 * The forms a CCP can be monitored with: those of the Quality area's spaces (quality.manage; their names
 * only), up to 50, by name.
 */
export async function ccpFormOptions(
  ctx: AdminContext,
  q: string,
): Promise<{ id: string; name: string; space: string }[]> {
  await requireManager(ctx);
  const rows = await ctx.db.node.findMany({
    where: {
      type: "FORM",
      trashedAt: null,
      space: { area: "QUALITY", archivedAt: null },
      ...(q === "" ? {} : { name: { contains: q, mode: "insensitive" as const } }),
    },
    select: { id: true, name: true, space: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 50,
  });
  return rows.map((row) => ({ id: row.id, name: row.name, space: row.space.name }));
}
