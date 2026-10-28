// Rutas bajo /api/v1/w/:workspaceSlug. Se declaran como datos para que el test de aislamiento
// entre tenants (tests/integration/tenant-isolation.test.ts) recorra todas: una ruta nueva
// que no esté cubierta ahí hace fallar el test.
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import type { Env } from "./config/env.ts";
import type Anthropic from "@anthropic-ai/sdk";
import type { Storage } from "./lib/storage.ts";
import type { EmailDomainProvider } from "./modules/email-settings/domain-provider.ts";
import type { Jobs } from "./jobs/boss.ts";
import type { PrismaClient } from "./lib/prisma.ts";
import { limitsRoutes } from "./modules/limits/limits.routes.ts";
import type { Passwords } from "./modules/auth/passwords.ts";
import type { Capability } from "./modules/roles/capabilities.ts";
import { accessExplainRoutes } from "./modules/access/access-explain.routes.ts";
import { accessAuditRoutes } from "./modules/access/access-audit.routes.ts";
import { memberRoutes } from "./modules/members/members.routes.ts";
import { invitationRoutes } from "./modules/invitations/invitations.routes.ts";
import { departmentRoutes } from "./modules/departments/departments.routes.ts";
import { directoryRoutes } from "./modules/directory/directory.routes.ts";
import { fileRoutes } from "./modules/files/files.routes.ts";
import { importRoutes } from "./modules/imports/imports.routes.ts";
import { trashRoutes } from "./modules/trash/trash.routes.ts";
import { nodeRoutes } from "./modules/nodes/nodes.routes.ts";
import { commentRoutes } from "./modules/comments/comments.routes.ts";
import { linkRoutes } from "./modules/nodes/links.routes.ts";
import { notificationRoutes } from "./modules/notifications/notifications.routes.ts";
import { adminDocumentRoutes } from "./modules/documents/admin-documents.routes.ts";
import { documentRoutes } from "./modules/documents/documents.routes.ts";
import { searchRoutes } from "./modules/search/search.routes.ts";
import { qrRoutes } from "./modules/qr/qr.routes.ts";
import { pageRoutes } from "./modules/nodes/pages.routes.ts";
import { spaceRoutes } from "./modules/spaces/spaces.routes.ts";
import type { RestartWatch } from "./plugins/restart.ts";
import { securityRoutes } from "./modules/security/security.routes.ts";
import { bianRoutes } from "./modules/bian/bian.routes.ts";
import { emailSettingsRoutes } from "./modules/email-settings/email-settings.routes.ts";
import { auditLogRoutes } from "./modules/audit/audit-log.routes.ts";
import { roleRoutes } from "./modules/roles/roles.routes.ts";
import { workspaceRoutes } from "./modules/workspaces/workspaces.routes.ts";
import { pluginRoutes } from "./modules/plugins/plugins.routes.ts";
import { pluginTenantRoutes } from "./plugins/routing.ts";
import type { PluginRuntime } from "./plugins/runtime.ts";

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
  jobs: Jobs;
  passwords: Passwords;
  /** Plugins instalados y su activación por licencia (docs/spec/plugins.md). */
  plugins: PluginRuntime;
  /** The announced restart this process follows (plugins/restart.ts); tests go without it. */
  restart?: RestartWatch;
  storage: Storage;
  /** Bucket de sistema (ZIP generados en segundo plano). */
  systemStorage: Storage;
  /** Solo para pruebas: subidas por partes con umbral y partes chicas. */
  /** Cliente de la API de Anthropic para Bian; solo existe con BIAN_ENABLED=true. */
  anthropic?: Anthropic;
  /** Solo para pruebas: reemplaza al proveedor de email de dominios verificados del entorno. */
  emailDomainProvider?: EmailDomainProvider;
  uploads?: { multipartThresholdBytes: number; partSizeBytes: number };
}

export interface TenantRoute {
  method: "get" | "post" | "put" | "patch" | "delete";
  /** Relativa a /api/v1/w/:workspaceSlug. */
  path: string;
  /** Exige todas estas capacidades. */
  capability?: Capability | readonly Capability[];
  /** Exige al menos una de estas capacidades (para lecturas que usan varias pantallas). */
  anyCapability?: readonly Capability[];
  /** Solo el propietario. */
  ownerOnly?: boolean;
  /**
   * Además de las capacidades, deja pasar a jefes y subjefes (por cargo); el servicio acota su
   * alcance. Con `anyCapability`.
   */
  leaderAccess?: boolean;
  /** Además, deja pasar a todo miembro con plaza completa (lectura); el servicio acota. */
  memberAccess?: boolean;
  /** Guardas extra (ej. rate limit de acciones sensibles), después de las capacidades. */
  guards?: readonly RequestHandler[];
  handler: RequestHandler;
}

/** Las rutas solo usan req.db (forTenant) y servicios; nunca el cliente base para datos de
 * tenant. */
export function tenantRoutes(deps: AppDeps): TenantRoute[] {
  return [
    ...workspaceRoutes(deps),
    ...limitsRoutes(),
    ...roleRoutes(deps),
    ...auditLogRoutes(deps),
    ...departmentRoutes(),
    ...invitationRoutes(deps),
    ...memberRoutes(deps),
    ...directoryRoutes(),
    ...securityRoutes(),
    ...emailSettingsRoutes(deps),
    ...bianRoutes(deps),
    ...spaceRoutes(),
    ...accessExplainRoutes(deps),
    ...accessAuditRoutes(),
    ...nodeRoutes(deps),
    ...linkRoutes(),
    ...documentRoutes(deps),
    ...qrRoutes(deps),
    ...searchRoutes(deps),
    ...adminDocumentRoutes(),
    ...notificationRoutes(),
    ...pageRoutes(deps),
    ...commentRoutes(deps),
    ...fileRoutes(deps),
    ...trashRoutes(deps),
    ...importRoutes(deps),
    ...pluginRoutes(deps),
    // Al final: las rutas de los plugins viven bajo /plugins/<id>.
    ...pluginTenantRoutes(deps),
  ];
}
