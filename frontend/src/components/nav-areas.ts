// Navigation by areas (docs/spec/diseno.md 10.4.1): the rail of areas and each area's menu. An area
// only appears with something to show the person; Quality stays defined but hidden until its module
// exists. Routes don't change: the active area is deduced from the address.
import {
  Route,
  GitPullRequestArrow,
  HeartHandshake,
  AlertTriangle,
  BadgeCheck,
  CalendarSearch,
  PackageX,
  ShieldAlert,
  SprayCan,
  FlaskConical,
  ClipboardX,
  Megaphone,
  MessageSquareWarning,
  BarChart3,
  BookMarked,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  FileCheck2,
  FileSearch,
  FolderOpen,
  GraduationCap,
  HardHat,
  Home,
  FileBadge,
  Leaf,
  Recycle,
  Droplets,
  Gauge,
  Snowflake,
  Wrench,
  Cog,
  Inbox,
  IdCard,
  Library,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Network,
  Package,
  Settings,
  Share2,
  ShieldCheck,
  Siren,
  Truck,
  Users,
  UsersRound,
} from "lucide-react";
import type { FrontendPlugin, Icon } from "@spiderfolio/plugin-sdk/frontend";
import type { HomeArea, Membership } from "@/auth/types";
import type { SpaceView } from "@/features/files/api";
import { allowed, pluginPath } from "@/plugins/registry";
import { texts } from "@/i18n";
import { adminNavItems, canSee, type NavItem } from "./nav-items";

export type AreaId = HomeArea;

/** An entry of an area's menu: a screen, or a space of the area (shown with its mark). */
export interface AreaItem extends NavItem {
  space?: SpaceView;
}

export interface Area {
  id: AreaId;
  label: string;
  short: string;
  icon: Icon;
  /** In order; `group` starts a labelled block («Espacios», «Plugins»…). */
  items: AreaItem[];
}

/** What the shell knows besides the membership: the spaces listed outside the Wiki, the committee. */
export interface AreaContext {
  /** The person's visible spaces of each non-Wiki area (a few: they're listed in the menu). */
  spaces: Partial<
    Record<
      "DOCUMENTS" | "PREVENTION" | "QUALITY" | "ENVIRONMENT" | "MAINTENANCE",
      readonly SpaceView[]
    >
  >;
  /** A current member of the health and safety committee (docs/spec/seguridad-salud.md). */
  committee: boolean;
}

const spaceItems = (slug: string, spaces: readonly SpaceView[] | undefined, group: string) =>
  (spaces ?? []).map<AreaItem>((space) => ({
    to: `/app/${slug}/files/${space.id}`,
    label: space.name,
    icon: FolderOpen,
    group,
    space,
  }));

/** Who manages departments sees them in Administración; the rest, read only, in the Wiki. */
const managesDepartments = (person: Membership) =>
  person.role.base === "OWNER" || person.role.base === "ADMIN" || person.leadsDepartments;

/** The admin sections that live in another area (Documentación) instead of Administración. */
function movedOutOfAdmin(slug: string): Set<string> {
  return new Set([`/app/${slug}/admin/documents`, `/app/${slug}/admin/audit-rooms`]);
}

