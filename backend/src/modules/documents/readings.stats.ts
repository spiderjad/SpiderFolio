// Cumplimiento de lectura de varios documentos a la vez (Inicio). No tiene lógica propia: usa
// `readingPeopleOf`, la misma función del detalle de cada documento, así los números coinciden
// siempre (quien no tiene acceso al documento se descuenta y se cuenta aparte, en `noAccess`).
import type { TenantDb } from "../../db/tenant.ts";
import { readingPeopleOf, summarize, type ReadingSummary } from "./readings.core.ts";

export interface PublishedDoc {
  nodeId: string;
  /** Versión vigente. */
  version: number;
}

export type ReadingStats = ReadingSummary & { nodeId: string };

/** Tope de documentos por consulta (el OR de pares documento-versión se mantiene acotado). */
export const MAX_STATS_DOCS = 500;

export async function readingStatsFor(
  db: TenantDb,
  docs: readonly PublishedDoc[],
  now: Date = new Date(),
): Promise<Map<string, ReadingStats>> {
  const detail = await readingPeopleOf(db, docs.slice(0, MAX_STATS_DOCS), now);
  return new Map(
    [...detail].map(([nodeId, { people }]) => [nodeId, { nodeId, ...summarize(people) }]),
  );
}

/** Cumplimiento sobre quienes pueden leer: lo leído sobre lo pedido, sin contar a quien no ve el documento. */
export function compliancePercent(stats: Iterable<ReadingSummary>): number | null {
  let required = 0;
  let read = 0;
  for (const row of stats) {
    required += row.total - row.noAccess;
    read += row.read;
  }
  return required === 0 ? null : Math.round((read / required) * 100);
}
