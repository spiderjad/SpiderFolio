// Documentos controlados (módulo 6, parte 1): convertir una página o un archivo en documento con
// código por tipo, estados y una sola versión vigente. Las aprobaciones, lecturas y PDF llegan en las
// partes siguientes; acá están el modelo, la numeración y la lectura de lo vigente.
import type { DocStatus, NodeType } from "../../generated/prisma/client.ts";
import { contentMessages, defaultDataTexts } from "../../i18n/index.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { atLeast } from "../access/access.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import { canApprove } from "./approvers.ts";
import { myReadingOf, type ReadingMine } from "./readings.service.ts";
import type { ConvertInput, ExternalInfoInput } from "./documents.schemas.ts";

/** Tipos que se crean la primera vez que una empresa los necesita. */
const DEFAULT_TYPES = ["PRC", "INS", "FOR", "POL", "MAN"] as const;

export interface DocumentTypeView {
  code: string;
  name: string;
  /** Registered in force without the approval cycle (standards, legislation…). */
  external: boolean;
  prefix: string;
  reviewMonths: number;
  padding: number;
  nextNumber: number;
}

/** The external documents' type, added to every company (also to those that already have types). */
const EXTERNAL_TYPE = "EXT";

export async function ensureTypes(ctx: AdminContext): Promise<void> {
  const [total, external] = await Promise.all([
    ctx.db.documentType.count(),
    ctx.db.documentType.count({ where: { code: EXTERNAL_TYPE } }),
  ]);
  if (total > 0 && external > 0) return;
  // Named in the company's language, not in the language of whoever opens the screen first.
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const names = withLocale(readWorkspaceLocale(workspace?.settings), () => ({
    ...defaultDataTexts.documentTypes,
  }));
  await ctx.db.documentType.createMany({
    skipDuplicates: true,
    data: [
      ...(total > 0
        ? []
        : DEFAULT_TYPES.map((code, index) => ({
            code,
            name: names[code],
            prefix: code,
            position: index,
          }))),
      {
        code: EXTERNAL_TYPE,
        name: names[EXTERNAL_TYPE],
        prefix: EXTERNAL_TYPE,
        position: total > 0 ? total : DEFAULT_TYPES.length,
        external: true,
      },
    ],
  });
}

export async function listDocumentTypes(ctx: AdminContext): Promise<DocumentTypeView[]> {
  await ensureTypes(ctx);
  return await ctx.db.documentType.findMany({
    orderBy: [{ position: "asc" }, { code: "asc" }],
    select: {
      code: true,
      name: true,
      external: true,
      prefix: true,
      reviewMonths: true,
      padding: true,
      nextNumber: true,
    },
  });
}

export interface DocumentVersionView {
  id: string;
  version: number;
  status: DocStatus;
  title: string;
  changeNote: string | null;
  /** Se publicó sin pedir nueva lectura. */
  minorChange: boolean;
  /** Motivo del cambio, escrito al publicar. */
  changeReason: string | null;
  createdAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  obsoletedAt: Date | null;
  /** External documents: the issuer's edition or date of this version. */
  edition: string | null;
  submittedBy: string | null;
  /** Aprobaciones pedidas, la más reciente ronda al final. */
  approvals: {
    approver: { id: string; name: string };
    decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | null;
    comment: string | null;
    /** Cuándo se envió la ronda a la que pertenece. */
    round: Date;
    /** Quién envió esa ronda. */
    submittedBy: string | null;
    /** Comentarios que dejó en el texto durante la ronda. */
    commentCount: number;
    decidedAt: Date | null;
    /** Lo aprobó quien también lo envió. */
    selfApproved: boolean;
    /** Pertenece al envío actual (no a uno anterior que se rechazó). */
    current: boolean;
  }[];
}

/** Lo que puede hacer quien mira, para mostrar los botones (el servidor decide igual). */
export interface ControlledActions {
  canSubmit: boolean;
  canDecide: boolean;
  canPublish: boolean;
  canWithdraw: boolean;
  /** Retire it without a replacement (it has a version in force and nothing in review). */
  canRetire: boolean;
  /** Change an external document's issuer and reference. */
  canEditExternal: boolean;
}

/** Para quien está revisando: el estado de sus comentarios y si ya revisó una ronda anterior. */
export interface ControlledReview {
  openComments: number;
  resolvedComments: number;
  /** Revisó antes esta versión (pidió cambios): se puede ver qué cambió desde entonces. */
  hasPreviousReview: boolean;
}

