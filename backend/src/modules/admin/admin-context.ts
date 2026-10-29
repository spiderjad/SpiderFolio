// Contexto común de los endpoints del panel (9.4): base de datos del tenant, quién actúa y los
// datos del pedido para el AuditLog.
import type { Request } from "express";
import type { TenantDb } from "../../db/tenant.ts";
import { auditInfo, tenantOf, type TenantContext } from "../../middleware/tenant.ts";
import type { AuditEntry, AuditVia } from "../audit/audit.service.ts";
import { audit } from "../audit/audit.service.ts";
import type { Actor } from "../roles/role-rules.ts";

export interface AdminContext {
  db: TenantDb;
  tenant: TenantContext;
  actor: Actor;
  /** Who and from where, for the AuditLog; `via` when it's done through the connector for Claude. */
  info: ReturnType<typeof auditInfo> & { via?: AuditVia };
}

export function adminContextOf(req: Request): AdminContext {
  const { db, tenant } = tenantOf(req);
  return {
    db,
    tenant,
    actor: { base: tenant.role.base, capabilities: tenant.capabilities },
    info: auditInfo(req),
  };
}

/** Registra un evento del panel con quién actúa y desde dónde. */
export async function auditAdmin(
  ctx: Pick<AdminContext, "db" | "info">,
  entry: Omit<AuditEntry, "actorId" | "ip" | "userAgent">,
): Promise<void> {
  await audit(ctx.db, { ...entry, ...ctx.info });
}
