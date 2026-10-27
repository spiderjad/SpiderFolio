// Segunda vista de Miembros: "Organigrama". La raíz es la empresa (con el propietario como dato,
// no como nodo) y debajo, con líneas conectoras, todos los departamentos y subdepartamentos: la
// estructura se ve siempre completa. Lo que se abre y se cierra son las personas de cada área
// (jefe, subjefes y miembros, de a páginas con "Ver más"). Cada rama de la estructura pide sus
// datos al servidor por páginas. El buscador abre el área de la persona. "Sin departamento" va al
// final. En móvil es la misma lista con sangría y las mismas líneas.
import { loadErrorIcon, loadErrorText } from "@/features/admin/admin-utils";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  MoreHorizontal,
  Search as SearchIcon,
  Star,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { LoadMore } from "@/components/ui/infinite";
import { TreeItem, TreeList } from "@/components/ui/tree";
import { cn } from "@/lib/utils";
import {
  adminApi,
  adminKeys,
  asPerson,
  type DepartmentBlock,
  type OrgChart,
  type OrgSearchHit,
} from "../api";
import { ColorDot } from "../departments/departments-page";
import { useCanEditPeople } from "../guards";
import { useMembership } from "@/features/home/workspace-layout";
import { DepartmentPeople } from "./department-people";
import {
  MoreList,
  PersonRow,
  PREVIEW,
  usePeopleDialogs,
  type PersonActionHandlers,
  type PositionTarget,
} from "./people";
import { texts } from "@/i18n";

const BRANCH_PAGE = 10;
/** Alto de la barra superior de la app (px): la barra de ruta queda justo debajo. */
const TOP_OFFSET_PX = 56;
const PATH_BAR_PX = 44;

interface Shared {
  isOpen: (id: string) => boolean;
  /** departamentoId → nombre de la persona buscada (se muestra solo a esa persona entre los miembros). */
  focus: ReadonlyMap<string, string>;
  /** Resultado de una búsqueda: el área y la persona a resaltar. */
  highlight: { departmentId: string; membershipId: string } | null;
  toggle: (id: string) => void;
  clearFocus: (id: string) => void;
  handlers: PersonActionHandlers;
  onPosition: (target: PositionTarget) => void;
}

export function OrgChartView({ q }: { q: string }) {
  const t = texts.admin.members.orgChart;
  const { workspaceSlug = "" } = useParams();
  const { handlers, dialogs, openPosition } = usePeopleDialogs();
  // Abierto = (todo abierto) XOR (está en `toggled`): así "Expandir todo" y "Contraer todo" son
  // un solo cambio de estado y valen también para las ramas que todavía no se cargaron.
  const [openAll, setOpenAll] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<ReadonlyMap<string, string>>(new Map());
  const [highlight, setHighlight] = useState<Shared["highlight"]>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const path = usePathBar(containerRef);

  const isOpen = (id: string) => openAll !== toggled.has(id);
  const setOpenState = (id: string, open: boolean) => {
    setToggled((current) => {
      const next = new Set(current);
      if (open === openAll) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const shared: Shared = {
    isOpen,
    focus,
    highlight,
    toggle: (id) => {
      setOpenState(id, !isOpen(id));
    },
    clearFocus: (id) => {
      setFocus((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    },
    handlers,
    onPosition: openPosition,
  };

  const pick = (hit: OrgSearchHit, place: OrgSearchHit["places"][number]) => {
    for (const id of place.path) setOpenState(id, true);
    setFocus((current) => new Map(current).set(place.departmentId, hit.name));
    setHighlight({ departmentId: place.departmentId, membershipId: hit.membershipId });
  };

  const setAll = (open: boolean) => {
    setOpenAll(open);
    setToggled(new Set());
    setFocus(new Map());
    setHighlight(null);
  };

  return (
    <div ref={containerRef} className="grid grid-cols-1 gap-4">
      <PathBar path={path} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAll(true);
          }}
        >
          <ChevronsUpDown strokeWidth={1.75} aria-hidden="true" />
          {t.expandAll}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAll(false);
          }}
        >
          <ChevronsDownUp strokeWidth={1.75} aria-hidden="true" />
          {t.collapseAll}
        </Button>
      </div>
      {q.trim().length >= 2 && <SearchResults slug={workspaceSlug} q={q.trim()} onPick={pick} />}
      <Branch parent="root" trail={[]} shared={shared} />
      {dialogs}
    </div>
  );
}

/**
 * Ruta del área que se está viendo ("Finanzas › Contabilidad"): la del último encabezado que
 * pasó por debajo de la barra superior y cuya rama todavía no terminó.
 */
function usePathBar(containerRef: RefObject<HTMLElement | null>): string {
  const [path, setPath] = useState("");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const root = containerRef.current;
      if (root === null) return;
      const threshold = TOP_OFFSET_PX + PATH_BAR_PX;
      let current = "";
      for (const heading of root.querySelectorAll<HTMLElement>("[data-org-path]")) {
        const branch = heading.closest("li");
        const top = heading.getBoundingClientRect().top;
        const bottom = branch?.getBoundingClientRect().bottom ?? Number.POSITIVE_INFINITY;
        if (top <= threshold && bottom > threshold) current = heading.dataset.orgPath ?? "";
      }
      setPath(current);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [containerRef]);
  return path;
}

