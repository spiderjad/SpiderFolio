import type { TenantContext } from "../middleware/tenant.ts";
import type { TenantDb } from "../db/tenant.ts";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      /** Lo completa authMiddleware. */
      auth?: { userId: string; sessionId: string };
      /** Lo completa tenantMiddleware. */
      tenant?: TenantContext;
      /** Acceso a datos del workspace del request (forTenant). Lo completa tenantMiddleware. */
      db?: TenantDb;
    }
  }
}

export {};
