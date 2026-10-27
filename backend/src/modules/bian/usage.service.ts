// Contador de consultas a Bian por mes calendario (UTC). Dos topes, los dos atómicos:
//   1. el de la persona (límite general, de su departamento o propio; ver limits.core.ts);
//   2. el total mensual de la empresa (`aiQueriesPerMonth` de Workspace.limits; sin fijar, sin tope).
// La reserva se devuelve si la consulta no llega a usarse. Solo cantidades: nunca contenido.
import { checkLimit } from "@spiderfolio/limits";
import { AppError } from "../../lib/errors.ts";
import { refundUsage, reserveUsage } from "../../db/raw/bian.ts";
import { refundMemberUsage, reserveMemberUsage } from "../../db/raw/bian-usage.ts";
import type { TenantDb } from "../../db/tenant.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { workspaceLimits } from "../limits/limits.service.ts";
import {
  crossedThreshold,
  effectiveRemaining,
  pickLimit,
  USAGE_THRESHOLDS,
  type PersonalLimit,
} from "./limits.core.ts";

export interface UsageDeps {
  prisma: PrismaClient;
}

export interface Period {
  start: Date;
  end: Date;
}

/** El mes calendario (UTC) de la fecha. */
export function usagePeriod(now: Date): Period {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) };
}

// ─── Total de la empresa ─────────────────────────────────────────────────────────────────

/** El total mensual de consultas de la empresa (null: sin límite). */
export async function companyTotal(db: TenantDb): Promise<number | null> {
  return (await workspaceLimits(db)).aiQueriesPerMonth;
}

// ─── Lo que ve la persona ────────────────────────────────────────────────────────────────

/** El límite que le toca a la persona que pide (el suyo, el de su departamento o el general). */
export async function personalLimitFor(ctx: AdminContext): Promise<PersonalLimit> {
  const rows = await ctx.db.bianLimit.findMany({
    where: {
      OR: [
        { scope: "GENERAL" },
        { scope: "PERSON", membershipId: ctx.tenant.membershipId },
        { scope: "DEPARTMENT", departmentId: { in: [...ctx.tenant.ownDepartmentIds] } },
      ],
    },
    select: { scope: true, departmentId: true, membershipId: true, mode: true, limit: true },
  });
  return pickLimit(rows, {
    membershipId: ctx.tenant.membershipId,
    departmentIds: new Set(ctx.tenant.ownDepartmentIds),
  });
}

export interface AiUsage {
  /** Consultas usadas en la empresa este período. */
  used: number;
  /** Total mensual de la empresa; null: sin límite. */
  limit: number | null;
  periodStart: Date;
  periodEnd: Date;
  /** Lo de quien pregunta. */
  personal: {
    used: number;
    /** null: sin tope propio. */
    limit: number | null;
    blocked: boolean;
    source: PersonalLimit["source"];
  };
  /** Lo que de verdad le queda a esta persona (el menor entre lo suyo y lo de la empresa); null: sin tope. */
  remaining: number | null;
}

export async function getAiUsage(
  ctx: AdminContext,
  _deps: UsageDeps,
  now: Date = new Date(),
): Promise<AiUsage> {
  const period = usagePeriod(now);
  const [total, counter, mine, personal] = await Promise.all([
    companyTotal(ctx.db),
    ctx.db.usageCounter.findFirst({
      where: { periodStart: period.start },
      select: { aiQueries: true },
    }),
    ctx.db.usageCounterMember.findFirst({
      where: { membershipId: ctx.tenant.membershipId, periodStart: period.start },
      select: { aiQueries: true },
    }),
    personalLimitFor(ctx),
  ]);
  const used = counter?.aiQueries ?? 0;
  const mineUsed = mine?.aiQueries ?? 0;
  return {
    used,
    limit: total,
    periodStart: period.start,
    periodEnd: period.end,
    personal: {
      used: mineUsed,
      limit: personal.mode === "LIMIT" ? personal.limit : null,
      blocked: personal.mode === "BLOCKED",
      source: personal.source,
    },
    remaining: effectiveRemaining(personal, mineUsed, { used, total }),
  };
}

// ─── Reserva ─────────────────────────────────────────────────────────────────────────────

export interface Reservation {
  /** Total de la empresa en el período después de reservar. */
  used: number;
  /** Devuelve la consulta a los dos contadores (fallo del proveedor, rechazo o sin evidencia). */
  refund(): Promise<void>;
}

/**
 * Reserva una consulta o falla con LIMIT_REACHED, diciendo cuál tope se agotó: `scope: "person"` (el
 * límite personal, o sin acceso) o `scope: "workspace"` (el total de la empresa).
 */
