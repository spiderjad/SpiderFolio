// Ítems del menú lateral según las capacidades de la persona (10.4). Solo se muestra lo que
// existe y lo que puede usar; un ítem sin permiso no aparece, ni deshabilitado.
import {
  BookOpen,
  ClipboardCheck,
  FileCheck2,
  FolderOpen,
  Gauge,
  KeyRound,
  Home,
  Share2,
  Lock,
  Sparkles,
  Network,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { FrontendPlugin, Icon } from "@spiderfolio/plugin-sdk/frontend";
import type { Membership } from "@/auth/types";
import { allowed, pluginAdminPath, pluginPath } from "@/plugins/registry";
import { texts } from "@/i18n";

export interface NavItem {
  to: string;
  label: string;
  /** De lucide-react, o el ícono de un plugin. */
  icon: Icon;
  end?: boolean;
  /** Etiqueta del grupo (en mayúsculas espaciadas); sin grupo, va arriba. */
  group?: string;
  /** In the admin menu: listed under «Plugins» (License and plugins and the plugins' sections). */
  plugins?: true;
}

/** Capacidades que abren cada sección del panel: alcanza con una. */
export const adminSections = {
  members: ["members.view", "members.manage"],
  departments: ["departments.manage"],
  roles: ["roles.manage"],
  access: ["permissions.audit"],
  documents: ["documents.approve", "documents.require_reading"],
  security: ["security.manage"],
  /** Bian: seguridad o facturación. */
  bian: ["security.manage", "workspace.settings"],
  /** Plan y consumo: solo facturación. */
  /** Licencia y plugins: solo el propietario (lo hace cumplir el servidor). */
  license: ["workspace.settings"],
  limits: ["workspace.settings", "storage.view"],
  audit: ["audit.view"],
} as const;

type Person = Pick<Membership, "role" | "capabilities" | "leadsDepartments" | "seatType">;

/**
 * Qué secciones ve la persona (docs/spec/personas.md): propietario y administradores, por
 * capacidad; jefe y subjefe ven Miembros ("Mi equipo") y Departamentos por su cargo; Seguridad,
 * por capacidad (la pestaña General es solo del propietario). Departamentos también lo ve todo miembro con plaza completa (solo lectura;
 * lectores e invitados, no). Seguridad: por capacidad. El servidor lo hace cumplir; esto solo evita mostrar lo que se va a
 * negar.
 */
export function canSee(person: Person, section: keyof typeof adminSections): boolean {
  const { role, capabilities } = person;
  const byCapability = adminSections[section].some((capability) =>
    capabilities.includes(capability),
  );
  // Seguridad: la ven quienes tienen la capacidad (los administradores solo la pestaña Email).
  if (section === "license") return role.base === "OWNER";
  if (section === "security" || section === "bian" || section === "limits" || section === "audit")
    return byCapability;
  if (section === "roles" || section === "access") return byCapability;
  // Documentos: quien tiene las capacidades, o un jefe (ve solo su área).
  if (section === "documents") return byCapability || person.leadsDepartments;
  if (role.base === "OWNER" || role.base === "ADMIN") return byCapability;
  if (section === "departments") return role.base === "MEMBER" && person.seatType === "FULL";
  return person.leadsDepartments;
}

export function navItems(
  slug: string,
  person: Person,
  plugins: readonly FrontendPlugin[] = [],
): NavItem[] {
  const t = texts.admin.nav;
  const items: NavItem[] = [
    { to: `/app/${slug}`, label: texts.shell.home, icon: Home, end: true },
    { to: `/app/${slug}/mis-documentos`, label: texts.documents.mine.title, icon: BookOpen },
    { to: `/app/${slug}/files`, label: texts.files.nav, icon: FolderOpen },
    { to: `/app/${slug}/files/shared`, label: texts.files.shared.title, icon: Share2 },
  ];
  // Quien puede aprobar documentos (por capacidad o por cargo de jefe) tiene su bandeja.
  if (person.capabilities.includes("documents.approve") || person.leadsDepartments) {
    items.push({
      to: `/app/${slug}/aprobaciones`,
      label: texts.documents.nav,
      icon: ClipboardCheck,
    });
  }
  if (canSee(person, "members")) {
    items.push({ to: `/app/${slug}/admin/members`, label: t.members, icon: Users, group: t.group });
  }
  if (canSee(person, "departments")) {
    // Quien administra o lidera lo tiene en Gestión; el resto, solo para mirar, junto a Archivos.
    const manages =
      person.role.base === "OWNER" || person.role.base === "ADMIN" || person.leadsDepartments;
    items.push({
      to: `/app/${slug}/admin/departments`,
      label: t.departments,
      icon: Network,
      ...(manages ? { group: t.group } : {}),
    });
  }
  if (canSee(person, "roles")) {
    items.push({
      to: `/app/${slug}/admin/roles`,
      label: t.roles,
      icon: ShieldCheck,
      group: t.group,
    });
  }
  if (canSee(person, "documents")) {
    items.push({
      to: `/app/${slug}/admin/documents`,
      label: texts.documents.admin.title,
      icon: FileCheck2,
      group: t.group,
    });
  }
  if (canSee(person, "access")) {
    items.push({
      to: `/app/${slug}/admin/access`,
      label: t.access,
      icon: ScanSearch,
      group: t.group,
    });
  }
  if (canSee(person, "security")) {
    items.push({
      to: `/app/${slug}/admin/security`,
      label: t.security,
      icon: Lock,
      group: t.group,
    });
  }
  if (canSee(person, "bian")) {
    items.push({
      to: `/app/${slug}/admin/bian`,
      label: t.bian,
      icon: Sparkles,
      group: t.group,
    });
  }
  if (canSee(person, "limits")) {
    items.push({
      to: `/app/${slug}/admin/limits`,
      label: t.limits,
      icon: Gauge,
      group: t.group,
    });
  }
  if (canSee(person, "license")) {
    items.push({
      to: `/app/${slug}/admin/license`,
      label: t.license,
      icon: KeyRound,
      group: t.group,
      plugins: true,
    });
  }
  if (canSee(person, "audit")) {
    items.push({
      to: `/app/${slug}/admin/audit`,
      label: t.audit,
      icon: ScrollText,
      group: t.group,
    });
  }
  // Plugins activos: sus pantallas en el menú principal y sus secciones en el panel.
  for (const plugin of plugins) {
    for (const item of plugin.navItems ?? []) {
      if (!allowed(person, item.anyCapability)) continue;
      items.push({ to: pluginPath(slug, plugin.id, item.to), label: item.label, icon: item.icon });
    }
    for (const section of plugin.adminSections ?? []) {
      if (!allowed(person, section.anyCapability)) continue;
      if (section.ownerOnly === true && person.role.base !== "OWNER") continue;
      items.push({
        to: pluginAdminPath(slug, plugin.id, section.id),
        label: section.label,
        icon: section.icon,
        group: t.group,
        plugins: true,
      });
    }
  }
  return items;
}

/** El menú principal: lo de todos los días (lo que no es del panel de administración). */
export function mainNavItems(
  slug: string,
  person: Person,
  plugins: readonly FrontendPlugin[] = [],
): NavItem[] {
  return navItems(slug, person, plugins).filter((item) => item.group === undefined);
}

/** Las secciones del panel de administración que la persona puede usar. */
export function adminNavItems(
  slug: string,
  person: Person,
  plugins: readonly FrontendPlugin[] = [],
): NavItem[] {
  return navItems(slug, person, plugins).filter((item) => item.group !== undefined);
}

/** Título de la barra superior según la ruta. */
export function sectionTitle(pathname: string, plugins: readonly FrontendPlugin[] = []): string {
  const pluginMatch = /^\/app\/[^/]+\/(admin\/)?p\/([^/]+)(?:\/([^/]+))?/u.exec(pathname);
  if (pluginMatch !== null) {
    const [, admin, pluginId, segment = ""] = pluginMatch;
    const plugin = plugins.find((p) => p.id === pluginId);
    const title =
      admin === undefined
        ? (
            plugin?.screens?.find((s) => s.path === segment) ??
            plugin?.screens?.find((s) => s.path === "")
          )?.title
        : plugin?.adminSections?.find((s) => s.id === segment)?.label;
    if (title !== undefined) return title;
  }
  if (pathname.includes("/admin/members")) return texts.admin.nav.members;
  if (pathname.includes("/admin/documents")) return texts.documents.admin.title;
  if (pathname.includes("/search")) return texts.search.page.title;
  if (pathname.includes("/mis-documentos")) return texts.documents.mine.title;
  if (pathname.includes("/aprobaciones")) return texts.documents.nav;
  if (pathname.includes("/files/shared")) return texts.files.shared.title;
  if (pathname.includes("/files")) return texts.files.nav;
  if (pathname.endsWith("/profile")) return texts.profile.title;
  if (pathname.includes("/admin/departments")) return texts.admin.nav.departments;
  if (pathname.includes("/admin/roles")) return texts.admin.nav.roles;
  if (pathname.includes("/admin/access")) return texts.admin.nav.access;
  if (pathname.includes("/admin/security")) return texts.admin.nav.security;
  if (pathname.includes("/admin/bian")) return texts.admin.nav.bian;
  if (pathname.includes("/admin/license")) return texts.admin.nav.license;
  if (pathname.includes("/admin/limits")) return texts.admin.nav.limits;
  if (pathname.includes("/admin/audit")) return texts.admin.nav.audit;
  return texts.dashboard.title;
}