function preventionItems(slug: string, person: Membership, context: AreaContext): AreaItem[] {
  const safety = person.workspace.safety;
  const caps = person.capabilities;
  const manage = caps.includes("safety.manage");
  const health = caps.includes("safety.health");
  const leads = person.leadsDepartments;
  const caeVisible = safety.cae && (caps.includes("cae.manage") || caps.includes("cae.check"));
  const terms = texts.safety.terms[safety.terms];
  const base = `/app/${slug}/seguridad`;
  const t = texts.safety;
  const a = texts.shell.areas;
  const items: AreaItem[] = [];
  if (safety.enabled && person.role.base !== "GUEST") {
    if (manage || health)
      items.push({ to: `${base}/resumen`, label: t.summary.tab, icon: LayoutDashboard });
    if (manage || health || leads) {
      items.push({ to: `${base}/personas`, label: t.people.tab, icon: Users });
      items.push({ to: `${base}/epis`, label: terms.ppes, icon: HardHat });
    }
    if (manage) items.push({ to: `${base}/epis/catalogo`, label: t.tabs.catalog, icon: Package });
    if (manage || health || leads)
      items.push({ to: `${base}/formacion`, label: t.training.tab, icon: GraduationCap });
    if (health)
      items.push({ to: `${base}/incidentes`, label: t.incidents.tab, icon: AlertTriangle });
    if (manage)
      items.push({ to: `${base}/planificacion`, label: t.planning.tab, icon: ListChecks });
    if (manage || health)
      items.push({ to: `${base}/indicadores`, label: t.indicators.tab, icon: BarChart3 });
    if (manage) items.push({ to: `${base}/emergencias`, label: t.emergencies.tab, icon: Siren });
    if (manage || context.committee)
      items.push({ to: `${base}/comite`, label: t.committee.tab, icon: UsersRound });
  }
  if (caeVisible) {
    items.push({ to: `${base}/cae`, label: texts.cae.terms[safety.terms].tab, icon: Truck });
  }
  if (safety.enabled && person.role.base !== "GUEST") {
    // Each person's own: their sheet, their measures and reporting an accident.
    const mine = texts.shell.areas.mySheet;
    items.push({ to: `${base}/personas/${person.id}`, label: mine, icon: IdCard, group: a.mine });
    items.push({ to: `${base}/medidas`, label: a.myActions, icon: ClipboardCheck, group: a.mine });
    items.push({ to: `${base}/comunicar`, label: a.report, icon: Siren, group: a.mine });
    items.push(...spaceItems(slug, context.spaces.PREVENTION, a.areaSpaces));
  }
  return items;
}

/** The Maintenance area (docs/spec/mantenimiento.md): with the module on, for maintenance and for whoever reports. */
function maintenanceItems(slug: string, person: Membership, context: AreaContext): AreaItem[] {
  if (!person.workspace.maintenance.enabled || person.role.base === "GUEST") return [];
  const caps = person.capabilities;
  const manage = caps.includes("maintenance.manage");
  const work = manage || caps.includes("maintenance.work");
  const base = `/app/${slug}/mantenimiento`;
  const n = texts.maintenance.nav;
  const items: AreaItem[] = [];
  if (caps.includes("maintenance.view") || work) {
    items.push({ to: `${base}/resumen`, label: n.summary, icon: LayoutDashboard });
  }
  // Everyone but guests reports (readers and user + PIN accounts included: shared tablets).
  items.push({ to: `${base}/avisar`, label: n.report, icon: Megaphone });
  if (work) items.push({ to: `${base}/ot?mias=1&estado=open`, label: n.mine, icon: ListTodo });
  items.push({ to: `${base}/ot`, label: n.workOrders, icon: Wrench });
  if (caps.includes("maintenance.view") || work) {
    items.push({ to: `${base}/preventivo`, label: n.preventive, icon: CalendarClock });
  }
  items.push({ to: `${base}/equipos`, label: n.assets, icon: Cog });
  items.push(...spaceItems(slug, context.spaces.MAINTENANCE, texts.shell.areas.areaSpaces));
  return items;
}

/** The Environment area (docs/spec/medio-ambiente.md): with the module on and an environment capability. */
function environmentItems(slug: string, person: Membership, context: AreaContext): AreaItem[] {
  if (!person.workspace.environment.enabled || person.role.base === "GUEST") return [];
  const caps = person.capabilities;
  const manage = caps.includes("environment.manage");
  const view = manage || caps.includes("environment.view");
  const record = manage || caps.includes("environment.record");
  if (!view && !record) return [];
  const base = `/app/${slug}/medio-ambiente`;
  const n = texts.environment.nav;
  const items: AreaItem[] = [];
  if (view) {
    items.push({ to: `${base}/resumen`, label: n.summary, icon: LayoutDashboard });
    items.push({ to: `${base}/autorizaciones`, label: n.permits, icon: FileBadge });
  }
  items.push({ to: `${base}/residuos`, label: n.waste, icon: Recycle });
  items.push({ to: `${base}/vertidos`, label: n.discharge, icon: Droplets });
  items.push({ to: `${base}/consumos`, label: n.consumption, icon: Gauge });
  items.push({ to: `${base}/frio`, label: n.cooling, icon: Snowflake });
  items.push(...spaceItems(slug, context.spaces.ENVIRONMENT, texts.shell.areas.areaSpaces));
  return items;
}