export async function reserveAiQuery(
  ctx: AdminContext,
  deps: UsageDeps,
  now: Date = new Date(),
): Promise<Reservation> {
  const period = usagePeriod(now);
  const limits = await workspaceLimits(ctx.db);
  const total = limits.aiQueriesPerMonth;
  const personal = await personalLimitFor(ctx);
  const workspaceId = ctx.tenant.workspaceId;
  const membershipId = ctx.tenant.membershipId;

  // 1. Lo de la persona (también se cuenta si no tiene tope: es el uso por persona).
  if (personal.mode === "BLOCKED") {
    throw new AppError("LIMIT_REACHED", {
      details: { scope: "person", limit: "aiQueriesPerPerson", blocked: true, used: 0, max: 0 },
    });
  }
  const personalMax = personal.mode === "LIMIT" ? personal.limit : null;
  const mine = await reserveMemberUsage(deps.prisma, {
    workspaceId,
    membershipId,
    periodStart: period.start,
    max: personalMax,
  });
  if (mine === null) {
    throw new AppError("LIMIT_REACHED", {
      details: {
        scope: "person",
        limit: "aiQueriesPerPerson",
        used: personalMax,
        max: personalMax,
      },
    });
  }
  const refundMine = () =>
    refundMemberUsage(deps.prisma, { workspaceId, membershipId, periodStart: period.start });

  // 2. El total de la empresa.
  let used: number | null;
  try {
    used = await reserveUsage(deps.prisma, { workspaceId, periodStart: period.start, max: total });
  } catch (error) {
    await refundMine();
    throw error;
  }
  if (used === null) {
    await refundMine();
    const counter = await ctx.db.usageCounter.findFirst({
      where: { periodStart: period.start },
      select: { aiQueries: true },
    });
    const check = checkLimit(limits, "aiQueriesPerMonth", {
      used: counter?.aiQueries ?? 0,
      requested: 1,
    });
    const details: Record<string, unknown> = { scope: "workspace", limit: "aiQueriesPerMonth" };
    if (!check.ok) {
      const { limit, used: current } = check.error;
      Object.assign(details, { limit, used: current, max: total });
    }
    throw new AppError("LIMIT_REACHED", { details });
  }

  // Avisos a administradores al 80 % y 95 % (uno por umbral y período).
  if (total !== null) {
    for (const percent of USAGE_THRESHOLDS) {
      if (crossedThreshold(used, total, percent)) {
        await notifyAdmins(ctx.db, {
          kind: "bian_usage",
          actorId: null,
          version: percent,
          dedupeKey: `bian-usage:${String(percent)}:${period.start.toISOString()}`,
        });
      }
    }
  }

  let refunded = false;
  return {
    used,
    async refund() {
      if (refunded) return;
      refunded = true;
      await Promise.all([
        refundUsage(deps.prisma, { workspaceId, periodStart: period.start }),
        refundMine(),
      ]);
    },
  };
}

// ─── Avisos a administradores ────────────────────────────────────────────────────────────

/** Las personas que administran Bian: el propietario y quienes tienen seguridad o ajustes de la empresa. */
export async function bianAdminIds(db: TenantDb): Promise<string[]> {
  const admins = await db.membership.findMany({
    where: {
      status: "ACTIVE",
      role: {
        OR: [
          { base: "OWNER" },
          { capabilities: { hasSome: ["security.manage", "workspace.settings"] } },
        ],
      },
    },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}

/** Un aviso de la campana para cada administrador; `dedupeKey` evita repetirlo. */
export async function notifyAdmins(
  db: TenantDb,
  input: {
    kind: "bian_usage" | "bian_request";
    actorId: string | null;
    /** En «bian_usage», el umbral (80 o 95). */
    version?: number;
    dedupeKey: string;
  },
): Promise<number> {
  const recipients = (await bianAdminIds(db)).filter((id) => id !== input.actorId);
  if (recipients.length === 0) return 0;
  const { count } = await db.notification.createMany({
    data: recipients.map((membershipId) => ({
      membershipId,
      kind: input.kind,
      ...(input.actorId === null ? {} : { actorId: input.actorId }),
      ...(input.version === undefined ? {} : { version: input.version }),
      dedupeKey: input.dedupeKey,
    })),
    skipDuplicates: true,
  });
  return count;
}

/** «Pedir más consultas»: avisa a los administradores (una vez por persona y período). */
export async function requestMoreQueries(
  ctx: AdminContext,
  now: Date = new Date(),
): Promise<{ notified: number }> {
  const period = usagePeriod(now);
  const notified = await notifyAdmins(ctx.db, {
    kind: "bian_request",
    actorId: ctx.tenant.membershipId,
    dedupeKey: `bian-request:${ctx.tenant.membershipId}:${period.start.toISOString()}`,
  });
  return { notified };
}
