// Marco de la app (10.4): sidebar de 260 px que se contrae a 72 px (solo íconos), barra superior
// fina y contenido sobre bg-surface. En móvil, el sidebar es un panel lateral (Sheet).
// Los ítems de módulos que todavía no existen no se muestran.
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
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Upload,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { adminNavItems, canSee, mainNavItems } from "@/components/nav-items";
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
import { cn } from "@/lib/utils";
import { locale, texts } from "@/i18n";
import { RestartBanner } from "./restart-banner";

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
  | { kind: "count"; count: number; tone: "primary" | "warning"; label: string }
  | { kind: "dot"; tone: "primary" | "warning"; label: string };

const toneClass = {
  primary: "bg-primary text-primary-foreground",
  warning: "bg-warning text-warning-foreground",
} as const;
const dotClass = { primary: "bg-primary", warning: "bg-warning" } as const;

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
      content={indicator === undefined ? label : `${label} · ${indicator.label}`}
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

function SidebarContent({
  account,
  membership,
  collapsed,
  onLogout,
  onSearch,
  onNewPage,
  className,
}: {
  account: Account;
  membership: Membership;
  collapsed: boolean;
  onLogout: () => void;
  onSearch: () => void;
  onNewPage: () => void;
  className?: string;
}) {
  const { pathname } = useLocation();
  const slug = membership.workspace.slug;
  const plugins = useActivePlugins(slug);
  const adminItems = adminNavItems(slug, membership, plugins);
  const canAdminister = adminItems.length > 0;
  // Dentro del panel de administración el menú es el suyo; fuera, el principal.
  const inAdmin = canAdminister && pathname.startsWith(`/app/${slug}/admin`);
  const items = mainNavItems(slug, membership, plugins);
  const role = membership.role.base;
  const favorites = useQuery({
    queryKey: [...filesKeys.favoriteSpaces(slug), "nav"],
    queryFn: () =>
      filesApi.spaces(slug, { filter: "favorites", sort: "favorite", pageSize: FAVORITES_SHOWN }),
    staleTime: 60_000,
    enabled: !inAdmin,
  });
  const recents = useQuery({
    queryKey: [...documentsKeys.recent(slug), "nav"],
    queryFn: () => documentsApi.recent(slug, 5),
    select: (page) => page.items,
    staleTime: 60_000,
    enabled: !inAdmin,
  });
  const sharedSummary = useQuery({
    queryKey: [...filesKeys.all(slug), "shared", "summary"],
    queryFn: () => filesApi.sharedSummary(slug),
    staleTime: 20_000,
  });
  const readingCount = useReadingCount(slug);
  const approvalCount = useApprovalCount(
    slug,
    items.some((item) => item.to === `/app/${slug}/aprobaciones`),
  );
  const unseenShared = sharedSummary.data?.unseen ?? 0;
  const indicatorOf = (to: string): Indicator | undefined => {
    if (to === `/app/${slug}/mis-documentos` && readingCount > 0) {
      return {
        kind: "count",
        count: readingCount,
        tone: "primary",
        label: texts.shell.pendingReadings(readingCount),
      };
    }
    if (to === `/app/${slug}/aprobaciones` && approvalCount > 0) {
      return {
        kind: "count",
        count: approvalCount,
        tone: "warning",
        label: texts.shell.pendingApprovals(approvalCount),
      };
    }
    if (to === `/app/${slug}/files/shared` && unseenShared > 0) {
      return { kind: "dot", tone: "primary", label: texts.shell.newShared };
    }
    return undefined;
  };
  const dark = isDarkTheme();
  const favoriteSpaces = favorites.data?.items ?? [];
  const recentItems = recents.data ?? [];
  return (
    <div className={cn("flex h-full flex-col", className)}>
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
        aria-label={membership.workspace.name}
      >
        <div className="space-y-0.5">
          {inAdmin ? (
            <>
              <NavItem
                to={`/app/${slug}`}
                label={texts.shell.adminBack}
                icon={ArrowLeft}
                collapsed={collapsed}
                active={false}
              />
              <SectionLabel collapsed={collapsed}>{texts.shell.admin}</SectionLabel>
              {adminItems.map(({ to, label, icon }) => (
                <NavItem key={to} to={to} label={label} icon={icon} collapsed={collapsed} />
              ))}
            </>
          ) : (
            <>
              {items.map(({ to, label, icon, end }) => {
                const indicator = indicatorOf(to);
                return (
                  <NavItem
                    key={to}
                    to={to}
                    label={label}
                    icon={icon}
                    collapsed={collapsed}
                    {...(indicator === undefined ? {} : { indicator })}
                    {...(end === true ? { end: true } : {})}
                  />
                );
              })}
              {(favoriteSpaces.length > 0 || !collapsed) && (
                <div className="space-y-2 pt-4">
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
                  {recentItems.length > 0 && !collapsed && (
                    <CollapsibleSection id="recents" label={texts.shell.recents} collapsed={collapsed}>
                      {recentItems.map((item) => (
                        <RecentRow key={item.node.id} slug={slug} item={item} />
                      ))}
                    </CollapsibleSection>
                  )}
                </div>
              )}
              <div className="my-2 h-px bg-border" role="separator" />
              {canAdminister && (
                <NavItem
                  to={`/app/${slug}/admin`}
                  label={texts.shell.admin}
                  icon={Settings}
                  collapsed={collapsed}
                  active={false}
                />
              )}
              <HelpLink collapsed={collapsed} />
            </>
          )}
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
  useSharedToast(membership.workspace.slug);
  const today = new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date());
  return (
    <div className="flex min-h-dvh w-full min-w-0 max-w-full bg-surface">
      <div
        className={cn(
          "sticky top-0 z-40 hidden h-dvh shrink-0 transition-[width] will-change-[width] lg:block print:hidden",
          ease,
          collapsed ? "w-[72px]" : "w-[260px]",
        )}
      >
        <aside className="h-full overflow-hidden border-r border-border bg-background">
          <SidebarContent
            account={account}
            membership={membership}
            collapsed={collapsed}
            onLogout={onLogout}
            onSearch={() => {
              setPickingSpace(false);
              setSearching(true);
            }}
            onNewPage={() => {
              setPickingSpace(true);
              setSearching(true);
            }}
            // El contenido sigue el ancho del panel: con un ancho fijo de 260 px, las filas centradas
            // del modo contraído quedarían fuera de los 72 px visibles (íconos invisibles).
            className={cn(
              "transition-[width] will-change-[width]",
              ease,
              collapsed ? "w-[72px]" : "w-[260px]",
            )}
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
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label={texts.shell.openMenu}
              >
                <Menu strokeWidth={1.75} />
              </Button>
            </SheetTrigger>
            <SheetContent title={texts.shell.openMenu}>
              <SidebarContent
                account={account}
                membership={membership}
                collapsed={false}
                onLogout={onLogout}
                onSearch={() => {
                  setPickingSpace(false);
                  setSearching(true);
                }}
                onNewPage={() => {
                  setPickingSpace(true);
                  setSearching(true);
                }}
              />
            </SheetContent>
          </Sheet>
          <p className="font-medium">{title}</p>
          <p className="hidden text-xs text-muted-foreground first-letter:uppercase md:block">
            {today}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {actions}
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
              onClick={() => {
                setPickingSpace(false);
                setSearching(true);
              }}
            >
              <Search strokeWidth={1.75} />
            </Button>
            <NotificationBell slug={membership.workspace.slug} />
          </div>
        </header>
        <CommandPalette
          open={searching}
          onOpenChange={setSearching}
          startPicking={pickingSpace}
          slug={membership.workspace.slug}
          membership={membership}
          onAskBian={(question) => {
            setSearching(false);
            bianActions.open(question === "" ? undefined : { kind: "ask", question });
          }}
        />
        <BianPanel
          open={bianOpen}
          onOpenChange={setBianOpen}
          slug={membership.workspace.slug}
          canManage={canSee(membership, "bian")}
          request={bianRequest}
          onRequestTaken={() => {
            setBianRequest(null);
          }}
        />
        <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <RestartBanner />
          {/* key: cada pantalla entra con su animación, no solo la primera. */}
          <div key={pathname} className="page-enter">
            <BianContext.Provider value={bianActions}>{children}</BianContext.Provider>
          </div>
        </main>
      </div>
    </div>
  );
}