/** Barra fija arriba (bajo la barra superior de la app) con la ruta actual al hacer scroll. */
function PathBar({ path }: { path: string }) {
  const t = texts.admin.members.orgChart;
  if (path === "") return null;
  return (
    <div
      aria-label={t.currentPath}
      className="sticky z-20 -mb-2 flex h-11 items-center gap-2 rounded-xl border border-border bg-background/95 px-4 text-sm shadow-card backdrop-blur"
      style={{ top: TOP_OFFSET_PX }}
    >
      <Building2
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate font-medium">{path}</span>
    </div>
  );
}

function CompanyHeader({ chart }: { chart: OrgChart }) {
  const t = texts.admin.members.orgChart;
  const { role } = useMembership();
  const sawAll = role.base === "OWNER" || role.base === "ADMIN";
  return (
    <Card className="flex items-center gap-3 px-4 py-4 sm:px-6">
      <Building2 className="size-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0">
        <CardTitle className="truncate text-base">{t.root(chart.company.name)}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {chart.company.owner === null ? t.noOwner : t.owner(chart.company.owner.name)}
        </p>
        {chart.memberVisibility === "department" && role.base !== "MEMBER" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {sawAll ? t.seesAllAdmin : t.seesAllLeader}
          </p>
        )}
      </div>
    </Card>
  );
}

