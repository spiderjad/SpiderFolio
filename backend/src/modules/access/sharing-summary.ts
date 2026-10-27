// Resumen de con quién está compartido algo (el ícono «compartido» del explorador y de los espacios).
// Solo se calcula para lo que la persona puede gestionar: quien no gestiona no ve con quién se compartió.
// No cuenta el acceso que se da a sí misma quien crea un espacio.
import type { AdminContext } from "../admin/admin-context.ts";
import { contentMessages } from "../../i18n/index.ts";
import { expiryFilter } from "./access.ts";

export interface SharingSummary {
  /** Cuántos accesos dados (personas y departamentos). */
  count: number;
  /** Hasta tres nombres, para el tooltip. */
  names: string[];
  /** El vencimiento más próximo, si alguno vence. */
  expiresAt: Date | null;
}

/** Resumen por id (solo los que tienen accesos dados). */
export async function sharingSummaries(
  ctx: AdminContext,
  target: { type: "node" | "space"; ids: readonly string[] },
): Promise<Map<string, SharingSummary>> {
  const result = new Map<string, SharingSummary>();
  if (target.ids.length === 0) return result;
  const idField = target.type === "node" ? "nodeId" : "spaceId";
  const rows = await ctx.db.permission.findMany({
    where: { [idField]: { in: [...target.ids] }, AND: [expiryFilter(new Date())] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      nodeId: true,
      spaceId: true,
      membershipId: true,
      everyone: true,
      grantedById: true,
      expiresAt: true,
      department: { select: { name: true } },
      membership: { select: { user: { select: { name: true } } } },
    },
  });
  for (const row of rows) {
    if (row.membershipId !== null && row.membershipId === row.grantedById) continue;
    const id = target.type === "node" ? row.nodeId : row.spaceId;
    const name = row.everyone
      ? contentMessages.companyName
      : (row.department?.name ?? row.membership?.user.name);
    if (id === null || name === undefined) continue;
    const current = result.get(id) ?? { count: 0, names: [], expiresAt: null };
    current.count += 1;
    if (current.names.length < 3 && !current.names.includes(name)) current.names.push(name);
    if (
      row.expiresAt !== null &&
      (current.expiresAt === null || row.expiresAt < current.expiresAt)
    ) {
      current.expiresAt = row.expiresAt;
    }
    result.set(id, current);
  }
  return result;
}
