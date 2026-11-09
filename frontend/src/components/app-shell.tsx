// The app's frame (docs/spec/diseno.md 10.4 and 10.4.1, navigation by areas): a 64 px rail of areas,
// the active area's menu (260 px, collapsible to 72 px icons), a thin top bar with what's transversal
// (search, Mis pendientes, Bian, notifications) and the content on bg-surface. Below 1024 px the
// area's menu is a Sheet opened from the title; below 768 px the areas move to a bottom bar.
import { expiriesApi, expiriesKeys } from "@/features/expiries/expiries-api";
import { committeeApi, committeeKeys, peopleApi } from "@/features/safety/safety-api";
import { caeApi, caeKeys } from "@/features/safety/cae-api";
import { formsApi, formsKeys } from "@/features/forms/forms-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  CircleHelp,
  FilePlus,
  Layers,
  ListTodo,
  LogOut,
  Megaphone,
  Menu,
  MoreHorizontal,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Upload,
  UserRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link, NavLink, useLocation, useMatch, useNavigate } from "react-router";
import { toast } from "sonner";
import type { Account, Membership } from "@/auth/types";
import { Avatar, Eyebrow } from "@/components/ui/display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTrigger,
  Tooltip,
  closeAllTooltips,
} from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { canSee } from "@/components/nav-items";
import {
  activeAreaOf,
  activeItemOf,
  areasOf,
  homeAreaOf,
  landingOf,
  type Area,
} from "@/components/nav-areas";
import type { Icon } from "@spiderfolio/plugin-sdk/frontend";
import { useActivePlugins } from "@/plugins/registry";
import { documentsApi, documentsKeys, type RecentItem } from "@/features/documents/documents-api";
import { openFile, pathOf, useReadingCount } from "@/features/documents/my-documents-page";
import { NodeIcon } from "@/features/files/file-utils";
import { SpaceMark } from "@/features/files/space-mark";
import { adminErrorText } from "@/features/admin/admin-utils";
import { docsUrl } from "@/lib/web-url";
import { useApprovalCount } from "@/features/documents/approvals-page";
import { useSharedToast } from "@/features/notifications/shared-toast";
import { NotificationBell } from "@/features/notifications/notification-bell";
import type { BianRequest } from "@/features/bian/bian-api";
import { BianContext } from "@/features/bian/bian-context";
import { BianAvatar } from "@/features/bian/bian-brand";
import { BianPanel } from "@/features/bian/bian-panel";
import { CommandPalette } from "@/features/search/command-palette";
import { filesApi, filesKeys, type Page, type SpaceView } from "@/features/files/api";
import {
  readSidebarCollapsed,
  readSidebarSection,
  saveSidebarCollapsed,
  saveSidebarSection,
  type SidebarSection,
} from "@/lib/sidebar";
import { isDarkTheme, setThemePreference } from "@/lib/theme";
import { cn, formatToday, setAppTimeZone } from "@/lib/utils";
import { channelApi, channelKeys } from "@/features/whistleblowing/whistleblowing-api";
import { texts } from "@/i18n";
import { RestartBanner } from "./restart-banner";
import { MENU_COLLAPSED_WIDTH, MENU_WIDTH, RAIL_WIDTH } from "./shell-sizes";

/** Transiciones con los tokens de movimiento (se anulan con prefers-reduced-motion). */
const ease =
  "duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-emphasized)] motion-reduce:transition-none";
/** Textos: al contraer se desvanecen antes de que el ancho se achique; al expandir, después. */
const fade = (collapsed: boolean) =>
  cn(
    "whitespace-nowrap transition-opacity motion-reduce:transition-none",
    collapsed
      ? "opacity-0 duration-100"
      : "opacity-100 delay-[var(--motion-duration-fast)] duration-[var(--motion-duration-fast)]",
  );