export interface ControlledReading {
  /** Mi lectura de la versión vigente (null si todavía no hay vigente). */
  mine: ReadingMine | null;
  /** Puedo pedir lecturas y ver el cumplimiento. */
  canManage: boolean;
}

export interface ControlledView {
  code: string;
  docType: string;
  typeName: string;
  /** Estado de la versión más nueva (un borrador nuevo sobre un publicado figura como borrador). */
  status: DocStatus;
  /** Número de la versión vigente; null si todavía no se publicó ninguna. */
  publishedVersion: number | null;
  ownerDepartment: { id: string; name: string } | null;
  reviewDueAt: Date | null;
  /** External document (standards, legislation…): issuer and reference; null for internal ones. */
  external: { issuer: string | null; externalRef: string | null } | null;
  /** Retired without a replacement: when, why, by whom and its last version. */
  retired: { at: Date; reason: string; by: string | null; version: number | null } | null;
  /** De la más nueva a la más vieja. */
  versions: DocumentVersionView[];
  actions: ControlledActions;
  /** Solo para quien tiene la aprobación pendiente. */
  review: ControlledReview | null;
  reading: ControlledReading;
}

export interface ControlledInfo {
  controlled: ControlledView | null;
  /** Tipos para elegir al convertir (solo si todavía no es controlado y se puede gestionar). */
  types: DocumentTypeView[];
  canConvert: boolean;
}

const versionSelect = {
  id: true,
  version: true,
  status: true,
  title: true,
  changeNote: true,
  minorChange: true,
  changeReason: true,
  createdAt: true,
  submittedAt: true,
  approvedAt: true,
  publishedAt: true,
  obsoletedAt: true,
  edition: true,
} as const;