function SearchResults({
  slug,
  q,
  onPick,
}: {
  slug: string;
  q: string;
  onPick: (hit: OrgSearchHit, place: OrgSearchHit["places"][number]) => void;
}) {
  const t = texts.admin.members.orgChart;
  const hits = useQuery({
    queryKey: [...adminKeys.members(slug), "org-search", q],
    queryFn: ({ signal }) => adminApi.orgChartSearch(slug, q, signal),
  });
  return (
    <Card className="overflow-hidden">
      {hits.data === undefined ? (
        <Skeleton className="m-4 h-10" />
      ) : hits.data.hits.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">{t.searchNone}</p>
      ) : (
        <ul className="divide-y divide-border">
          {hits.data.hits.map((hit) => (
            <li key={hit.membershipId} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="text-sm font-medium">{hit.name}</span>
              {hit.places.length === 0 ? (
                <Badge>{texts.admin.members.byDepartment.unassigned}</Badge>
              ) : (
                hit.places.map((place) => (
                  <Button
                    key={place.departmentId}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onPick(hit, place);
                    }}
                  >
                    <SearchIcon strokeWidth={1.75} aria-hidden="true" />
                    {place.departmentName}
                  </Button>
                ))
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Los departamentos de un nivel (la raíz o los hijos de uno), de a páginas. En la raíz suma la
 * empresa arriba y "Sin departamento" como última rama.
 */
function Branch({
  parent,
  trail,
  shared,
}: {
  parent: string;
  /** Nombres de los ancestros, de la raíz hacia abajo. */
  trail: readonly string[];
  shared: Shared;
}) {
  const t = texts.admin.members.orgChart;
  const { workspaceSlug = "" } = useParams();
  const isRoot = parent === "root";
  const query = useInfiniteQuery({
    queryKey: [...adminKeys.members(workspaceSlug), "org-chart", parent],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      adminApi.orgChart(
        workspaceSlug,
        { parent, cursor: pageParam, pageSize: BRANCH_PAGE, preview: PREVIEW },
        signal,
      ),
    getNextPageParam: (last) => last.departments.nextCursor ?? undefined,
  });

  if (query.isError && query.data === undefined) {
    return (
      <Card>
        <EmptyState
          icon={loadErrorIcon(query.error)}
          title={texts.admin.common.loadError}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void query.refetch();
              }}
            >
              {texts.common.retry}
            </Button>
          }
        >
          {loadErrorText(query.error)}
        </EmptyState>
      </Card>
    );
  }
  if (query.data === undefined) return <Skeleton className="h-24 w-full" />;

  const first = query.data.pages[0];
  const blocks = query.data.pages.flatMap((page) => page.departments.items);
  const unassigned = isRoot ? first?.unassigned : null;

  // Cada rama del árbol: departamentos, "Cargar más" y (en la raíz) "Sin departamento".
  const entries: { key: string; compact?: boolean; node: ReactNode }[] = blocks.map((block) => ({
    key: block.department.id,
    compact: block.department.memberCount === 0,
    node: <OrgNode block={block} trail={trail} shared={shared} />,
  }));
  if (query.hasNextPage || query.isFetchingNextPage) {
    entries.push({
      key: "more",
      compact: true,
      node: (
        <LoadMore
          className="justify-start p-0"
          hasNextPage={query.hasNextPage}
          isFetching={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
        />
      ),
    });
  }
  if (unassigned !== null && unassigned !== undefined && unassigned.members.total > 0) {
    entries.push({ key: "unassigned", node: <UnassignedCard unassigned={unassigned} /> });
  }

  return (
    <>
      {isRoot && first !== undefined && <CompanyHeader chart={first} />}
      {entries.length === 0 ? (
        isRoot ? (
          <Card>
            <EmptyState icon={Building2}>
              {texts.admin.members.byDepartment.noDepartmentsAtAll}
            </EmptyState>
          </Card>
        ) : null
      ) : (
        <TreeList label={t.branchLabel} className={cn(isRoot && "ml-5")}>
          {entries.map((entry, index) => (
            <TreeItem
              key={entry.key}
              last={index === entries.length - 1}
              {...(entry.compact === true ? { compact: true } : {})}
            >
              {entry.node}
            </TreeItem>
          ))}
        </TreeList>
      )}
    </>
  );
}

function OrgNode({
  block,
  trail,
  shared,
}: {
  block: DepartmentBlock;
  trail: readonly string[];
  shared: Shared;
}) {
  const t = texts.admin.members.orgChart;
  const { workspaceSlug = "" } = useParams();
  const canManage = useCanEditPeople();
  const { department, head, deputies } = block;
  // Un área sin personas es una sola línea compacta: no hay nada que abrir.
  const empty = department.memberCount === 0;
  const isOpen = !empty && shared.isOpen(department.id);
  const filter = shared.focus.get(department.id);
  const contentId = `org-${department.id}`;
  const path = [...trail, department.name];
  const highlighted = shared.highlight?.departmentId === department.id;
  const cardRef = useRef<HTMLDivElement>(null);
  // Resultado de una búsqueda: la rama se abre y se lleva al centro de la pantalla.
  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlighted]);
  const ref = { id: department.id, name: department.name };

  return (
    <>
      <Card className={cn("overflow-hidden", highlighted && "ring-2 ring-primary/50")}>
        <div
          ref={cardRef}
          data-org-path={path.join(" › ")}
          className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 sm:px-4"
        >
          {empty ? (
            <span className="size-8 shrink-0" aria-hidden="true" />
          ) : (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={contentId}
              aria-label={isOpen ? t.close(department.name) : t.open(department.name)}
              onClick={() => {
                shared.toggle(department.id);
              }}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <ChevronRight
                className={cn("size-4 transition-transform", isOpen && "rotate-90")}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
          )}
          <ColorDot color={department.color} />
          <Link
            to={`/app/${workspaceSlug}/admin/departments/${department.id}`}
            className="min-w-0 truncate text-base font-semibold hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {department.name}
          </Link>
          <span className="inline-flex min-w-0 flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span className={head === null ? "" : "text-foreground"}>
              {head === null ? t.noHead : `★ ${head.name}`}
            </span>
            {deputies.length > 0 && <span>☆ {deputies.map((d) => d.name).join(", ")}</span>}
          </span>
          <Badge className="ml-auto">
            {texts.admin.members.peopleAndAreas(department.memberCount, department.childCount)}
          </Badge>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${texts.admin.common.actions}: ${department.name}`}
                >
                  <MoreHorizontal strokeWidth={1.75} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    shared.onPosition({ department: ref, position: "HEAD", member: null });
                  }}
                >
                  <Star aria-hidden="true" />
                  {head === null
                    ? texts.admin.members.byDepartment.assignHead
                    : texts.admin.members.byDepartment.changeHead}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    shared.onPosition({ department: ref, position: "DEPUTY", member: null });
                  }}
                >
                  <UserPlus aria-hidden="true" />
                  {texts.admin.members.byDepartment.addDeputy}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {isOpen && (
          <div id={contentId}>
            {filter !== undefined && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border bg-primary-soft/40 px-4 py-2 text-sm">
                <span>{t.filteredBy(filter)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    shared.clearFocus(department.id);
                  }}
                >
                  {t.clearFilter}
                </Button>
              </div>
            )}
            <DepartmentPeople
              block={block}
              handlers={shared.handlers}
              {...(filter === undefined ? {} : { memberFilter: filter })}
              {...(highlighted && shared.highlight !== null
                ? { highlightId: shared.highlight.membershipId }
                : {})}
            />
          </div>
        )}
      </Card>
      {department.childCount > 0 && <Branch parent={department.id} trail={path} shared={shared} />}
    </>
  );
}

function UnassignedCard({ unassigned }: { unassigned: NonNullable<OrgChart["unassigned"]> }) {
  const t = texts.admin.members.byDepartment;
  const { workspaceSlug = "" } = useParams();
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-4 pb-3 pt-5 sm:px-6">
        <Users className="size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0">
          <CardTitle className="text-base">{t.unassigned}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.unassignedHint}</p>
        </div>
        <Badge className="ml-auto">{texts.admin.members.people(unassigned.members.total)}</Badge>
      </div>
      <MoreList
        initial={unassigned.members.items.map(asPerson)}
        total={unassigned.members.total}
        nextCursor={unassigned.members.nextCursor}
        fetchPage={async (cursor) =>
          await adminApi.orgMembers(workspaceSlug, "none", { cursor, pageSize: PREVIEW })
        }
        renderRow={(member) => <PersonRow member={member} />}
      />
    </Card>
  );
}
