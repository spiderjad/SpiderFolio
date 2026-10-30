// Aprobaciones de documentos controlados (módulo 6, parte 2): enviar a revisión (con congelado del
// contenido), aprobar o rechazar, retirar y publicar. Con varios aprobadores deben aprobar todos; sin
// autoaprobación salvo que el propietario lo permita en Seguridad (queda en el historial y la
// auditoría como «aprobado por el propio autor»). Publicar deja una sola versión vigente.
import type { NodeType } from "../../generated/prisma/client.ts";
import type { Jobs } from "../../jobs/boss.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { dayMonthsLater, zoneOf } from "../../lib/time-zone.ts";
import { contentMessages } from "../../i18n/index.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { atLeast } from "../access/access.ts";
import { accessFor, levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { validateContent } from "@spiderfolio/content";
import { createDocumentNotices } from "../notifications/notifications.service.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import { readAllowSelfApproval } from "../workspaces/settings.ts";
import {
  approverCandidates,
  canApprove,
  eligibleApprovers,
  suggestedApprovers,
} from "./approvers.ts";
import type { ApproverOption } from "./approvers.ts";
import { latestVersion } from "./controlled-guard.ts";
import { publishedPageSnapshot } from "./documents.service.ts";
import { carryOverRequirements } from "./readings.service.ts";
import { whoCanSee } from "./readings.core.ts";
import type {
  DecisionInput,
  MyApprovalsQuery,
  PublishInput,
  SubmitInput,
} from "./documents.schemas.ts";

export interface ApprovalDeps {
  jobs: Pick<Jobs, "enqueue">;
}

async function controlledNode(ctx: AdminContext, nodeId: string) {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, name: true, type: true, spaceId: true, currentVersion: true },
  });
  if (node === null) throw notFound();
  const controlled = await ctx.db.controlledDocument.findFirst({ where: { nodeId } });
  if (controlled === null) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.notControlled });
  }
  return { node, controlled };
}

async function allowSelfApproval(ctx: AdminContext): Promise<boolean> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return readAllowSelfApproval(workspace?.settings);
}

/** A quiénes se puede pedir la aprobación: sugeridos por la regla del tipo y el resto elegible. */
export async function approverOptions(
  ctx: AdminContext,
  nodeId: string,
  q: string | undefined,
): Promise<{
  suggested: ApproverOption[];
  others: ApproverOption[];
  allowSelf: boolean;
  department: { id: string; name: string } | null;
  canChangeDepartment: boolean;
  /** Puede darle acceso al documento a quien no lo ve (gestiona sus accesos). */
  canGrantAccess: boolean;
}> {
  const { controlled } = await controlledNode(ctx, nodeId);
  const level = await levelOfNode(ctx, nodeId);
  requireLevel(level, "EDIT");
  const all = await approverCandidates(ctx, nodeId, controlled.ownerDepartmentId);
  const allowSelf = await allowSelfApproval(ctx);
  const usable = all.filter((option) => allowSelf || option.id !== ctx.tenant.membershipId);
  const suggested = suggestedApprovers(usable, controlled.ownerDepartmentId);
  const suggestedIds = new Set(suggested.map((option) => option.id));
  const needle = q === undefined ? "" : q.toLowerCase();
  const matches = (option: ApproverOption) =>
    needle === "" || option.name.toLowerCase().includes(needle);
  const others = usable.filter((option) => !suggestedIds.has(option.id) && matches(option));
  const department =
    controlled.ownerDepartmentId === null
      ? null
      : await ctx.db.department.findFirst({
          where: { id: controlled.ownerDepartmentId },
          select: { id: true, name: true },
        });
  return {
    suggested: suggested.filter(matches),
    others,
    allowSelf,
    department,
    canChangeDepartment: atLeast(level, "MANAGE"),
    canGrantAccess: atLeast(level, "MANAGE"),
  };
}

