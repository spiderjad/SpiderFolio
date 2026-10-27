// Valoraciones de las respuestas de Bian: solo valoración, motivo opcional, fecha y los ids de los
// documentos citados (los que existen en este workspace). Nunca el texto de la pregunta o la
// respuesta, ni quién valoró: por eso quien valora guarda el id que se le devuelve y con él puede
// cambiar o quitar su valoración (el id es aleatorio y solo vale dentro de la empresa).
import { feedbackByNode, feedbackTotals } from "../../db/raw/bian-feedback.ts";
import { notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, type Page, type PageQuery } from "../../lib/pagination.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { visibleSpacesWhere } from "../spaces/spaces.service.ts";

export const FEEDBACK_REASONS = ["INCORRECT", "INCOMPLETE", "WRONG_SOURCE", "OTHER"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export async function saveFeedback(
  ctx: AdminContext,
  input: { rating: "UP" | "DOWN"; reason?: FeedbackReason | undefined; nodeIds: readonly string[] },
): Promise<{ id: string }> {
  const known = await ctx.db.node.findMany({
    where: { id: { in: [...input.nodeIds] } },
    select: { id: true },
  });
  const row = await ctx.db.bianFeedback.create({
    data: {
      rating: input.rating,
      // El motivo solo existe en un 👎.
      reason: input.rating === "DOWN" ? (input.reason ?? null) : null,
      nodeIds: known.map((node) => node.id),
    },
    select: { id: true },
  });
  return row;
}

/** Cambia la valoración (👍 ↔ 👎) o agrega el motivo de un 👎. */
export async function updateFeedback(
  ctx: AdminContext,
  id: string,
  input: { rating?: "UP" | "DOWN" | undefined; reason?: FeedbackReason | null | undefined },
): Promise<void> {
  const current = await ctx.db.bianFeedback.findFirst({
    where: { id },
    select: { rating: true },
  });
  if (current === null) throw notFound();
  const rating = input.rating ?? current.rating;
  await ctx.db.bianFeedback.update({
    where: { id },
    data: {
      ...(input.rating === undefined ? {} : { rating: input.rating }),
      // Un 👍 no lleva motivo; en un 👎 solo cambia si llega uno.
      ...(rating === "UP"
        ? { reason: null }
        : input.reason === undefined
          ? {}
          : { reason: input.reason }),
    },
  });
}

/** Quita la valoración (tocar de nuevo el botón elegido). */
export async function removeFeedback(ctx: AdminContext, id: string): Promise<void> {
  const { count } = await ctx.db.bianFeedback.deleteMany({ where: { id } });
  if (count === 0) throw notFound();
}

// ─── Vista de Administración ─────────────────────────────────────────────────────────────

const DEFAULT_DAYS = 90;

export interface FeedbackStatsQuery extends PageQuery {
  /** Solo las valoraciones de este tipo. */
  rating?: "UP" | "DOWN" | undefined;
  /** Texto en el nombre o el código del documento. */
  q?: string | undefined;
  /** Fechas (inclusive); sin ellas, los últimos 90 días. */
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface FeedbackStats {
  /** Los números de lo filtrado (no solo de la página). */
  total: number;
  up: number;
  down: number;
  /** Porcentaje de 👍 sobre todas las valoraciones (null si todavía no hay). */
  percentUp: number | null;
  since: Date;
  until: Date | null;
  /** Documentos citados (de a una página), los que más 👎 tienen primero. */
  documents: Page<{
    node: { id: string; name: string; spaceName: string };
    code: string | null;
    up: number;
    down: number;
    reasons: Record<FeedbackReason | "NONE", number>;
  }>;
}

/**
 * Cuántos 👍 y 👎 hubo y, por documento citado, cuántos de cada uno (y por qué los 👎): sirve para ver
 * qué documentos confunden a Bian. Con filtros por valoración, documento y fecha, y paginado. Solo
 * documentos que quien pide puede ver.
 */
export async function feedbackStats(
  ctx: AdminContext,
  { prisma }: { prisma: PrismaClient },
  query: FeedbackStatsQuery,
  now: Date = new Date(),
): Promise<FeedbackStats> {
  const since = query.from ?? new Date(now.getTime() - DEFAULT_DAYS * 24 * 3600 * 1000);
  // «hasta» incluye el día entero.
  const until =
    query.to === undefined ? undefined : new Date(query.to.getTime() + 24 * 3600 * 1000);
  const params = {
    workspaceId: ctx.tenant.workspaceId,
    since,
    until,
    rating: query.rating,
  };
  const [totals, rows] = await Promise.all([
    feedbackTotals(prisma, params),
    feedbackByNode(prisma, params),
  ]);

  const needle = (query.q ?? "").trim().toLowerCase();
  const nodes = await ctx.db.node.findMany({
    where: {
      id: { in: [...new Set(rows.map((row) => row.nodeId))] },
      trashedAt: null,
      space: visibleSpacesWhere(ctx, now),
    },
    select: {
      id: true,
      name: true,
      space: { select: { name: true } },
      controlled: { select: { code: true } },
    },
  });
  const byNode = new Map(
    nodes
      .filter(
        (node) =>
          needle === "" ||
          node.name.toLowerCase().includes(needle) ||
          (node.controlled?.code.toLowerCase().includes(needle) ?? false),
      )
      .map((node) => [node.id, node]),
  );
  const documents = new Map<string, FeedbackStats["documents"]["items"][number]>();
  for (const row of rows) {
    const node = byNode.get(row.nodeId);
    if (node === undefined) continue;
    const entry = documents.get(node.id) ?? {
      node: { id: node.id, name: node.name, spaceName: node.space.name },
      code: node.controlled?.code ?? null,
      up: 0,
      down: 0,
      reasons: { INCORRECT: 0, INCOMPLETE: 0, WRONG_SOURCE: 0, OTHER: 0, NONE: 0 },
    };
    if (row.rating === "UP") entry.up += row.count;
    else {
      entry.down += row.count;
      const reason = FEEDBACK_REASONS.find((candidate) => candidate === row.reason) ?? "NONE";
      entry.reasons[reason] += row.count;
    }
    documents.set(node.id, entry);
  }
  const ordered = [...documents.values()].sort(
    (a, b) => b.down - a.down || b.up - a.up || a.node.name.localeCompare(b.node.name, "es"),
  );
  const { skip, take } = offsetArgs(query);
  const count = (rating: string) => totals.find((row) => row.rating === rating)?.count ?? 0;
  const up = count("UP");
  const down = count("DOWN");
  return {
    total: up + down,
    up,
    down,
    percentUp: up + down === 0 ? null : Math.round((up / (up + down)) * 100),
    since,
    until: until ?? null,
    documents: pageOf(ordered.slice(skip, skip + take), ordered.length, query),
  };
}