/** El control de un documento: su código, estados e historial. Pide poder ver el nodo. */
export async function getControlled(ctx: AdminContext, nodeId: string): Promise<ControlledInfo> {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, type: true },
  });
  if (node === null) throw notFound();
  const level = requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  const row = await ctx.db.controlledDocument.findFirst({ where: { nodeId } });
  if (row === null) {
    const canConvert = atLeast(level, "MANAGE") && (node.type === "PAGE" || node.type === "FILE");
    return {
      controlled: null,
      types: canConvert ? await listDocumentTypes(ctx) : [],
      canConvert,
    };
  }
  const [versionRows, approvalRows, type, department] = await Promise.all([
    ctx.db.documentVersion.findMany({
      where: { nodeId },
      orderBy: { version: "desc" },
      select: { ...versionSelect, submittedById: true },
    }),
    ctx.db.approval.findMany({
      where: { nodeId },
      // El texto de cada ronda es pesado y acá no se muestra.
      omit: { snapshot: true },
      orderBy: [{ round: "asc" }, { createdAt: "asc" }],
    }),
    ctx.db.documentType.findFirst({
      where: { code: row.docType },
      select: { name: true, external: true },
    }),
    row.ownerDepartmentId === null
      ? null
      : ctx.db.department.findFirst({
          where: { id: row.ownerDepartmentId },
          select: { id: true, name: true },
        }),
  ]);
  const threads = await ctx.db.commentThread.findMany({
    where: { nodeId, createdById: { in: [...new Set(approvalRows.map((a) => a.approverId))] } },
    select: { createdById: true, createdAt: true, status: true },
  });
  const people = new Map(
    (
      await ctx.db.membership.findMany({
        where: {
          id: {
            in: [
              ...new Set([
                ...approvalRows.map((a) => a.approverId),
                ...approvalRows.flatMap((a) => (a.submittedById === null ? [] : [a.submittedById])),
                ...versionRows.flatMap((v) => (v.submittedById === null ? [] : [v.submittedById])),
              ]),
            ],
          },
        },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((member) => [member.id, member.user.name]),
  );
  const versions: DocumentVersionView[] = versionRows.map(({ submittedById, ...rest }) => ({
    ...rest,
    submittedBy: submittedById === null ? null : (people.get(submittedById) ?? null),
    approvals: approvalRows
      .filter((a) => a.version === rest.version)
      .map((a) => ({
        approver: { id: a.approverId, name: people.get(a.approverId) ?? "" },
        decision:
          a.decision === "APPROVED" ||
          a.decision === "CHANGES_REQUESTED" ||
          a.decision === "REJECTED"
            ? a.decision
            : null,
        comment: a.comment,
        round: a.round,
        submittedBy: a.submittedById === null ? null : (people.get(a.submittedById) ?? null),
        commentCount: threads.filter(
          (thread) =>
            thread.createdById === a.approverId &&
            thread.createdAt >= a.round &&
            (a.decidedAt === null || thread.createdAt <= a.decidedAt),
        ).length,
        decidedAt: a.decidedAt,
        selfApproved: a.selfApproved,
        current: rest.submittedAt !== null && a.round.getTime() === rest.submittedAt.getTime(),
      })),
  }));
  const latest = versionRows[0];
  const me = ctx.tenant.membershipId;
  const status = latest?.status ?? "DRAFT";
  const pendingMine =
    status === "IN_REVIEW" &&
    approvalRows.some(
      (a) =>
        a.approverId === me &&
        a.decision === null &&
        latest?.submittedAt !== null &&
        a.round.getTime() === latest?.submittedAt?.getTime() &&
        a.version === latest.version,
    );
  const submittedAt = latest?.submittedAt ?? null;
  const myThreads = threads.filter((thread) => thread.createdById === me);
  const review: ControlledReview | null = pendingMine
    ? {
        openComments: myThreads.filter((thread) => thread.status === "OPEN").length,
        resolvedComments: myThreads.filter((thread) => thread.status !== "OPEN").length,
        hasPreviousReview:
          node.type === "PAGE" &&
          approvalRows.some(
            (a) =>
              a.approverId === me &&
              a.version === latest?.version &&
              a.decision !== null &&
              submittedAt !== null &&
              a.round < submittedAt,
          ),
      }
    : null;
  const external = type?.external === true;
  const actions: ControlledActions = {
    // An external document is registered in force by whoever manages it: no approval cycle.
    canSubmit: !external && status === "DRAFT" && atLeast(level, "EDIT"),
    canDecide: pendingMine,
    canPublish: external
      ? status === "DRAFT" && atLeast(level, "MANAGE")
      : status === "APPROVED" && (await canApprove(ctx, nodeId, row.ownerDepartmentId, me)),
    canWithdraw:
      status === "IN_REVIEW" && (latest?.submittedById === me || atLeast(level, "MANAGE")),
    canEditExternal: external && atLeast(level, "MANAGE"),
    canRetire:
      row.publishedVersion !== null &&
      status !== "IN_REVIEW" &&
      status !== "APPROVED" &&
      atLeast(level, "MANAGE"),
  };
  const retiredBy =
    row.retiredById === null
      ? null
      : await ctx.db.membership.findFirst({
          where: { id: row.retiredById },
          select: { user: { select: { name: true } } },
        });
  return {
    controlled: {
      code: row.code,
      docType: row.docType,
      typeName: type?.name ?? row.docType,
      status,
      publishedVersion: row.publishedVersion,
      ownerDepartment: department,
      reviewDueAt: row.reviewDueAt,
      external: external ? { issuer: row.issuer, externalRef: row.externalRef } : null,
      retired:
        row.retiredAt === null
          ? null
          : {
              at: row.retiredAt,
              reason: row.retireReason ?? "",
              by: retiredBy?.user.name ?? null,
              version: row.retiredVersion,
            },
      versions,
      actions,
      review,
      reading: {
        mine: await myReadingOf(ctx, nodeId),
        canManage:
          ctx.actor.capabilities.includes("documents.require_reading") ||
          ctx.tenant.ledScope.size > 0,
      },
    },
    types: [],
    canConvert: false,
  };
}

/**
 * Convierte una página o un archivo en documento controlado: asigna su código (el contador del tipo
 * se toma con un UPDATE, sin saltos ni repetidos) y abre su versión 1 en borrador. Pide gestionarlo.
 */
export async function makeControlled(
  ctx: AdminContext,
  nodeId: string,
  input: ConvertInput,
): Promise<ControlledInfo> {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, name: true, type: true, spaceId: true, currentVersion: true },
  });
  if (node === null) throw notFound();
  requireLevel(await levelOfNode(ctx, nodeId), "MANAGE");
  await assertSpaceWritable(ctx, node.spaceId);
  const nodeType: NodeType = node.type;
  if (nodeType === "FOLDER" || nodeType === "FORM") {
    throw new AppError("BAD_REQUEST", { message: contentMessages.controlledOnlyPagesFiles });
  }
  if ((await ctx.db.controlledDocument.count({ where: { nodeId } })) > 0) {
    throw new AppError("CONFLICT", { message: contentMessages.controlledExists });
  }
  await ensureTypes(ctx);
  const type = await ctx.db.documentType.findFirst({ where: { code: input.docType } });
  if (type === null) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.unknownDocType });
  }
  const issuer = input.issuer === undefined || input.issuer === "" ? null : input.issuer;
  const externalRef =
    input.externalRef === undefined || input.externalRef === "" ? null : input.externalRef;
  if (!type.external && (issuer !== null || externalRef !== null)) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.externalOnly });
  }
  // Responsable: el departamento elegido o, si no, el dueño del espacio.
  const space = await ctx.db.space.findFirst({
    where: { id: node.spaceId },
    select: { departmentId: true },
  });
  const ownerDepartmentId =
    input.ownerDepartmentId === undefined ? (space?.departmentId ?? null) : input.ownerDepartmentId;
  if (
    ownerDepartmentId !== null &&
    (await ctx.db.department.count({ where: { id: ownerDepartmentId } })) === 0
  ) {
    throw notFound();
  }

  await ctx.db.$transaction(async (tx) => {
    await controlNode(
      { db: tx, info: ctx.info, tenant: ctx.tenant },
      {
        nodeId,
        name: node.name,
        nodeType,
        typeId: type.id,
        ownerDepartmentId,
        fileVersion: node.currentVersion,
        issuer,
        externalRef,
      },
    );
  });
  return await getControlled(ctx, nodeId);
}