/** Cambia el departamento responsable (quien gestiona; no mientras se revisa). */
export async function setOwnerDepartment(
  ctx: AdminContext,
  nodeId: string,
  departmentId: string | null,
): Promise<void> {
  const { controlled } = await controlledNode(ctx, nodeId);
  requireLevel(await levelOfNode(ctx, nodeId), "MANAGE");
  const latest = await latestVersion(ctx.db, nodeId);
  if (latest?.status === "IN_REVIEW" || latest?.status === "APPROVED") {
    throw new AppError("CONFLICT", { message: contentMessages.controlledLocked });
  }
  if (
    departmentId !== null &&
    (await ctx.db.department.count({ where: { id: departmentId } })) === 0
  ) {
    throw notFound();
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.controlledDocument.update({
      where: { id: controlled.id },
      data: { ownerDepartmentId: departmentId },
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "document.department_changed",
        entityType: "Node",
        entityId: nodeId,
        metadata: { from: controlled.ownerDepartmentId, to: departmentId },
      },
    );
  });
}

/** Envía el borrador a revisión: congela el contenido y pide la aprobación a cada aprobador. */
export async function submitForReview(
  ctx: AdminContext,
  deps: ApprovalDeps,
  nodeId: string,
  input: SubmitInput,
): Promise<void> {
  const { node, controlled } = await controlledNode(ctx, nodeId);
  requireLevel(await levelOfNode(ctx, nodeId), "EDIT");
  await assertSpaceWritable(ctx, node.spaceId);
  const latest = await latestVersion(ctx.db, nodeId);
  if (latest?.status !== "DRAFT") {
    throw new AppError("CONFLICT", { message: contentMessages.nothingToSubmit });
  }
  const approverIds = [...new Set(input.approverIds)];
  const me = ctx.tenant.membershipId;
  if (approverIds.includes(me) && !(await allowSelfApproval(ctx))) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.selfApprovalOff });
  }
  const eligible = new Set(
    (await eligibleApprovers(ctx, nodeId, controlled.ownerDepartmentId, { ids: approverIds })).map(
      (option) => option.id,
    ),
  );
  if (approverIds.some((id) => !eligible.has(id))) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.approverNotEligible });
  }
  // Lo que se revisa queda congelado: la página como está ahora; el archivo, su versión y huella.
  const nodeType: NodeType = node.type;
  let content: unknown = null;
  let textPlain: string | null = null;
  let checksum: string | null = null;
  let fileVersion: number | null = null;
  if (nodeType === "PAGE") {
    const page = await ctx.db.pageContent.findFirst({ where: { nodeId } });
    if (page === null) throw notFound();
    content = page.content;
    textPlain = page.textPlain;
  } else {
    const draft = await ctx.db.documentVersion.findFirst({
      where: { nodeId, version: latest.version },
      select: { fileVersion: true },
    });
    fileVersion = draft?.fileVersion ?? node.currentVersion;
    const file = await ctx.db.fileVersion.findFirst({
      where: { nodeId, version: fileVersion },
      select: { checksum: true },
    });
    checksum = file?.checksum ?? null;
  }
  const now = new Date();
  await ctx.db.$transaction(async (tx) => {
    await tx.documentVersion.update({
      where: { id: latest.id },
      data: {
        status: "IN_REVIEW",
        submittedAt: now,
        submittedById: me,
        title: node.name,
        changeNote: input.changeNote ?? null,
        ...(nodeType === "PAGE"
          ? { content: content as never, textPlain }
          : { fileVersion, checksum }),
      },
    });
    await tx.approval.createMany({
      data: approverIds.map((approverId) => ({
        nodeId,
        version: latest.version,
        approverId,
        round: now,
        submittedById: me,
        ...(nodeType === "PAGE" ? { snapshot: content as never } : {}),
      })),
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "document.submitted",
        entityType: "Node",
        entityId: nodeId,
        metadata: { code: controlled.code, version: latest.version, approvers: approverIds.length },
      },
    );
  });
  await createDocumentNotices(ctx.db, deps.jobs, {
    kind: "approval_pending",
    actorId: me,
    recipients: approverIds,
    nodeId,
    version: latest.version,
  });
}

