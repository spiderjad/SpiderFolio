// Capacidades administrativas (CLAUDE.md, sección 9.2) y los 4 roles de sistema (9.1).
import type { PluginCapabilityId } from "@spiderfolio/plugin-sdk";
import type { SystemRole } from "../../generated/prisma/client.ts";

export const capabilities = [
  "members.view",
  "members.invite",
  "members.manage",
  "members.suspend",
  "members.pin",
  "departments.manage",
  "roles.manage",
  "spaces.create",
  "spaces.manage",
  "content.bypass",
  "permissions.audit",
  "files.manage_trash",
  "storage.view",
  "documents.approve",
  "documents.require_reading",
  "content.public_qr",
  "audit.share",
  "expirations.manage",
  "audit.view",
  "audit.export",
  "security.manage",
  "workspace.settings",
] as const;

/** Las del núcleo. */
export type CoreCapability = (typeof capabilities)[number];

/** Del núcleo o de un plugin instalado («<plugin>:<nombre>», docs/spec/plugins.md). */
export type Capability = CoreCapability | PluginCapabilityId;

/** Capacidades de los plugins instalados; las registra el arranque (createApp o el worker). */
const pluginCapabilities = new Set<string>();

export function registerPluginCapabilities(ids: Iterable<string>): void {
  for (const id of ids) pluginCapabilities.add(id);
}

/** Capacidades de plugins registradas (el propietario las tiene todas). */
export function registeredPluginCapabilities(): PluginCapabilityId[] {
  return [...pluginCapabilities] as PluginCapabilityId[];
}

export function isCoreCapability(value: string): value is CoreCapability {
  return (capabilities as readonly string[]).includes(value);
}

/**
 * El alcance de jefes y subjefes no es una capacidad de rol: sale del cargo en el departamento
 * (DepartmentMember.position), sobre su área y subáreas. Ver docs/spec/personas.md.
 */

export function isCapability(value: string): value is Capability {
  return isCoreCapability(value) || pluginCapabilities.has(value);
}

/** El nombre y la descripción, en el idioma de quien crea la empresa: i18n `defaultDataTexts.roles`. */
export interface SystemRoleDefinition {
  base: SystemRole;
  capabilities: readonly Capability[];
}

/**
 * OWNER: todo. ADMIN: todo lo administrativo (la licencia de plugins, borrar el workspace y
 * transferir la propiedad se controlan por rol base OWNER, no por capacidad).
 * MEMBER y GUEST: sin capacidades administrativas.
 */
export const systemRoles: readonly SystemRoleDefinition[] = [
  {
    base: "OWNER",
    capabilities,
  },
  {
    base: "ADMIN",
    capabilities,
  },
  {
    base: "MEMBER",
    capabilities: [],
  },
  {
    base: "GUEST",
    capabilities: [],
  },
];
