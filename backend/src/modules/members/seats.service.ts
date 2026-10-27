// Plazas: completas y de lector. Sin planes no hay máximo: solo se cuentan para mostrarlas. Cuentan las
// membresías activas de cada tipo y las invitaciones pendientes (no vencidas ni revocadas) de ese tipo;
// los suspendidos no cuentan.
import type { TenantDb } from "../../db/tenant.ts";
import type { SeatType } from "../../generated/prisma/client.ts";

export type SeatUsage = Record<SeatType, number>;

export interface SeatSummary {
  used: number;
  /** Siempre null (sin límite); se mantiene por compatibilidad con la app. */
  max: number | null;
}

export async function seatUsage(db: TenantDb, now: Date = new Date()): Promise<SeatUsage> {
  const [members, invitations] = await Promise.all([
    db.membership.groupBy({
      by: ["seatType"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
    }),
    db.invitation.groupBy({
      by: ["seatType"],
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      _count: { _all: true },
    }),
  ]);
  const usage: SeatUsage = { FULL: 0, READER: 0 };
  for (const row of [...members, ...invitations]) usage[row.seatType] += row._count._all;
  return usage;
}

export async function seatSummary(db: TenantDb): Promise<Record<SeatType, SeatSummary>> {
  const usage = await seatUsage(db);
  return { FULL: { used: usage.FULL, max: null }, READER: { used: usage.READER, max: null } };
}