/** Aprueba o rechaza lo que está en revisión. Solo quien tiene una aprobación pendiente. */
export async function decide(
  ctx: AdminContext,
  deps: ApprovalDeps,
  nodeId: string,
  input: DecisionInput,
): Promise<void> {
  const { node, controlled } = await controlledNode(ctx, nodeId);
  requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  await assertSpaceWritable(ctx, node.spaceId);
  const latest = await ctx.db.documentVersion.findFirst({
    where: { nodeId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, submittedAt: true, submittedById: true },
  });
  if (latest?.status !== "IN_REVIEW" || latest.submittedAt === null) {
    throw new AppError("CONFLICT", { message: contentMessages.notInReview });
  }
  const me = ctx.tenant.membershipId;
  const pending = await ctx.db.approval.findFirst({
    where: {
      nodeId,
      version: latest.version,
      approverId: me,
      round: latest.submittedAt,
      decision: null,
    },
    select: { id: true },
  });
  // Solo quien tiene la aprobación pendiente y todavía puede aprobar (capacidad o cargo).
  if (pending === null || !(await canApprove(ctx, nodeId, controlled.ownerDepartmentId, me))) {
    throw forbidden();
  }
  const selfApproved = latest.submittedById === me;
  if (selfApproved && !(await allowSelfApproval(ctx))) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.selfApprovalOff });
  }
  const rejected = input.decision === "REJECTED";
  const changes = input.decision === "CHANGES_REQUESTED";
  // Pedir cambios y rechazar piden explicar por qué.
  if ((rejected || changes) && (input.comment === undefined || input.comment.trim().length < 3)) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.rejectNeedsComment });
  }
  const published = rejected ? await publishedPageSnapshot(ctx, nodeId) : null;
  const now = new Date();
  const allApproved = await ctx.db.$transaction(async (tx) => {
    await tx.approval.update({
      where: { id: pending.id },
      data: {
        decision: input.decision,
        comment: input.comment?.trim() ?? null,
        decidedAt: now,
        selfApproved,
      },
    });
    let done = false;
    if (changes) {
      // Pedir cambios devuelve el documento a borrador, con los comentarios abiertos: se corrige y
      // se vuelve a enviar.
      await tx.documentVersion.update({ where: { id: latest.id }, data: { status: "DRAFT" } });
    } else if (rejected) {
      // Rechazar descarta la versión: queda en el historial y el texto vuelve al de la vigente.
      await tx.documentVersion.update({ where: { id: latest.id }, data: { status: "REJECTED" } });
      if (published !== null) {
        const checked = validateContent(published.content);
        if (checked.ok) {
          await tx.pageContent.updateMany({
            where: { nodeId },
            data: {
              content: checked.content,
              textPlain: checked.text,
              revision: { increment: 1 },
              updatedById: me,
            },
          });
        }
      }
    } else {
      const left = await tx.approval.count({
        where: {
          nodeId,
          version: latest.version,
          round: latest.submittedAt ?? now,
          decision: null,
        },
      });
      if (left === 0) {
        await tx.documentVersion.update({
          where: { id: latest.id },
          data: { status: "APPROVED", approvedAt: now },
        });
        done = true;
      }
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: rejected
          ? "document.rejected"
          : changes
            ? "document.changes_requested"
            : "document.approved",
        entityType: "Node",
        entityId: nodeId,
        metadata: { code: controlled.code, version: latest.version, selfApproved },
      },
    );
    return done;
  });
  if (latest.submittedById !== null && (rejected || changes || allApproved)) {
    await createDocumentNotices(ctx.db, deps.jobs, {
      kind: rejected ? "approval_rejected" : changes ? "approval_changes" : "approval_approved",
      actorId: me,
      recipients: [latest.submittedById],
      nodeId,
      version: latest.version,
    });
  }
}