/** Ancho de cada fila: cuadrado de 36 px contraído (centrado), todo el ancho expandido. */
const row = (collapsed: boolean) =>
  cn("transition-[width,background-color,color]", ease, collapsed ? "mx-auto w-9" : "w-full");

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** Flecha en el borde del panel (visible en ambos modos): contrae o expande el menú. */
function EdgeHandle({
  collapsed,
  label,
  onClick,
}: {
  collapsed: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = collapsed ? ChevronsRight : ChevronsLeft;
  return (
    <Tooltip side="right" content={`${label} (Ctrl+B)`}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-keyshortcuts="Control+B"
        className="absolute -right-3 top-5 z-20 grid size-6 place-items-center rounded-full border border-border bg-background text-muted-foreground shadow-card outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/** Aviso de un ítem: un contador (lecturas, aprobaciones) o un punto (compartidos nuevos). */
type Indicator =
  | {
      kind: "count";
      count: number;
      tone: "primary" | "warning" | "danger";
      label: string;
      /** Shown when hovering the count (expiries: «1 vencido · 2 por vencer»). */
      detail?: string;
    }
  | { kind: "dot"; tone: "primary" | "warning"; label: string };

const toneClass = {
  primary: "bg-primary text-primary-foreground",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-danger text-danger-foreground",
} as const;
const dotClass = { primary: "bg-primary", warning: "bg-warning", danger: "bg-danger" } as const;

/**
 * Ítem del menú, fila de 36 px. Expandido: ícono de 18 px y texto en la misma línea, con fondo en toda
 * la fila. Contraído: botón cuadrado de 36×36 con el ícono centrado (el texto sale en un tooltip) y
 * el aviso como un punto. La clase es un texto (no una función) porque el tooltip la fusiona con la suya.
 */
function NavItem({
  to,
  label,
  icon: Icon,
  mark,
  end = false,
  collapsed,
  indicator,
  compact = false,
  active: forcedActive,
}: {
  to: string;
  label: string;
  icon?: Icon;
  /** Marca propia en lugar del ícono (ej. el emoji y el color de un espacio). */
  mark?: ReactNode;
  end?: boolean;
  collapsed: boolean;
  indicator?: Indicator;
  /** Fila secundaria (Favoritos y Recientes): 30 px, texto de 13 px en color secundario, con sangría. */
  compact?: boolean;
  /** Marca la fila como actual aunque la ruta no coincida exacta (ej. Administración). */
  active?: boolean;
}) {
  // «Archivos» no se marca cuando se está en «Compartidos» (cuelga de la misma ruta).
  const onShared = useMatch({ path: "/app/:slug/files/shared" }) !== null;
  const matches = useMatch({ path: to, end }) !== null && !(onShared && to.endsWith("/files"));
  const active = forcedActive ?? matches;
  // Contraído, todas las filas son iguales (solo íconos).
  const small = compact && !collapsed;
  return (
    <Tooltip
      side="right"
      content={
        indicator === undefined
          ? label
          : `${label} · ${indicator.kind === "count" && indicator.detail !== undefined ? indicator.detail : indicator.label}`
      }
      disabled={!collapsed}
    >
      <NavLink
        to={to}
        viewTransition
        end={end}
        className={cn(
          "flex h-9 items-center overflow-hidden rounded-lg text-sm text-foreground/90 outline-none transition-[width,padding,background-color,color] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&_svg]:text-muted-foreground",
          ease,
          collapsed ? "mx-auto w-9" : "w-full",
          small &&
            "ml-2 h-[30px] w-[calc(100%-0.5rem)] text-[13px] text-muted-foreground hover:text-foreground",
          active &&
            "bg-primary-soft font-medium text-primary-soft-foreground ring-1 ring-inset ring-primary/15 hover:bg-primary-soft [&_svg]:text-primary-soft-foreground",
        )}
      >
        <span
          className={cn(
            "relative grid shrink-0 place-items-center",
            small ? "h-[30px] w-7" : "size-9",
          )}
        >
          {mark ??
            (Icon !== undefined && (
              <Icon
                className={small ? "size-4" : "size-[18px]"}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            ))}
          {indicator !== undefined && collapsed && (
            <span
              aria-hidden="true"
              className={cn("absolute right-1 top-1 size-2 rounded-full", dotClass[indicator.tone])}
            />
          )}
        </span>
        <span className={cn("flex-1 truncate pr-2", fade(collapsed))}>{label}</span>
        {indicator !== undefined &&
          (indicator.kind === "count" ? (
            <Tooltip content={indicator.detail ?? indicator.label} disabled={collapsed}>
              <span
                aria-label={indicator.label}
                className={cn(
                  "mr-2 rounded-full px-1.5 text-[11px] font-semibold leading-5",
                  toneClass[indicator.tone],
                  collapsed && "hidden",
                  fade(collapsed),
                )}
              >
                {indicator.count > 99 ? "99+" : indicator.count}
              </span>
            </Tooltip>
          ) : (
            <span
              role="img"
              aria-label={indicator.label}
              className={cn(
                "mr-3 size-2 shrink-0 rounded-full",
                dotClass[indicator.tone],
                collapsed && "hidden",
              )}
            />
          ))}
      </NavLink>
    </Tooltip>
  );
}

/** Título discreto de una sección; contraído, una línea fina. */
function SectionLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  return (
    <div className="relative h-7 pt-2" aria-hidden="true">
      <Eyebrow className={cn("absolute bottom-1 left-2.5 text-[10px]", fade(collapsed))}>
        {children}
      </Eyebrow>
      <span
        className={cn(
          "absolute inset-x-0 bottom-2 mx-auto h-px w-5 bg-border transition-opacity motion-reduce:transition-none",
          collapsed ? "opacity-100 delay-[var(--motion-duration-fast)]" : "opacity-0 duration-100",
        )}
      />
    </div>
  );
}

/** El logo de la empresa (la inicial sobre su color de acento hasta que se pueda subir uno). */
function WorkspaceMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-[13px] font-semibold uppercase text-primary-foreground"
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}

/** Arriba del menú: la empresa (logo y nombre) con su menú. */
function WorkspaceHeader({
  account,
  membership,
  collapsed,
  canAdminister,
}: {
  account: Account;
  membership: Membership;
  collapsed: boolean;
  canAdminister: boolean;
}) {
  const t = texts.shell.company;
  const { workspace } = membership;
  const others = account.memberships.filter((m) => m.workspace.slug !== workspace.slug);
  return (
    <div className="shrink-0 px-3 pb-1 pt-3">
      <DropdownMenu>
        <Tooltip side="right" content={workspace.name} disabled={!collapsed}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${t.label}: ${workspace.name}`}
              className={cn(
                "flex h-11 items-center overflow-hidden rounded-lg text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                row(collapsed),
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center">
                <WorkspaceMark name={workspace.name} />
              </span>
              <span className={cn("min-w-0 flex-1", fade(collapsed))}>
                <span className="block truncate text-sm font-semibold leading-4">
                  {workspace.name}
                </span>
              </span>
              <ChevronsUpDown
                className={cn("mr-2 size-4 shrink-0 text-muted-foreground", fade(collapsed))}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent side={collapsed ? "right" : "bottom"} align="start" className="w-64">
          <DropdownMenuLabel>{workspace.name}</DropdownMenuLabel>
          {canAdminister && (
            <DropdownMenuItem asChild>
              <Link to={`/app/${workspace.slug}/admin`}>
                <Settings strokeWidth={1.75} aria-hidden="true" />
                {t.settings}
              </Link>
            </DropdownMenuItem>
          )}
          {others.length > 0 && (
            <>
              <DropdownMenuLabel>{t.switch}</DropdownMenuLabel>
              {others.map((other) => (
                <DropdownMenuItem key={other.id} asChild>
                  <Link to={`/app/${other.workspace.slug}`}>
                    <WorkspaceMark name={other.workspace.name} />
                    <span className="truncate">{other.workspace.name}</span>
                  </Link>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Fila de acciones: «Buscar» con su atajo y «+» con el menú de crear (según permisos). */
function ActionsRow({
  membership,
  collapsed,
  onSearch,
  onNewPage,
}: {
  membership: Membership;
  collapsed: boolean;
  onSearch: () => void;
  /** Abre la paleta para elegir el espacio de la nueva página (fuera de un espacio). */
  onNewPage: () => void;
}) {
  const t = texts.shell.create;
  const navigate = useNavigate();
  const slug = membership.workspace.slug;
  const inSpace = useMatch({ path: "/app/:slug/files/:spaceId/*" });
  const spaceId = inSpace?.params.spaceId;
  const canWrite = membership.seatType === "FULL" && membership.role.base !== "GUEST";
  const canCreateSpace = membership.capabilities.includes("spaces.create");
  const base = `/app/${slug}/files`;
  const here = spaceId === undefined || spaceId === "shared" ? null : `${base}/${spaceId}`;
  return (
    <div className={cn("flex shrink-0 gap-1 px-3 pb-1", collapsed ? "flex-col" : "flex-row")}>
      <Tooltip side="right" content={`${texts.shell.search} (Ctrl+K)`} disabled={!collapsed}>
        <button
          type="button"
          onClick={onSearch}
          aria-label={texts.search.buttonHint}
          aria-keyshortcuts="Control+K"
          className={cn(
            "flex h-9 min-w-0 items-center overflow-hidden rounded-lg border border-border bg-background text-xs text-muted-foreground outline-none transition-[width,background-color,color] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            ease,
            collapsed ? "mx-auto w-9" : "flex-1",
          )}
        >
          <span className="grid size-9 shrink-0 place-items-center">
            <Search className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className={cn("flex-1 truncate text-left", fade(collapsed))}>
            {texts.shell.search}
          </span>
          <kbd
            className={cn(
              "mr-2 rounded border border-border px-1.5 text-[10px] leading-4",
              collapsed && "hidden",
              fade(collapsed),
            )}
          >
            Ctrl K
          </kbd>
        </button>
      </Tooltip>
      {(canWrite || canCreateSpace) && (
        <DropdownMenu>
          <Tooltip side="right" content={t.label} disabled={!collapsed}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t.label}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  collapsed && "mx-auto",
                )}
              >
                <Plus className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent side={collapsed ? "right" : "bottom"} align="start" className="w-56">
            {canWrite && (
              <DropdownMenuItem
                onSelect={() => {
                  if (here === null) onNewPage();
                  else void navigate(`${here}?nueva=pagina`);
                }}
              >
                <FilePlus strokeWidth={1.75} aria-hidden="true" />
                {t.page}
              </DropdownMenuItem>
            )}
            {canWrite && (
              <DropdownMenuItem
                onSelect={() => {
                  if (here === null) {
                    toast.info(t.pickSpaceToUpload);
                    void navigate(base);
                  } else void navigate(`${here}?subir=1`);
                }}
              >
                <Upload strokeWidth={1.75} aria-hidden="true" />
                {t.upload}
              </DropdownMenuItem>
            )}
            {canCreateSpace && (
              <DropdownMenuItem
                onSelect={() => {
                  void navigate(`${base}?crear=espacio`);
                }}
              >
                <Layers strokeWidth={1.75} aria-hidden="true" />
                {t.space}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * Sección plegable (Favoritos, Recientes) con el estado recordado. Con el menú contraído no hay
 * título: solo los ítems bajo una línea fina.
 */
function CollapsibleSection({
  id,
  label,
  collapsed,
  viewAll,
  children,
}: {
  id: SidebarSection;
  label: string;
  collapsed: boolean;
  /** Enlace pequeño a la derecha del título («Ver todos (N)»). */
  viewAll?: { to: string; label: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readSidebarSection(id));
  const toggle = () => {
    setOpen((current) => {
      saveSidebarSection(id, !current);
      return !current;
    });
  };
  if (collapsed) {
    return (
      <>
        <SectionLabel collapsed>{label}</SectionLabel>
        {children}
      </>
    );
  }
  return (
    <div>
      <div className="flex h-7 items-center justify-between gap-2 px-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1 rounded text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
              !open && "-rotate-90",
            )}
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="truncate">{label}</span>
        </button>
        {viewAll !== undefined && open && (
          <Link
            to={viewAll.to}
            className="shrink-0 rounded text-[11px] text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {viewAll.label}
          </Link>
        )}
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className={cn("min-h-0 space-y-0.5 overflow-hidden", !open && "invisible")}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Cuántos favoritos muestra el menú; el resto, en «Ver todos» (Archivos con el filtro Favoritos). */
const FAVORITES_SHOWN = 7;

/**
 * Favoritos del menú, reordenables arrastrando (o con Alt + flechas): el orden se guarda por persona.
 * Contraído no se reordena (solo íconos).
 */
function FavoriteRows({
  slug,
  spaces,
  collapsed,
}: {
  slug: string;
  spaces: readonly SpaceView[];
  collapsed: boolean;
}) {
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState<string | null>(null);
  const navKey = [...filesKeys.favoriteSpaces(slug), "nav"];
  const save = useMutation({
    mutationFn: (ids: string[]) => filesApi.reorderFavorites(slug, ids),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: filesKeys.favoriteSpaces(slug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const move = (id: string, to: number) => {
    const from = spaces.findIndex((space) => space.id === id);
    if (from < 0 || to < 0 || to >= spaces.length || from === to) return;
    const next = [...spaces];
    const [item] = next.splice(from, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    // Se ve al instante; el servidor confirma (y se refresca al terminar).
    queryClient.setQueryData<Page<SpaceView>>(navKey, (old) =>
      old === undefined ? old : { ...old, items: next },
    );
    save.mutate(next.map((space) => space.id));
  };
  return (
    <>
      {spaces.map((space, index) => (
        <div
          key={space.id}
          draggable={!collapsed}
          title={collapsed ? undefined : space.name}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", space.id);
            setDragging(space.id);
          }}
          onDragOver={(event) => {
            if (dragging === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging !== null) move(dragging, index);
            setDragging(null);
          }}
          onDragEnd={() => {
            setDragging(null);
          }}
          onKeyDown={(event) => {
            if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
            event.preventDefault();
            move(space.id, index + (event.key === "ArrowUp" ? -1 : 1));
          }}
          className={cn(dragging === space.id && "opacity-50")}
        >
          <NavItem
            to={`/app/${slug}/files/${space.id}`}
            label={space.name}
            mark={<SpaceMark space={space} size={collapsed ? "sm" : "xs"} />}
            collapsed={collapsed}
            compact
          />
        </div>
      ))}
    </>
  );
}

/** Un documento reciente: páginas y carpetas por su ruta; un archivo se abre en su vista previa. */
function RecentRow({ slug, item }: { slug: string; item: RecentItem }) {
  const to = pathOf(slug, item.node);
  const body = (
    <>
      <span className="grid h-[30px] w-7 shrink-0 place-items-center">
        <NodeIcon node={item.node} className="size-4" />
      </span>
      <span className="flex-1 truncate pr-2 text-left">
        {item.code !== null && (
          <span className="mr-1.5 font-mono text-[11px] text-muted-foreground/70">{item.code}</span>
        )}
        {item.node.name}
      </span>
    </>
  );
  const className =
    "ml-2 flex h-[30px] w-[calc(100%-0.5rem)] items-center overflow-hidden rounded-lg text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
  return to === null ? (
    <button
      type="button"
      className={className}
      onClick={() => {
        void openFile(slug, item.node).catch((error: unknown) => {
          toast.error(adminErrorText(error));
        });
      }}
    >
      {body}
    </button>
  ) : (
    <NavLink to={to} viewTransition className={className}>
      {body}
    </NavLink>
  );
}

/** «Ayuda y guías»: las guías viven en la web pública (otro origen), en una pestaña nueva. */
function HelpLink({ collapsed }: { collapsed: boolean }) {
  return (
    <Tooltip side="right" content={texts.shell.help} disabled={!collapsed}>
      <a
        href={docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex h-9 items-center overflow-hidden rounded-lg text-sm text-foreground/90 outline-none transition-[width,background-color,color] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&_svg]:text-muted-foreground",
          ease,
          collapsed ? "mx-auto w-9" : "w-full",
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center">
          <CircleHelp className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className={cn("flex-1 truncate pr-2", fade(collapsed))}>{texts.shell.help}</span>
      </a>
    </Tooltip>
  );
}

/** What the rail and the menus need: the person's areas, the active one and the counts. */
function useAreaNav(membership: Membership) {
  const { pathname } = useLocation();
  const slug = membership.workspace.slug;
  const plugins = useActivePlugins(slug);
  const role = membership.role.base;
  const caps = membership.capabilities;
  const safety = membership.workspace.safety;
  const safetyOn = safety.enabled && role !== "GUEST";
  const managesSafety = caps.includes("safety.manage");
  // The committee's members see its tab without managing the module (docs/spec/seguridad-salud.md).
  const committee = useQuery({
    queryKey: committeeKeys.access(slug),
    queryFn: () => committeeApi.access(slug),
    enabled: safetyOn && !managesSafety,
    staleTime: 60_000,
  });
  // The spaces listed outside the Wiki: a few per area, in its menu.
  // One request for both areas (a few spaces each; the rest are in Archivos).
  const areaSpaces = useQuery({
    queryKey: [...filesKeys.spaces(slug), "areas"],
    queryFn: () =>
      filesApi.spaces(slug, {
        area: ["DOCUMENTS", "PREVENTION", "QUALITY", "ENVIRONMENT"],
        pageSize: AREA_SPACES_SHOWN,
      }),
    select: (page) => page.items,
    staleTime: 60_000,
  });
  const documentSpaces = useMemo(
    () => areaSpaces.data?.filter((space) => space.area === "DOCUMENTS"),
    [areaSpaces.data],
  );
  const preventionSpaces = useMemo(
    () => (safetyOn ? areaSpaces.data?.filter((space) => space.area === "PREVENTION") : []),
    [areaSpaces.data, safetyOn],
  );
  const qualityOn = membership.workspace.quality.enabled && role !== "GUEST";
  const qualitySpaces = useMemo(
    () => (qualityOn ? areaSpaces.data?.filter((space) => space.area === "QUALITY") : []),
    [areaSpaces.data, qualityOn],
  );
  const environmentOn = membership.workspace.environment.enabled && role !== "GUEST";
  const environmentSpaces = useMemo(
    () => (environmentOn ? areaSpaces.data?.filter((space) => space.area === "ENVIRONMENT") : []),
    [areaSpaces.data, environmentOn],
  );
  const areas = useMemo(
    () =>
      areasOf(slug, membership, plugins, {
        committee: managesSafety || committee.data?.member === true,
        spaces: {
          ...(documentSpaces === undefined ? {} : { DOCUMENTS: documentSpaces }),
          ...(preventionSpaces === undefined ? {} : { PREVENTION: preventionSpaces }),
          ...(qualitySpaces === undefined ? {} : { QUALITY: qualitySpaces }),
          ...(environmentSpaces === undefined ? {} : { ENVIRONMENT: environmentSpaces }),
        },
      }),
    [
      slug,
      membership,
      plugins,
      managesSafety,
      committee.data,
      documentSpaces,
      preventionSpaces,
      qualitySpaces,
      environmentSpaces,
    ],
  );
  const active = activeAreaOf(pathname, slug, areas);

  // Counts: shown next to their entries, as a dot on their area and summed in «Mis pendientes».
  const sharedSummary = useQuery({
    queryKey: [...filesKeys.all(slug), "shared", "summary"],
    queryFn: () => filesApi.sharedSummary(slug),
    staleTime: 20_000,
  });
  const readingCount = useReadingCount(slug);
  const approvalCount = useApprovalCount(
    slug,
    caps.includes("documents.approve") || membership.leadsDepartments,
  );
  const safetyCount = useQuery({
    queryKey: ["w", slug, "safety", "my-count"],
    queryFn: () => peopleApi.myCount(slug),
    select: (data) => data.count ?? 0,
    staleTime: 60_000,
    enabled: safetyOn,
  });
  const expiryCount = useQuery({
    queryKey: expiriesKeys.myCount(slug),
    queryFn: () => expiriesApi.myCount(slug),
    staleTime: 60_000,
    enabled: role !== "GUEST",
  });
  const formsPending = useQuery({
    queryKey: formsKeys.pending(slug),
    queryFn: () => formsApi.pending(slug),
    select: (data) => data.items.length,
    staleTime: 60_000,
  });
  const caeReview = caps.includes("cae.manage") && safety.cae;
  const caePending = useQuery({
    queryKey: caeKeys.documents(slug, { status: "pending" }),
    queryFn: () => caeApi.documents(slug, { status: "pending" }, undefined, undefined, 1),
    select: (page) => page.total,
    enabled: caeReview,
  });
  // The whistleblowing channel: how many cases are new or have a new message (its managers only).
  const channelUnread = useQuery({
    queryKey: channelKeys.counts(slug),
    queryFn: () => channelApi.counts(slug),
    select: (data) => data.unread,
    staleTime: 60_000,
    enabled: membership.workspace.whistleblowing.manager,
  });
  const unseenShared = sharedSummary.data?.unseen ?? 0;
  const base = `/app/${slug}`;
  const indicatorOf = (to: string): Indicator | undefined => {
    if (to === `${base}/mis-documentos` && readingCount > 0) {
      return {
        kind: "count",
        count: readingCount,
        tone: "primary",
        label: texts.shell.pendingReadings(readingCount),
      };
    }
    if (to === `${base}/aprobaciones` && approvalCount > 0) {
      return {
        kind: "count",
        count: approvalCount,
        tone: "warning",
        label: texts.shell.pendingApprovals(approvalCount),
      };
    }
    // For whoever manages the module, the Summary's total; for the rest, their own.
    const safetyTo = managesSafety
      ? `${base}/seguridad/resumen`
      : `${base}/seguridad/personas/${membership.id}`;
    if (to === safetyTo && (safetyCount.data ?? 0) > 0) {
      const count = safetyCount.data ?? 0;
      return {
        kind: "count",
        count,
        tone: "warning",
        label: texts.safety.people.pendingCount(count),
      };
    }
    if (to === `${base}/seguridad/cae` && (caePending.data ?? 0) > 0) {
      const count = caePending.data ?? 0;
      return { kind: "count", count, tone: "primary", label: texts.cae.review.tab(count) };
    }
    if (to === `${base}/vencimientos` && (expiryCount.data?.count ?? 0) > 0) {
      const { count, expired } = expiryCount.data ?? { count: 0, expired: 0 };
      // Red if any has expired; amber if they're only due soon.
      return {
        kind: "count",
        count,
        tone: expired > 0 ? "danger" : "warning",
        label: texts.expiries.pendingCount(count, expired),
        detail: texts.expiries.countDetail(expired, count - expired),
      };
    }
    if (to === `${base}/canal` && (channelUnread.data ?? 0) > 0) {
      const count = channelUnread.data ?? 0;
      return {
        kind: "count",
        count,
        tone: "primary",
        label: texts.whistleblowing.cases.unreadCount(count),
      };
    }
    if (to === `${base}/files/shared` && unseenShared > 0) {
      return { kind: "dot", tone: "primary", label: texts.shell.newShared };
    }
    return undefined;
  };
  // «Mis pendientes»: what the person has to do themselves (a manager's Summary isn't theirs).
  const pending =
    readingCount +
    approvalCount +
    (formsPending.data ?? 0) +
    (expiryCount.data?.count ?? 0) +
    (managesSafety || caps.includes("safety.health") ? 0 : (safetyCount.data ?? 0));
  const newsIn = (area: Area): boolean =>
    area.items.some((item) => indicatorOf(item.to) !== undefined);
  const work = areas.filter((area) => area.id !== "ADMIN");
  return {
    slug,
    areas,
    work,
    admin: areas.find((area) => area.id === "ADMIN"),
    active: areas.find((area) => area.id === active) ?? areas[0],
    indicatorOf,
    newsIn,
    pending,
    /** With a single work area there's no rail: everything is in the menu. */
    showRail: work.length > 1,
  };
}

type AreaNav = ReturnType<typeof useAreaNav>;

/** How many spaces of the non-Wiki areas the menus list (the rest, in Archivos). */
const AREA_SPACES_SHOWN = 40;

/** An area in the rail: icon and short name, the active one in primary-soft. */
function RailItem({ area, active, news }: { area: Area; active: boolean; news: boolean }) {
  const Icon = area.icon;
  const to = landingOf(area);
  if (to === undefined) return null;
  return (
    <Tooltip side="right" content={area.label}>
      <Link
        to={to}
        viewTransition
        aria-current={active ? "page" : undefined}
        aria-label={area.label}
        className={cn(
          "relative flex w-[52px] flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] leading-tight text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          active &&
            "bg-primary-soft font-medium text-primary-soft-foreground ring-1 ring-inset ring-primary/15 hover:bg-primary-soft hover:text-primary-soft-foreground",
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
        <span className="w-full truncate px-0.5 text-center">{area.short}</span>
        {news && (
          <span
            aria-hidden="true"
            className="absolute right-2 top-1 size-2 rounded-full bg-primary"
          />
        )}
      </Link>
    </Tooltip>
  );
}

/** The rail of areas (desktop and tablet): work areas on top, Administración at the bottom. */
function AreaRail({ nav }: { nav: AreaNav }) {
  return (
    <nav
      aria-label={texts.shell.areas.label}
      style={{ width: RAIL_WIDTH }}
      className="flex h-full flex-col items-center gap-1 border-r border-border bg-surface pb-3 pt-4"
    >
      {nav.work.map((area) => (
        <RailItem
          key={area.id}
          area={area}
          active={nav.active?.id === area.id}
          news={nav.newsIn(area)}
        />
      ))}
      {nav.admin !== undefined && (
        <div className="mt-auto border-t border-border pt-2">
          <RailItem area={nav.admin} active={nav.active?.id === "ADMIN"} news={false} />
        </div>
      )}
    </nav>
  );
}

/** On the phone (< 768 px): up to four areas at the bottom and «Más» with the rest. */
function BottomBar({ nav }: { nav: AreaNav }) {
  const shown = nav.work.slice(0, 4);
  const rest = [...nav.work.slice(4), ...(nav.admin === undefined ? [] : [nav.admin])];
  const item =
    "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] leading-tight text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  return (
    <nav
      aria-label={texts.shell.areas.label}
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      {shown.map((area) => {
        const to = landingOf(area);
        if (to === undefined) return null;
        const Icon = area.icon;
        const active = nav.active?.id === area.id;
        return (
          <Link
            key={area.id}
            to={to}
            viewTransition
            aria-current={active ? "page" : undefined}
            className={cn(item, active && "font-semibold text-primary-soft-foreground")}
          >
            <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
            <span className="max-w-full truncate px-1">{area.short}</span>
            {nav.newsIn(area) && (
              <span
                aria-hidden="true"
                className="absolute right-[calc(50%-18px)] top-2 size-2 rounded-full bg-primary"
              />
            )}
          </Link>
        );
      })}
      {rest.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={texts.shell.areas.moreTitle}
              className={cn(
                item,
                rest.some((area) => area.id === nav.active?.id) &&
                  "font-semibold text-primary-soft-foreground",
              )}
            >
              <MoreHorizontal className="size-5" strokeWidth={1.75} aria-hidden="true" />
              <span>{texts.shell.areas.more}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-56">
            {rest.map((area) => {
              const to = landingOf(area);
              if (to === undefined) return null;
              const Icon = area.icon;
              return (
                <DropdownMenuItem key={area.id} asChild>
                  <Link to={to} aria-current={nav.active?.id === area.id ? "page" : undefined}>
                    <Icon strokeWidth={1.75} aria-hidden="true" />
                    {area.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}

/** One area's entries, grouped by their label, with the current one marked. */
function AreaItems({ nav, area, collapsed }: { nav: AreaNav; area: Area; collapsed: boolean }) {
  const { pathname } = useLocation();
  const current = activeItemOf(pathname, area.items);
  let group: string | undefined;
  return (
    <>
      {area.items.map((item) => {
        const header = item.group !== undefined && item.group !== group;
        group = item.group;
        const indicator = nav.indicatorOf(item.to);
        return (
          <div key={item.to}>
            {header && <SectionLabel collapsed={collapsed}>{item.group}</SectionLabel>}
            <NavItem
              to={item.to}
              label={item.label}
              icon={item.icon}
              collapsed={collapsed}
              active={current === item.to}
              {...(item.space === undefined
                ? {}
                : { mark: <SpaceMark space={item.space} size={collapsed ? "sm" : "xs"} /> })}
              {...(indicator === undefined ? {} : { indicator })}
              {...(item.end === true ? { end: true } : {})}
            />
          </div>
        );
      })}
    </>
  );
}

function SidebarContent({
  account,
  membership,
  nav,
  collapsed,
  onLogout,
  onSearch,
  onNewPage,
  className,
  style,
}: {
  account: Account;
  membership: Membership;
  nav: AreaNav;
  collapsed: boolean;
  onLogout: () => void;
  onSearch: () => void;
  onNewPage: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const slug = membership.workspace.slug;
  const area = nav.active;
  const role = membership.role.base;
  const canAdminister = nav.admin !== undefined;
  const favorites = useQuery({
    queryKey: [...filesKeys.favoriteSpaces(slug), "nav"],
    queryFn: () =>
      filesApi.spaces(slug, { filter: "favorites", sort: "favorite", pageSize: FAVORITES_SHOWN }),
    staleTime: 60_000,
    enabled: area?.id === "WIKI",
  });
  const recents = useQuery({
    queryKey: [...documentsKeys.recent(slug), "nav"],
    queryFn: () => documentsApi.recent(slug, 5),
    select: (page) => page.items,
    staleTime: 60_000,
    enabled: area?.id === "HOME",
  });
  const dark = isDarkTheme();
  const favoriteSpaces = favorites.data?.items ?? [];
  const recentItems = recents.data ?? [];
  return (
    <div className={cn("flex h-full flex-col", className)} style={style}>
      <WorkspaceHeader
        account={account}
        membership={membership}
        collapsed={collapsed}
        canAdminister={canAdminister}
      />
      <ActionsRow
        membership={membership}
        collapsed={collapsed}
        onSearch={onSearch}
        onNewPage={onNewPage}
      />
      <nav
        className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2"
        aria-label={area?.label ?? membership.workspace.name}
      >
        <div className="space-y-0.5">
          {area !== undefined && (
            <>
              <p
                className={cn(
                  "truncate px-2.5 pb-1 text-sm font-semibold tracking-tight",
                  fade(collapsed),
                  collapsed && "sr-only",
                )}
              >
                {area.label}
              </p>
              {area.id === "ADMIN" && !nav.showRail && (
                <NavItem
                  to={`/app/${slug}`}
                  label={texts.shell.adminBack}
                  icon={ArrowLeft}
                  collapsed={collapsed}
                  active={false}
                />
              )}
              <AreaItems nav={nav} area={area} collapsed={collapsed} />
            </>
          )}
          {area?.id === "WIKI" && (favoriteSpaces.length > 0 || !collapsed) && (
            <div className="pt-4">
              <CollapsibleSection
                id="favorites"
                label={texts.shell.favorites}
                collapsed={collapsed}
                {...((favorites.data?.total ?? 0) > FAVORITES_SHOWN
                  ? {
                      viewAll: {
                        to: `/app/${slug}/files?filtro=favoritos`,
                        label: texts.shell.favoritesAll(favorites.data?.total ?? 0),
                      },
                    }
                  : {})}
              >
                {favoriteSpaces.length === 0 && !favorites.isPending && (
                  <p className="ml-2 px-2.5 py-1 text-xs text-muted-foreground">
                    {texts.shell.favoritesEmpty}
                  </p>
                )}
                <FavoriteRows slug={slug} spaces={favoriteSpaces} collapsed={collapsed} />
              </CollapsibleSection>
            </div>
          )}
          {area?.id === "HOME" && recentItems.length > 0 && !collapsed && (
            <div className="pt-4">
              <CollapsibleSection id="recents" label={texts.shell.recents} collapsed={collapsed}>
                {recentItems.map((item) => (
                  <RecentRow key={item.node.id} slug={slug} item={item} />
                ))}
              </CollapsibleSection>
            </div>
          )}
          <div className="my-2 h-px bg-border" role="separator" />
          {/* Without the rail (a single work area), Administración stays in the menu. */}
          {!nav.showRail && canAdminister && area?.id !== "ADMIN" && (
            <NavItem
              to={`/app/${slug}/admin`}
              label={texts.shell.admin}
              icon={Settings}
              collapsed={collapsed}
              active={false}
            />
          )}
          <HelpLink collapsed={collapsed} />
        </div>
      </nav>
      <div className="shrink-0 border-t border-border px-3 py-2">
        <DropdownMenu>
          <Tooltip side="right" content={account.user.name} disabled={!collapsed}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={account.user.name}
                className={cn(
                  "flex h-11 items-center overflow-hidden rounded-lg text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                  row(collapsed),
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center">
                  <Avatar
                    name={account.user.name}
                    src={account.user.avatarUrl}
                    className="size-7"
                  />
                </span>
                <span className={cn("min-w-0 flex-1 pr-2", fade(collapsed))}>
                  <span className="block truncate text-sm font-medium leading-4">
                    {account.user.name}
                  </span>
                  <span className="block truncate text-xs leading-4 text-muted-foreground">
                    {texts.shell.roles[role]}
                  </span>
                </span>
                <ChevronsUpDown
                  className={cn("mr-2 size-4 shrink-0 text-muted-foreground", fade(collapsed))}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent side={collapsed ? "right" : "top"} align="start" className="w-60">
            <DropdownMenuLabel>{account.user.name}</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to={`/app/${slug}/profile`}>
                <UserRound strokeWidth={1.75} aria-hidden="true" />
                {texts.profile.menu}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setThemePreference(dark ? "light" : "dark");
              }}
            >
              {dark ? (
                <Sun strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Moon strokeWidth={1.75} aria-hidden="true" />
              )}
              {dark ? texts.shell.account.themeLight : texts.shell.account.themeDark}
            </DropdownMenuItem>
            {membership.workspace.whistleblowing.enabled && (
              // The public page, in a new tab: reporting never goes through the person's session.
              <DropdownMenuItem asChild>
                <a href={`/canal/${slug}`} target="_blank" rel="noreferrer">
                  <Megaphone strokeWidth={1.75} aria-hidden="true" />
                  {texts.whistleblowing.menuLink}
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onLogout}>
              <LogOut strokeWidth={1.75} aria-hidden="true" />
              {texts.common.logout}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Workspaces whose landing already ran in this page load (the dashboard stays reachable). */
const landed = new Set<string>();

/**
 * Opening /app/:slug (after signing in, or from a bookmark) goes to the person's home area
 * (docs/spec/diseno.md 10.4.1); a deeper address is left alone, and only the first time.
 */
function useHomeAreaLanding(membership: Membership, nav: AreaNav) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const slug = membership.workspace.slug;
  useEffect(() => {
    if (landed.has(slug)) return;
    landed.add(slug);
    if (pathname.replace(/\/$/u, "") !== `/app/${slug}`) return;
    const home = homeAreaOf(membership, nav.areas);
    if (home === undefined || home.id === "HOME") return;
    const to = landingOf(home);
    if (to !== undefined) void navigate(to, { replace: true });
  }, [slug, pathname, membership, nav.areas, navigate]);
}

export function AppShell({
  account,
  membership,
  title,
  actions,
  onLogout,
  children,
}: {
  account: Account;
  membership: Membership;
  title: string;
  actions?: ReactNode;
  onLogout: () => void;
  children: ReactNode;
}) {
  // Before the screens render: their dates and times are in the company's zone.
  setAppTimeZone(membership.workspace.timeZone);
  const nav = useAreaNav(membership);
  useHomeAreaLanding(membership, nav);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const toggle = useCallback(() => {
    // Al iniciar la transición no puede quedar ningún globo abierto (se quedaría pegado).
    closeAllTooltips();
    setCollapsed((current) => {
      saveSidebarCollapsed(!current);
      return !current;
    });
  }, []);
  useEffect(() => {
    closeAllTooltips();
  }, [collapsed]);
  // Ctrl+K (⌘K) abre la búsqueda desde cualquier pantalla, también escribiendo: el navegador lo
  // usaría para su propia barra de búsqueda.
  const [searching, setSearching] = useState(false);
  // Bian, el asistente: panel lateral; la pregunta puede venir de Ctrl+K.
  const [bianOpen, setBianOpen] = useState(false);
  const [bianRequest, setBianRequest] = useState<BianRequest | null>(null);
  const bianActions = useMemo(
    () => ({
      open: (request?: BianRequest) => {
        setBianRequest(request ?? null);
        setBianOpen(true);
      },
    }),
    [],
  );
  // Abierta desde «+ › Nueva página»: la paleta pide primero el espacio.
  const [pickingSpace, setPickingSpace] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey)) return;
      if (event.shiftKey || event.altKey) return;
      event.preventDefault();
      setPickingSpace(false);
      setSearching((current) => !current);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  // Ctrl+B (⌘B en Mac) contrae o expande; en un campo de texto o el editor, Ctrl+B es negrita.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !(event.ctrlKey || event.metaKey)) return;
      if (event.shiftKey || event.altKey || isTyping(event.target)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [toggle]);
  const { pathname } = useLocation();
  // Below 1024 px the area's menu is a Sheet opened from the title; it closes on navigating.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  useSharedToast(membership.workspace.slug);
  const today = formatToday();
  const slug = membership.workspace.slug;
  const openSearch = () => {
    setPickingSpace(false);
    setSearching(true);
  };
  const openNewPage = () => {
    setPickingSpace(true);
    setSearching(true);
  };
  const pendingLabel =
    nav.pending > 0 ? texts.shell.areas.pendingCount(nav.pending) : texts.shell.areas.pending;
  return (
    <div className="flex min-h-dvh w-full min-w-0 max-w-full bg-surface">
      {nav.showRail && (
        <div className="sticky top-0 z-40 hidden h-dvh shrink-0 md:block print:hidden">
          <AreaRail nav={nav} />
        </div>
      )}
      <div
        style={{ width: collapsed ? MENU_COLLAPSED_WIDTH : MENU_WIDTH }}
        className={cn(
          "sticky top-0 z-40 hidden h-dvh shrink-0 transition-[width] will-change-[width] lg:block print:hidden",
          ease,
        )}
      >
        <aside className="h-full overflow-hidden border-r border-border bg-background">
          <SidebarContent
            account={account}
            membership={membership}
            nav={nav}
            collapsed={collapsed}
            onLogout={onLogout}
            onSearch={openSearch}
            onNewPage={openNewPage}
            // El contenido sigue el ancho del panel: con un ancho fijo de 260 px, las filas centradas
            // del modo contraído quedarían fuera de los 72 px visibles (íconos invisibles).
            className={cn("transition-[width] will-change-[width]", ease)}
            style={{ width: collapsed ? MENU_COLLAPSED_WIDTH : MENU_WIDTH }}
          />
        </aside>
        <EdgeHandle
          collapsed={collapsed}
          label={collapsed ? texts.shell.expand : texts.shell.collapse}
          onClick={toggle}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 print:hidden flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label={texts.shell.areas.openAreaMenu(nav.active?.label ?? title)}
                className="-ml-2 flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
              >
                <Menu
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="truncate">{title}</span>
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </button>
            </SheetTrigger>
            <SheetContent title={nav.active?.label ?? texts.shell.openMenu}>
              <SidebarContent
                account={account}
                membership={membership}
                nav={nav}
                collapsed={false}
                onLogout={onLogout}
                onSearch={openSearch}
                onNewPage={openNewPage}
              />
            </SheetContent>
          </Sheet>
          <p className="hidden truncate font-medium lg:block">{title}</p>
          <p className="hidden text-xs text-muted-foreground first-letter:uppercase md:block">
            {today}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <Tooltip content={pendingLabel}>
              <Button asChild variant="ghost" size="icon" className="relative">
                <Link to={`/app/${slug}/pendientes`} aria-label={pendingLabel}>
                  <ListTodo strokeWidth={1.75} aria-hidden="true" />
                  {nav.pending > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
                    >
                      {nav.pending > 99 ? "99+" : nav.pending}
                    </span>
                  )}
                </Link>
              </Button>
            </Tooltip>
            <Button
              variant="outline"
              size="sm"
              className="bian-wiggle"
              aria-label={texts.bian.ask}
              onClick={() => {
                bianActions.open();
              }}
            >
              <BianAvatar className="h-5" />
              <span className="hidden sm:inline">{texts.bian.ask}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={texts.search.buttonHint}
              title={texts.search.buttonHint}
              onClick={openSearch}
            >
              <Search strokeWidth={1.75} />
            </Button>
            <NotificationBell slug={slug} />
          </div>
        </header>
        <CommandPalette
          open={searching}
          onOpenChange={setSearching}
          startPicking={pickingSpace}
          slug={slug}
          membership={membership}
          onAskBian={(question) => {
            setSearching(false);
            bianActions.open(question === "" ? undefined : { kind: "ask", question });
          }}
        />
        <BianPanel
          open={bianOpen}
          onOpenChange={setBianOpen}
          slug={slug}
          canManage={canSee(membership, "bian")}
          request={bianRequest}
          onRequestTaken={() => {
            setBianRequest(null);
          }}
        />
        <main
          className={cn(
            "mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8",
            nav.showRail && "pb-24 md:pb-6",
          )}
        >
          <RestartBanner />
          {/* key: cada pantalla entra con su animación, no solo la primera. */}
          <div key={pathname} className="page-enter">
            <BianContext.Provider value={bianActions}>{children}</BianContext.Provider>
          </div>
        </main>
      </div>
      {nav.showRail && <BottomBar nav={nav} />}
    </div>
  );
}
