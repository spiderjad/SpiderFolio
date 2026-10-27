// Registro de auditoría append-only (CLAUDE.md, sección 6). metadata nunca lleva contenido de
// documentos ni secretos.
import type { TenantDb } from "../../db/tenant.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaClient } from "../../lib/prisma.ts";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonObject;
}

const toData = (entry: AuditEntry) => ({
  actorId: entry.actorId ?? null,
  action: entry.action,
  entityType: entry.entityType ?? null,
  entityId: entry.entityId ?? null,
  ip: entry.ip ?? null,
  userAgent: entry.userAgent ?? null,
  ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
});

/** Evento de un workspace (el workspaceId lo pone forTenant). */
export async function audit(db: TenantDb, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({ data: toData(entry) });
}

/** Evento sin workspace (ej. login fallido) o dentro de una transacción con el cliente base. */
export async function auditGlobal(
  client: PrismaClient | Prisma.TransactionClient,
  entry: AuditEntry & { workspaceId?: string | null },
): Promise<void> {
  await client.auditLog.create({
    data: { ...toData(entry), workspaceId: entry.workspaceId ?? null },
  });
}