/**
 * Inside a transaction: takes the type's next number (an UPDATE, no gaps or repeats), records the
 * controlled document and opens its version 1 as a draft. The caller already checked who may do it.
 */
export async function controlNode(
  ctx: Pick<AdminContext, "db" | "info" | "tenant">,
  input: {
    nodeId: string;
    name: string;
    nodeType: NodeType;
    typeId: string;
    ownerDepartmentId: string | null;
    fileVersion?: number | null;
    /** External documents: who issues it and its own reference. */
    issuer?: string | null;
    externalRef?: string | null;
  },
): Promise<string> {
  const taken = await ctx.db.documentType.update({
    where: { id: input.typeId },
    data: { nextNumber: { increment: 1 } },
    select: { nextNumber: true, prefix: true, padding: true, code: true },
  });
  const number = taken.nextNumber - 1;
  const code = `${taken.prefix}-${String(number).padStart(taken.padding, "0")}`;
  await ctx.db.controlledDocument.create({
    data: {
      nodeId: input.nodeId,
      code,
      docType: taken.code,
      ownerDepartmentId: input.ownerDepartmentId,
      issuer: input.issuer ?? null,
      externalRef: input.externalRef ?? null,
      createdById: ctx.tenant.membershipId,
    },
  });
  await ctx.db.documentVersion.create({
    data: {
      nodeId: input.nodeId,
      version: 1,
      status: "DRAFT",
      title: input.name,
      createdById: ctx.tenant.membershipId,
      ...(input.nodeType === "FILE" && input.fileVersion !== undefined
        ? { fileVersion: input.fileVersion }
        : {}),
    },
  });
  await auditAdmin(ctx, {
    action: "document.controlled",
    entityType: "Node",
    entityId: input.nodeId,
    metadata: { code, docType: taken.code },
  });
  return code;
}

/** Texto de la versión vigente de una página para quien no la edita (null si no hay vigente). */
export async function publishedPageSnapshot(
  ctx: AdminContext,
  nodeId: string,
): Promise<{ version: number; content: unknown } | null> {
  const published = await ctx.db.documentVersion.findFirst({
    where: { nodeId, status: "PUBLISHED" },
    select: { version: true, content: true },
  });
  return published === null || published.content === null
    ? null
    : { version: published.version, content: published.content };
}

/** An external document's issuer and reference. Whoever manages the document changes them. */
export async function setExternalInfo(
  ctx: AdminContext,
  nodeId: string,
  input: ExternalInfoInput,
): Promise<ControlledInfo> {
  const row = await ctx.db.controlledDocument.findFirst({
    where: { nodeId, node: { trashedAt: null } },
    select: { id: true, code: true, docType: true },
  });
  if (row === null) throw notFound();
  requireLevel(await levelOfNode(ctx, nodeId), "MANAGE");
  const type = await ctx.db.documentType.findFirst({
    where: { code: row.docType },
    select: { external: true },
  });
  if (type?.external !== true) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.externalOnly });
  }
  const data = {
    issuer: input.issuer === "" ? null : input.issuer,
    externalRef: input.externalRef === "" ? null : input.externalRef,
  };
  await ctx.db.$transaction(async (tx) => {
    await tx.controlledDocument.update({ where: { id: row.id }, data });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "document.external_info",
        entityType: "Node",
        entityId: nodeId,
        metadata: { code: row.code, ...data },
      },
    );
  });
  return await getControlled(ctx, nodeId);
}