/** The Quality area (docs/spec/calidad.md): only while the module is on, never for guests. */
function qualityItems(slug: string, person: Membership, context: AreaContext): AreaItem[] {
  if (!person.workspace.quality.enabled || person.role.base === "GUEST") return [];
  const caps = person.capabilities;
  const view = caps.includes("quality.manage") || caps.includes("quality.view");
  const base = `/app/${slug}/calidad`;
  const q = texts.quality.nav;
  const items: AreaItem[] = [];
  if (view) {
    items.push({ to: `${base}/resumen`, label: q.summary, icon: LayoutDashboard });
    items.push({ to: `${base}/no-conformidades`, label: q.ncs, icon: ClipboardX });
    items.push({ to: `${base}/acciones`, label: q.actions, icon: ListChecks });
    items.push({ to: `${base}/appcc`, label: q.haccp, icon: ShieldAlert });
    items.push({ to: `${base}/retenido`, label: q.holds, icon: PackageX });
    items.push({ to: `${base}/auditorias`, label: q.audits, icon: CalendarSearch });
    items.push({ to: `${base}/proveedores`, label: q.suppliers, icon: Truck });
    items.push({ to: `${base}/reclamaciones`, label: q.complaints, icon: MessageSquareWarning });
    items.push({ to: `${base}/crisis`, label: q.crisis, icon: Siren });
    items.push({ to: `${base}/prerrequisitos`, label: q.prps, icon: SprayCan });
    items.push({ to: `${base}/plan-analitico`, label: q.sampling, icon: FlaskConical });
    items.push({ to: `${base}/productos`, label: q.products, icon: Package });
    items.push({ to: `${base}/trazabilidad`, label: q.traceability, icon: Route });
    items.push({ to: `${base}/cultura`, label: q.culture, icon: HeartHandshake });
    items.push({ to: `${base}/cambios`, label: q.changes, icon: GitPullRequestArrow });
  }
  items.push({
    to: `${base}/mis-acciones`,
    label: q.myActions,
    icon: ClipboardCheck,
    group: q.mine,
  });
  items.push({
    to: `${base}/comunicadas`,
    label: q.reported,
    icon: FileSearch,
    group: q.mine,
  });
  items.push({ to: `${base}/comunicar`, label: q.report, icon: Megaphone, group: q.mine });
  // Anyone records a complaint (the list shows them the ones they recorded or are in charge of).
  if (!view) {
    items.push({
      to: `${base}/reclamaciones`,
      label: q.recordComplaint,
      icon: MessageSquareWarning,
      group: q.mine,
    });
    // The prerequisite controls in their charge (the list only shows those).
    items.push({ to: `${base}/prerrequisitos`, label: q.myPrps, icon: SprayCan, group: q.mine });
    items.push({
      to: `${base}/plan-analitico`,
      label: q.mySamples,
      icon: FlaskConical,
      group: q.mine,
    });
    // Anyone proposes a change (the list shows them the ones they proposed or are in charge of).
    items.push({
      to: `${base}/cambios`,
      label: q.proposeChange,
      icon: GitPullRequestArrow,
      group: q.mine,
    });
  }
  items.push(...spaceItems(slug, context.spaces.QUALITY, texts.shell.areas.areaSpaces));
  return items;
}

