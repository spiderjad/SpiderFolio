// Configuración de Seguridad del workspace (docs/spec/personas.md): quién ve a quién en el
// directorio, si los jefes pueden invitar a su área, la autoaprobación y Bian. Se guarda en
// Workspace.settings. Las políticas avanzadas (exigir 2FA, dominios permitidos, SSO) son del plugin
// security-policies (docs/spec/plugins.md).
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import {
  readAllowSelfApproval,
  readBianEnabled,
  readBianGuests,
  readLeadersCanInvite,
  readMemberVisibility,
  type MemberVisibility,
} from "../workspaces/settings.ts";
import { readWorkspaceLocale, type Locale } from "../../i18n/locales.ts";

export interface SecuritySettings {
  memberVisibility: MemberVisibility;
  leadersCanInvite: boolean;
  allowSelfApproval: boolean;
  /** Bian, el asistente IA, activo en la empresa. */
  bianEnabled: boolean;
  /** Los invitados externos pueden usar a Bian. */
  bianGuests: boolean;
  /** Idioma por defecto de la empresa (docs/spec/i18n.md). */
  locale: Locale;
}

function read(settings: unknown): SecuritySettings {
  return {
    memberVisibility: readMemberVisibility(settings),
    leadersCanInvite: readLeadersCanInvite(settings),
    allowSelfApproval: readAllowSelfApproval(settings),
    bianEnabled: readBianEnabled(settings),
    bianGuests: readBianGuests(settings),
    locale: readWorkspaceLocale(settings),
  };
}

export async function getSecuritySettings(ctx: AdminContext): Promise<SecuritySettings> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return read(workspace?.settings);
}

export async function updateSecuritySettings(
  ctx: AdminContext,
  changes: { [K in keyof SecuritySettings]?: SecuritySettings[K] | undefined },
): Promise<SecuritySettings> {
  const workspace = await ctx.db.workspace.findFirstOrThrow({
    where: {},
    select: { id: true, settings: true },
  });
  const before = read(workspace.settings);
  const after: SecuritySettings = {
    memberVisibility: changes.memberVisibility ?? before.memberVisibility,
    leadersCanInvite: changes.leadersCanInvite ?? before.leadersCanInvite,
    allowSelfApproval: changes.allowSelfApproval ?? before.allowSelfApproval,
    bianEnabled: changes.bianEnabled ?? before.bianEnabled,
    bianGuests: changes.bianGuests ?? before.bianGuests,
    locale: changes.locale ?? before.locale,
  };
  const current =
    typeof workspace.settings === "object" && workspace.settings !== null
      ? (workspace.settings as Record<string, unknown>)
      : {};
  await ctx.db.workspace.update({
    where: { id: workspace.id },
    data: { settings: { ...current, ...after } },
  });
  await auditAdmin(ctx, {
    action: "security.visibility.update",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: {
      before: { ...before },
      // Before and after carry every SecuritySettings field: none is left out of the log.
      after: { ...after },
    },
  });
  return after;
}
