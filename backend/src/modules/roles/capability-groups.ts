// Capacidades agrupadas por área para el editor de roles (CLAUDE.md, sección 9.3). La API
// devuelve ids; las etiquetas y explicaciones viven en la app (textos centralizados).
import type { Capability } from "./capabilities.ts";

export const capabilityGroups = [
  {
    id: "members",
    capabilities: [
      "members.view",
      "members.invite",
      "members.manage",
      "members.suspend",
      "members.pin",
    ],
  },
  {
    id: "organization",
    capabilities: ["departments.manage", "roles.manage"],
  },
  {
    id: "content",
    capabilities: [
      "spaces.create",
      "spaces.manage",
      "content.bypass",
      "permissions.audit",
      "files.manage_trash",
      "storage.view",
    ],
  },
  {
    id: "documents",
    capabilities: [
      "documents.approve",
      "documents.require_reading",
      "content.public_qr",
      "audit.share",
      "expirations.manage",
    ],
  },
  { id: "audit", capabilities: ["audit.view", "audit.export"] },
  {
    id: "administration",
    capabilities: ["security.manage", "workspace.settings"],
  },
] as const satisfies readonly { id: string; capabilities: readonly Capability[] }[];