/** The person's areas, in the rail's order (Administración last), each with its menu. */
export function areasOf(
  slug: string,
  person: Membership,
  plugins: readonly FrontendPlugin[],
  context: AreaContext,
): Area[] {
  const a = texts.shell.areas;
  const guest = person.role.base === "GUEST";
  const areas: Area[] = [];

  const home: AreaItem[] = [
    { to: `/app/${slug}`, label: a.panel, icon: Home, end: true },
    { to: `/app/${slug}/pendientes`, label: a.pending, icon: ListTodo },
  ];
  for (const plugin of plugins) {
    for (const item of plugin.navItems ?? []) {
      if (!allowed(person, item.anyCapability)) continue;
      home.push({ to: pluginPath(slug, plugin.id, item.to), label: item.label, icon: item.icon });
    }
  }
  areas.push({ id: "HOME", label: a.names.HOME, short: a.short.HOME, icon: Home, items: home });

  const documents: AreaItem[] = [
    { to: `/app/${slug}/mis-documentos`, label: a.readings, icon: BookOpen },
  ];
  if (person.capabilities.includes("documents.approve") || person.leadsDepartments) {
    documents.push({
      to: `/app/${slug}/aprobaciones`,
      label: texts.documents.nav,
      icon: ClipboardCheck,
    });
  }
  if (!guest) {
    documents.push({
      to: `/app/${slug}/vencimientos`,
      label: texts.expiries.nav,
      icon: CalendarClock,
    });
  }
  if (canSee(person, "documents")) {
    documents.push({ to: `/app/${slug}/admin/documents`, label: a.controlled, icon: FileCheck2 });
  }
  if (canSee(person, "auditRooms")) {
    documents.push({
      to: `/app/${slug}/admin/audit-rooms`,
      label: texts.auditRooms.nav,
      icon: FileSearch,
    });
  }
  documents.push(...spaceItems(slug, context.spaces.DOCUMENTS, a.spaces));
  areas.push({
    id: "DOCUMENTS",
    label: a.names.DOCUMENTS,
    short: a.short.DOCUMENTS,
    icon: BookMarked,
    items: documents,
  });

  const wiki: AreaItem[] = [
    { to: `/app/${slug}/files`, label: a.spaces, icon: FolderOpen, end: true },
    { to: `/app/${slug}/files/shared`, label: texts.files.shared.title, icon: Share2 },
  ];
  if (canSee(person, "departments") && !managesDepartments(person)) {
    wiki.push({
      to: `/app/${slug}/admin/departments`,
      label: texts.admin.nav.departments,
      icon: Network,
    });
  }
  areas.push({ id: "WIKI", label: a.names.WIKI, short: a.short.WIKI, icon: Library, items: wiki });

  const prevention = preventionItems(slug, person, context);
  if (prevention.length > 0) {
    const name = texts.safety.terms[person.workspace.safety.terms].module;
    areas.push({
      id: "PREVENTION",
      label: name,
      short: a.shortPrevention[person.workspace.safety.terms],
      icon: ShieldCheck,
      items: prevention,
    });
  }
  const quality = qualityItems(slug, person, context);
  if (quality.length > 0) {
    areas.push({
      id: "QUALITY",
      label: texts.quality.module,
      short: texts.quality.short,
      icon: BadgeCheck,
      items: quality,
    });
  }

  const maintenance = maintenanceItems(slug, person, context);
  if (maintenance.length > 0) {
    areas.push({
      id: "MAINTENANCE",
      label: texts.maintenance.module,
      short: texts.maintenance.short,
      icon: Wrench,
      items: maintenance,
    });
  }

  const environment = environmentItems(slug, person, context);
  if (environment.length > 0) {
    areas.push({
      id: "ENVIRONMENT",
      label: texts.environment.module,
      short: texts.environment.short,
      icon: Leaf,
      items: environment,
    });
  }

  // The whistleblowing channel (docs/spec/canal-denuncias.md): only its managers see the area, even
  // while it's off (open cases go on).
  if (person.workspace.whistleblowing.manager) {
    const c = texts.whistleblowing;
    areas.push({
      id: "CHANNEL",
      label: c.module,
      short: c.short,
      icon: Megaphone,
      items: [{ to: `/app/${slug}/canal`, label: c.cases.title, icon: Inbox }],
    });
  }

  const moved = movedOutOfAdmin(slug);
  const admin = adminNavItems(slug, person, plugins).filter(
    (item) =>
      !moved.has(item.to) &&
      // Read-only departments live in the Wiki.
      !(item.to.endsWith("/admin/departments") && !managesDepartments(person)),
  );
  if (admin.length > 0) {
    areas.push({
      id: "ADMIN",
      label: a.names.ADMIN,
      short: a.short.ADMIN,
      icon: Settings,
      items: admin.map((item) => {
        // In Administración only the plugins are grouped; the rest go first, without a label.
        const entry: AreaItem = { to: item.to, label: item.label, icon: item.icon };
        return item.plugins === true ? { ...entry, group: texts.shell.adminPlugins } : entry;
      }),
    });
  }
  return areas;
}