/** Retira de revisión: vuelve a borrador. Lo hace quien lo envió o quien gestiona el documento. */
export async function withdraw(ctx: AdminContext, nodeId: string): Promise<void> {
  const { node, controlled } = await controlledNode(ctx, nodeId);
  const level = requireLevel(await levelOfNode(ctx, nodeId), "EDIT");
  await assertSpaceWritable(ctx, node.spaceId);
  const latest = await ctx.db.documentVersion.findFirst({
    where: { nodeId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, submittedById: true },
  });
  if (latest?.status !== "IN_REVIEW") {
    throw new AppError("CONFLICT", { message: contentMessages.notInReview });
  }
  if (latest.submittedById !== ctx.tenant.membershipId && !atLeast(level, "MANAGE")) {
    throw forbidden();
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.documentVersion.update({ where: { id: latest.id }, data: { status: "DRAFT" } });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "document.withdrawn",
        entityType: "Node",
        entityId: nodeId,
        metadata: { code: controlled.code, version: latest.version },
      },
    );
  });
}

/**
 * Publica la versión aprobada: pasa a ser la única vigente y la anterior queda obsoleta (no se
 * borra). Lo hace quien puede aprobar este documento. Por defecto se pide nueva lectura a quienes
 * debían leer la anterior; sin ella (cambio menor) sus lecturas siguen valiendo.
 */
export async function publish(
  ctx: AdminContext,
  deps: ApprovalDeps,
  nodeId: string,
  input: PublishInput = {},
): Promise<void> {
  const renew = input.requestReading !== false;
  const reason = input.reason === undefined || input.reason === "" ? null : input.reason;
  const { node, controlled } = await controlledNode(ctx, nodeId);
  requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  await assertSpaceWritable(ctx, node.spaceId);
  const latest = await ctx.db.documentVersion.findFirst({
    where: { nodeId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true },
  });
  if (latest?.status !== "APPROVED") {
    throw new AppError("CONFLICT", { message: contentMessages.notApproved });
  }
  if (!(await canApprove(ctx, nodeId, controlled.ownerDepartmentId, ctx.tenant.membershipId))) {
    throw forbidden();
  }
  const type = await ctx.db.documentType.findFirst({
    where: { code: controlled.docType },
    select: { reviewMonths: true },
  });
  const now = new Date();
  // The next review is a whole day in the company's zone: it never moves to the day before or after.
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  const zone = zoneOf(workspace?.settings);
  const carried = await ctx.db.$transaction(async (tx) => {
    // Primero la anterior: el índice parcial no admite dos publicadas a la vez.
    await tx.documentVersion.updateMany({
      where: { nodeId, status: "PUBLISHED" },
      data: { status: "OBSOLETE", obsoletedAt: now },
    });
    await tx.documentVersion.update({
      where: { id: latest.id },
      data: {
        status: "PUBLISHED",
        publishedAt: now,
        effectiveAt: now,
        minorChange: !renew,
        changeReason: reason,
      },
    });
    await tx.controlledDocument.update({
      where: { id: controlled.id },
      data: {
        publishedVersion: latest.version,
        reviewDueAt: dayMonthsLater(now, type?.reviewMonths ?? 12, zone),
      },
    });
    // Hay que volver a leer la versión nueva: los requisitos de la anterior pasan a ella.
    const move = await carryOverRequirements(
      tx,
      ctx,
      nodeId,
      controlled.publishedVersion,
      latest.version,
      now,
      renew,
    );
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "document.published",
        entityType: "Node",
        entityId: nodeId,
        metadata: {
          code: controlled.code,
          version: latest.version,
          ...(renew ? {} : { minorChange: true }),
          ...(reason === null ? {} : { reason }),
        },
      },
    );
    return move;
  });
  if (node.type === "PAGE") {
    await deps.jobs.enqueue("controlled-pdf", {
      workspaceId: ctx.tenant.workspaceId,
      nodeId,
      version: latest.version,
    });
  }
  if (carried.recipients.length > 0) {
    const visible = await whoCanSee(ctx.db, nodeId, carried.recipients);
    await createDocumentNotices(ctx.db, deps.jobs, {
      kind: "reading_required",
      actorId: ctx.tenant.membershipId,
      recipients: carried.recipients.filter((id) => visible.has(id)),
      nodeId,
      version: latest.version,
      dueAt: carried.dueAt,
    });
  }
}

