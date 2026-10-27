// «Ficha del documento»: los datos de control de un documento controlado (código, tipo, versión
// vigente, estado, entrada en vigor, aprobación, departamento responsable y próxima revisión) como un
// bloque más del contexto de Bian, para responder «¿cuándo se revisa?», «¿quién lo aprobó?» o «¿desde
// cuándo está vigente?». Solo de documentos que la persona puede ver y solo de su versión vigente; se
// cita como fuente «Ficha del documento».
import { atLeast } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import type { Fragment } from "./retrieval.ts";
import { currentLocale } from "../../i18n/locales.ts";

export const CARD_HEADING = "Ficha del documento";

/** Códigos de documento que aparecen en el texto (PRC-001, PRC-CAL-001, INS-PRO-002…). */
export function codesIn(text: string): string[] {
  const found = text.toUpperCase().match(/\b[A-Z]{2,6}(?:-[A-Z0-9]{1,6})*-\d{1,6}\b/g) ?? [];
  return [...new Set(found)].slice(0, 5);
}

const dateText = (date: Date | null): string =>
  date === null
    ? "sin fecha"
    : new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long", timeZone: "UTC" }).format(date);

/** Los documentos controlados y vigentes que la persona ve y cuyo código menciona la pregunta. */
export async function mentionedDocuments(ctx: AdminContext, query: string): Promise<string[]> {
  const codes = codesIn(query);
  if (codes.length === 0) return [];
  const documents = await ctx.db.controlledDocument.findMany({
    where: {
      code: { in: codes },
      publishedVersion: { not: null },
      node: { trashedAt: null },
    },
    select: { nodeId: true },
  });
  if (documents.length === 0) return [];
  const access = await accessFor(ctx, { nodeIds: documents.map((d) => d.nodeId) });
  return documents.map((d) => d.nodeId).filter((id) => atLeast(access.ofNode(id), "VIEW"));
}

/**
 * Las fichas de estos documentos (los que no son controlados o todavía no tienen una versión vigente
 * no tienen ficha). Quien llama ya confirmó que la persona ve cada documento.
 */
export async function documentCards(
  ctx: AdminContext,
  nodeIds: readonly string[],
): Promise<Map<string, Fragment>> {
  const cards = new Map<string, Fragment>();
  if (nodeIds.length === 0) return cards;
  const documents = await ctx.db.controlledDocument.findMany({
    where: {
      nodeId: { in: [...nodeIds] },
      publishedVersion: { not: null },
      node: { trashedAt: null },
    },
    select: {
      nodeId: true,
      code: true,
      docType: true,
      ownerDepartmentId: true,
      reviewDueAt: true,
      publishedVersion: true,
      node: { select: { id: true, name: true, type: true, spaceId: true, parentId: true } },
    },
  });
  if (documents.length === 0) return cards;
  const published = documents.flatMap((d) =>
    d.publishedVersion === null ? [] : [{ nodeId: d.nodeId, version: d.publishedVersion }],
  );
  const [versions, approvals, types, departments] = await Promise.all([
    ctx.db.documentVersion.findMany({
      where: { OR: published },
      select: {
        nodeId: true,
        version: true,
        effectiveAt: true,
        publishedAt: true,
        approvedAt: true,
      },
    }),
    ctx.db.approval.findMany({
      where: { OR: published.map((p) => ({ ...p, decision: "APPROVED" })) },
      select: { nodeId: true, approverId: true, decidedAt: true, round: true },
    }),
    ctx.db.documentType.findMany({ select: { code: true, name: true } }),
    ctx.db.department.findMany({ select: { id: true, name: true } }),
  ]);
  const people = new Map(
    (
      await ctx.db.membership.findMany({
        where: { id: { in: [...new Set(approvals.map((a) => a.approverId))] } },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((member) => [member.id, member.user.name]),
  );
  const typeName = new Map(types.map((type) => [type.code, type.name]));
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));

  for (const document of documents) {
    const version = versions.find(
      (v) => v.nodeId === document.nodeId && v.version === document.publishedVersion,
    );
    // Quienes aprobaron en la última ronda de esa versión.
    const own = approvals.filter((a) => a.nodeId === document.nodeId);
    const lastRound = own.reduce<number>((max, a) => Math.max(max, a.round.getTime()), 0);
    const approvers = [
      ...new Set(
        own
          .filter((a) => a.round.getTime() === lastRound)
          .flatMap((a) => (people.has(a.approverId) ? [people.get(a.approverId) ?? ""] : [])),
      ),
    ];
    const approvedAt =
      version?.approvedAt ??
      own.reduce<Date | null>(
        (latest, a) =>
          a.decidedAt !== null && (latest === null || a.decidedAt > latest) ? a.decidedAt : latest,
        null,
      );
    const lines = [
      `Código: ${document.code}`,
      `Título: ${document.node.name}`,
      `Tipo: ${typeName.get(document.docType) ?? document.docType}`,
      `Versión vigente: v${String(document.publishedVersion)}`,
      "Estado: Vigente",
      `En vigor desde: ${dateText(version?.effectiveAt ?? version?.publishedAt ?? null)}`,
      `Aprobado por: ${approvers.length === 0 ? "sin registro" : approvers.join(" y ")}${approvedAt === null ? "" : `, el ${dateText(approvedAt)}`}`,
      `Departamento responsable: ${document.ownerDepartmentId === null ? "sin departamento" : (departmentName.get(document.ownerDepartmentId) ?? "sin departamento")}`,
      `Próxima revisión: ${document.reviewDueAt === null ? "sin fecha definida" : dateText(document.reviewDueAt)}`,
    ];
    cards.set(document.nodeId, {
      chunkId: `card:${document.nodeId}`,
      nodeId: document.node.id,
      nodeType: document.node.type,
      title: document.node.name,
      code: document.code,
      version: document.publishedVersion,
      heading: CARD_HEADING,
      seq: -1,
      text: lines.join("\n"),
      spaceId: document.node.spaceId,
      parentId: document.node.parentId,
      card: true,
    });
  }
  return cards;
}