/** Whether `pathname` is inside `to` (the same path, or below it). */
function inside(pathname: string, to: string, end: boolean | undefined): boolean {
  if (pathname === to) return true;
  return end !== true && pathname.startsWith(`${to}/`);
}

/** The menu entry the address belongs to: the deepest one that contains it. */
export function activeItemOf(pathname: string, items: readonly AreaItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (!inside(pathname, item.to, item.end)) continue;
    if (best === null || item.to.length > best.length) best = item.to;
  }
  return best;
}

/** The area of an address: the one with the deepest entry that contains it, else by route. */
export function activeAreaOf(pathname: string, slug: string, areas: readonly Area[]): AreaId {
  const base = `/app/${slug}`;
  // A space's screens (its folders, pages, forms) belong to the area of the space.
  const space = /^\/app\/[^/]+\/files\/([^/]+)/u.exec(pathname)?.[1];
  if (space !== undefined && space !== "shared") {
    const owner = areas.find((area) => area.items.some((item) => item.space?.id === space));
    return owner?.id ?? "WIKI";
  }
  let best: { area: AreaId; length: number } | null = null;
  for (const area of areas) {
    const match = activeItemOf(pathname, area.items);
    // The dashboard (/app/:slug, exact) only counts for itself.
    if (match !== null && (best === null || match.length > best.length)) {
      best = { area: area.id, length: match.length };
    }
  }
  if (best !== null) return best.area;
  if (pathname.startsWith(`${base}/seguridad`)) return "PREVENTION";
  if (pathname.startsWith(`${base}/files`)) return "WIKI";
  if (pathname.startsWith(`${base}/admin`) && areas.some((area) => area.id === "ADMIN")) {
    return "ADMIN";
  }
  return "HOME";
}

/**
 * Where the app opens for the person (docs/spec/diseno.md 10.4.1): their choice, else their
 * department's, else Inicio; an area they don't have falls back to Inicio.
 */
export function homeAreaOf(person: Membership, areas: readonly Area[]): Area | undefined {
  const wanted = person.homeArea ?? person.departmentHomeArea ?? "HOME";
  return areas.find((area) => area.id === wanted) ?? areas.find((area) => area.id === "HOME");
}

/** Where an area opens: its first entry. */
export function landingOf(area: Area): string | undefined {
  return area.items[0]?.to;
}

/** The areas a person or a department can open in (Quality, once its module exists). */
export function homeAreaChoices(person: Membership): { id: AreaId; label: string }[] {
  const names = texts.shell.areas.names;
  const ids: Exclude<AreaId, "CHANNEL" | "ENVIRONMENT" | "MAINTENANCE">[] = [
    "HOME",
    "DOCUMENTS",
    "WIKI",
  ];
  if (person.workspace.safety.enabled) ids.push("PREVENTION");
  ids.push("ADMIN");
  return ids.map((id) => ({
    id,
    label:
      id === "PREVENTION" ? texts.safety.terms[person.workspace.safety.terms].module : names[id],
  }));
}