export interface MyApproval {
  node: {
    id: string;
    name: string;
    type: NodeType;
    spaceId: string;
    spaceName: string;
    /** Carpeta del archivo (para abrirlo en el explorador). */
    parentId: string | null;
    mimeType: string | null;
  };
  code: string;
  version: number;
  submittedAt: Date;
  submittedBy: string | null;
  changeNote: string | null;
}

/** Bandeja: lo que está esperando mi aprobación (y todavía veo y puedo aprobar). */
export async function myApprovals(
  ctx: AdminContext,
  query: MyApprovalsQuery,
): Promise<Page<MyApproval>> {
  const pending = await ctx.db.approval.findMany({
    where: { approverId: ctx.tenant.membershipId, decision: null },
    orderBy: [{ round: "desc" }, { id: "asc" }],
    take: 500,
    select: { nodeId: true, version: true, round: true },
  });
  const versions =
    pending.length === 0
      ? []
      : await ctx.db.documentVersion.findMany({
          where: {
            status: "IN_REVIEW",
            OR: pending.map((p) => ({
              nodeId: p.nodeId,
              version: p.version,
              submittedAt: p.round,
            })),
          },
          select: {
            nodeId: true,
            version: true,
            submittedAt: true,
            submittedById: true,
            changeNote: true,
          },
        });
  const nodeIds = [...new Set(versions.map((v) => v.nodeId))];
  const [nodes, codes, access, people] = await Promise.all([
    nodeIds.length === 0
      ? []
      : ctx.db.node.findMany({
          where: { id: { in: nodeIds }, trashedAt: null },
          select: {
            id: true,
            name: true,
            type: true,
            spaceId: true,
            parentId: true,
            mimeType: true,
            space: { select: { name: true } },
          },
        }),
    nodeIds.length === 0
      ? []
      : ctx.db.controlledDocument.findMany({
          where: { nodeId: { in: nodeIds } },
          select: { nodeId: true, code: true },
        }),
    accessFor(ctx, { nodeIds }),
    ctx.db.membership.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              versions.flatMap((v) => (v.submittedById === null ? [] : [v.submittedById])),
            ),
          ],
        },
      },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const codeOf = new Map(codes.map((row) => [row.nodeId, row.code]));
  const who = new Map(people.map((p) => [p.id, p.user.name]));
  const items = versions.flatMap((version): MyApproval[] => {
    const node = nodeById.get(version.nodeId);
    const code = codeOf.get(version.nodeId);
    if (
      node === undefined ||
      code === undefined ||
      version.submittedAt === null ||
      !atLeast(access.ofNode(node.id), "VIEW")
    ) {
      return [];
    }
    return [
      {
        node: {
          id: node.id,
          name: node.name,
          type: node.type,
          spaceId: node.spaceId,
          spaceName: node.space.name,
          parentId: node.parentId,
          mimeType: node.mimeType,
        },
        code,
        version: version.version,
        submittedAt: version.submittedAt,
        submittedBy:
          version.submittedById === null ? null : (who.get(version.submittedById) ?? null),
        changeNote: version.changeNote,
      },
    ];
  });
  items.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  const { skip, take } = offsetArgs(query);
  return pageOf(items.slice(skip, skip + take), items.length, query);
}
