// /app/:slug/admin/departments[/:id] — Departamentos (docs/spec/personas.md): estructura de la
// empresa en maestro-detalle. A la izquierda el árbol (padres antes que hijos); a la derecha el
// departamento elegido, con sus personas, subáreas y organigrama. En móvil, el árbol arriba y el
// detalle debajo. Jefe y subjefe ven solo sus áreas; el servidor filtra y valida cada acción.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  MoreHorizontal,
  Network,
  FolderPlus,
  Pencil,
  Plus,
  Star,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar, Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField } from "@/components/ui/form";
import { LoadMore, ShownCounter, useInfiniteList } from "@/components/ui/infinite";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { SpaceFormDialog } from "@/features/files/space-dialogs";
import { useMembership } from "@/features/home/workspace-layout";
import { SearchField } from "@/components/ui/filter-bar";
import { cn } from "@/lib/utils";
import {
  adminApi,
  adminKeys,
  type DepartmentPosition,
  type DepartmentView,
  type MemberView,
  type PersonData,
} from "../api";
import { adminErrorText } from "../admin-utils";
import { useCan, useCanEditPeople } from "../guards";
import { useSearchParam, useListParams } from "../list-params";
import { useDirectorySource } from "../sources";
import { OrgChartView } from "../members/org-chart-view";
import { ColorDot, DepartmentFormDialog } from "./departments-page";
import { texts } from "@/i18n";

const TABS = ["people", "areas"] as const;
const VIEWS = ["areas", "orgchart"] as const;

export function DepartmentsPage() {
  const t = texts.admin.departments;
  const { workspaceSlug = "", id } = useParams();
  const canManage = useCan("departments.manage");
  const [creating, setCreating] = useState<{ id: string; name: string } | "root" | null>(null);
  const navigate = useNavigate();
  // La misma consulta del detalle (caché compartida): de ahí salen los ancestros que el árbol abre.
  const current = useQuery({
    queryKey: adminKeys.department(workspaceSlug, id ?? ""),
    queryFn: () => adminApi.department(workspaceSlug, id ?? ""),
    enabled: id !== undefined,
  });
  const ancestorIds = useMemo(
    () => new Set(current.data?.ancestors.map((ancestor) => ancestor.id) ?? []),
    [current.data],
  );
  const [params, setParams] = useSearchParams();
  const view = VIEWS.find((candidate) => candidate === params.get("view")) ?? "areas";
  const actorBase = useMembership().role.base;
  // "Tu área" solo marca lo que gestiona quien lidera (para administración, todo es suyo).
  const showMine = actorBase !== "OWNER" && actorBase !== "ADMIN";
  // Elegir un departamento (también desde el organigrama) vuelve a Áreas con ese seleccionado.
  const open = (departmentId: string | null, replace = false) => {
    void navigate(
      `/app/${workspaceSlug}/admin/departments${departmentId === null ? "" : `/${departmentId}`}`,
      { replace },
    );
  };
  // Sin uno elegido, se abre el primero (el de más arriba del árbol) en lugar de un panel vacío.
  const first = useQuery({
    queryKey: [...adminKeys.departments(workspaceSlug), "first"],
    queryFn: () =>
      adminApi.departments(workspaceSlug, {
        q: "",
        parent: "root",
        pageSize: 1,
        sort: "name",
        dir: "asc",
      }),
    enabled: id === undefined && view === "areas",
  });
  const firstId = first.data?.items[0]?.id;
  useEffect(() => {
    if (id === undefined && view === "areas" && firstId !== undefined) open(firstId, true);
    // open depende solo de la ruta; reaccionamos al primero que llega.
  }, [id, view, firstId]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div
          role="group"
          aria-label={t.workspace.views.label}
          className="inline-flex w-fit rounded-lg border border-border p-0.5"
        >
          {VIEWS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => {
                setParams(value === "areas" ? {} : { view: value }, { replace: true });
              }}
              className="h-8 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
            >
              {t.workspace.views[value]}
            </button>
          ))}
        </div>
      </div>
      {view === "orgchart" ? (
        <OrgChartScreen />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] lg:items-start">
          <DepartmentTree
            selectedId={id ?? null}
            expandedIds={ancestorIds}
            showMine={showMine}
            onSelect={(departmentId) => {
              open(departmentId);
            }}
            {...(canManage
              ? {
                  onCreate: () => {
                    setCreating("root");
                  },
                }
              : {})}
          />
          {id === undefined ? (
            first.isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <Card className="min-w-0 p-4 sm:p-5">
                <EmptyState icon={Network} title={t.empty.title}>
                  {t.empty.text}
                </EmptyState>
              </Card>
            )
          ) : (
            <DepartmentDetail
              key={id}
              id={id}
              onCreateArea={(parent) => {
                setCreating(parent);
              }}
              onDeleted={() => {
                open(null);
              }}
            />
          )}
        </div>
      )}
      <DepartmentFormDialog
        target={creating === null ? null : "new"}
        parent={creating === null || creating === "root" ? undefined : creating}
        onClose={() => {
          setCreating(null);
        }}
      />
    </div>
  );
}

// ─── Árbol ───────────────────────────────────────────────────────────────────────────────

function DepartmentTree({
  selectedId,
  expandedIds,
  showMine,
  onSelect,
  onCreate,
}: {
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  /** Marca "Tu área" en lo que gestiona quien lidera. */
  showMine: boolean;
  onSelect: (id: string) => void;
  onCreate?: () => void;
}) {
  const t = texts.admin.departments;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  // Con búsqueda, lista plana de resultados; sin ella, los de primer nivel y cada rama al abrirla.
  const roots = useInfiniteList<DepartmentView>({
    queryKey: [...adminKeys.departments(workspaceSlug), "tree", q],
    fetchPage: (cursor) =>
      adminApi.departments(workspaceSlug, {
        q,
        parent: q === "" ? "root" : "",
        pageSize: 25,
        sort: "name",
        dir: "asc",
        ...(cursor === undefined ? {} : { cursor }),
      }),
  });
  return (
    <Card className="min-w-0 overflow-hidden lg:sticky lg:top-20">
      <div className="grid gap-3 border-b border-border p-3">
        <SearchField
          placeholder={t.searchPlaceholder}
          label={texts.admin.common.search}
          value={search}
          onChange={setSearch}
        />
        {onCreate !== undefined && (
          <Button variant="outline" className="justify-start" onClick={onCreate}>
            <Plus strokeWidth={1.75} aria-hidden="true" />
            {t.create}
          </Button>
        )}
      </div>
      <nav aria-label={t.title} className="max-h-[60dvh] overflow-y-auto p-2">
        {roots.query.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : roots.items.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {q === "" ? t.empty.title : t.noResults.title}
          </p>
        ) : (
          <ul role="tree" aria-label={t.title} className="m-0 grid list-none gap-0.5 p-0">
            {roots.items.map((department, index) => (
              <TreeNode
                key={department.id}
                department={department}
                depth={0}
                parentId={null}
                flat={q !== ""}
                selectedId={selectedId}
                expandedIds={expandedIds}
                showMine={showMine}
                tabStop={selectedId === null && index === 0}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
        <LoadMore
          hasNextPage={roots.query.hasNextPage}
          isFetching={roots.query.isFetchingNextPage}
          onLoadMore={roots.loadMore}
        />
      </nav>
    </Card>
  );
}

function TreeNode({
  department,
  depth,
  parentId,
  flat,
  selectedId,
  expandedIds,
  showMine,
  tabStop,
  onSelect,
}: {
  department: DepartmentView;
  depth: number;
  parentId: string | null;
  flat: boolean;
  selectedId: string | null;
  /** Ramas que se abren solas: las del departamento elegido. */
  expandedIds: ReadonlySet<string>;
  showMine: boolean;
  tabStop: boolean;
  onSelect: (id: string) => void;
}) {
  const t = texts.admin.departments;
  const { workspaceSlug = "" } = useParams();
  const [open, setOpen] = useState(expandedIds.has(department.id));
  const rowRef = useRef<HTMLButtonElement>(null);
  const hasChildren = !flat && department.childCount > 0;
  const selected = selectedId === department.id;
  // El árbol sigue a la selección: abre la rama del departamento actual y lo deja a la vista.
  useEffect(() => {
    if (expandedIds.has(department.id)) setOpen(true);
  }, [expandedIds, department.id]);
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const children = useInfiniteList<DepartmentView>({
    queryKey: [...adminKeys.departments(workspaceSlug), "tree", "children", department.id],
    enabled: open && hasChildren,
    fetchPage: (cursor) =>
      adminApi.departments(workspaceSlug, {
        q: "",
        parent: department.id,
        pageSize: 25,
        sort: "name",
        dir: "asc",
        ...(cursor === undefined ? {} : { cursor }),
      }),
  });

  // Teclado (patrón de árbol): flechas arriba y abajo recorren lo visible, derecha abre o entra,
  // izquierda cierra o sube al padre y Enter elige el departamento. Moverse no cambia la selección.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tree = event.currentTarget.closest('[role="tree"]');
    const rows = [...(tree?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? [])];
    const index = rows.indexOf(event.currentTarget);
    const focus = (row: HTMLElement | undefined) => {
      row?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        focus(rows[index + 1]);
        break;
      case "ArrowUp":
        focus(rows[index - 1]);
        break;
      case "Home":
        focus(rows[0]);
        break;
      case "End":
        focus(rows.at(-1));
        break;
      case "ArrowRight":
        if (hasChildren && !open) setOpen(true);
        else if (open) focus(rows[index + 1]);
        break;
      case "ArrowLeft":
        if (open) setOpen(false);
        else if (parentId !== null) focus(rows.find((row) => row.dataset.nodeId === parentId));
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <li role="none">
      <div
        className={cn(
          "group flex h-9 items-center gap-1 rounded-lg pr-2 text-sm transition-colors hover:bg-muted",
          selected &&
            "bg-primary-soft font-medium text-primary-soft-foreground hover:bg-primary-soft",
        )}
        style={{ paddingLeft: `${String(depth * 16 + 4)}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? t.collapse(department.name) : t.expand(department.name)}
            onClick={() => {
              // Solo abre o cierra la rama: no cambia la selección.
              setOpen((current) => !current);
            }}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <ChevronRight
              className={cn("size-4 transition-transform", open && "rotate-90")}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}
        <button
          ref={rowRef}
          type="button"
          role="treeitem"
          data-tree-row=""
          data-node-id={department.id}
          aria-level={depth + 1}
          aria-selected={selected}
          {...(hasChildren ? { "aria-expanded": open } : {})}
          tabIndex={selected || tabStop ? 0 : -1}
          onKeyDown={onKeyDown}
          onClick={() => {
            onSelect(department.id);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ColorDot color={department.color} />
          <span className="truncate">{department.name}</span>
          {showMine && department.access === "manage" && (
            <span className="shrink-0 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-soft-foreground ring-1 ring-primary/20">
              {t.workspace.mine}
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {department.memberCount}
          </span>
        </button>
      </div>
      {open && hasChildren && (
        <ul role="group" className="m-0 grid list-none gap-0.5 p-0">
          {children.items.map((child) => (
            <TreeNode
              key={child.id}
              department={child}
              depth={depth + 1}
              parentId={department.id}
              flat={false}
              selectedId={selectedId}
              expandedIds={expandedIds}
              showMine={showMine}
              tabStop={false}
              onSelect={onSelect}
            />
          ))}
          <li role="none">
            <LoadMore
              className="justify-start p-0"
              hasNextPage={children.query.hasNextPage}
              isFetching={children.query.isFetchingNextPage}
              onLoadMore={children.loadMore}
            />
          </li>
        </ul>
      )}
    </li>
  );
}

// ─── Detalle ─────────────────────────────────────────────────────────────────────────────

function DepartmentDetail({
  id,
  onCreateArea,
  onDeleted,
}: {
  id: string;
  onCreateArea: (parent: { id: string; name: string }) => void;
  onDeleted: () => void;
}) {
  const t = texts.admin.departments;
  const w = t.workspace;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const canManage = useCan("departments.manage");
  const canEditPeople = useCanEditPeople();
  const actorBase = useMembership().role.base;
  const { params, patch } = useListParams();
  const tab = TABS.find((candidate) => candidate === params.get("tab")) ?? "people";
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DepartmentView | null>(null);
  const [deleting, setDeleting] = useState<DepartmentView | null>(null);
  const [creatingSpace, setCreatingSpace] = useState(false);

  const query = useQuery({
    queryKey: adminKeys.department(workspaceSlug, id),
    queryFn: () => adminApi.department(workspaceSlug, id),
  });
  const department = query.data?.department;
  const ancestors = query.data?.ancestors ?? [];

  if (query.isError) {
    return (
      <Card className="min-w-0 p-4 sm:p-5">
        <EmptyState icon={Network} title={t.workspace.notFoundTitle}>
          {t.workspace.notFoundText}
        </EmptyState>
      </Card>
    );
  }
  if (department === undefined) return <Skeleton className="h-64 w-full" />;
  // Solo se edita donde se gestiona; en un departamento ajeno, todo en solo lectura.
  const canEdit = canEditPeople && department.access === "manage";
  const isMine = department.access === "manage" && actorBase !== "OWNER" && actorBase !== "ADMIN";

  return (
    <Card className="min-w-0 overflow-hidden">
      <header className="grid gap-3 border-b border-border p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="size-10 shrink-0 rounded-xl border border-border"
              style={department.color === null ? undefined : { backgroundColor: department.color }}
            />
            <div className="min-w-0">
              {ancestors.length > 0 && (
                <nav aria-label={w.path} className="mb-0.5">
                  <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 p-0 text-xs text-muted-foreground">
                    {ancestors.map((ancestor) => (
                      <li key={ancestor.id} className="flex items-center gap-1">
                        <Link
                          to={`/app/${workspaceSlug}/admin/departments/${ancestor.id}`}
                          className="rounded-md hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                          {ancestor.name}
                        </Link>
                        <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              <h2 className="truncate text-xl font-semibold tracking-tight">{department.name}</h2>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t.members(department.memberCount)}
                {isMine && <Badge tone="primary">{w.mine}</Badge>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button
                onClick={() => {
                  setAdding(true);
                }}
              >
                <UserPlus strokeWidth={1.75} aria-hidden="true" />
                {w.addPeople}
              </Button>
            )}
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={w.departmentActions}>
                    <MoreHorizontal strokeWidth={1.75} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(department);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    {texts.admin.common.edit}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setCreatingSpace(true);
                    }}
                  >
                    <FolderPlus aria-hidden="true" />
                    {texts.files.spaces.createSpaceOf}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-danger"
                    onSelect={() => {
                      setDeleting(department);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    {texts.admin.common.delete}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {department.description !== null && department.description !== "" && (
          <p className="max-w-2xl text-xs text-muted-foreground">{department.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Leader icon="head" person={department.head} />
          {department.deputies.map((deputy) => (
            <Leader key={deputy.membershipId} icon="deputy" person={deputy} />
          ))}
        </div>
      </header>

      <div
        role="tablist"
        aria-label={department.name}
        className="flex gap-1 border-b border-border px-3 pt-2 sm:px-5"
      >
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              patch({ tab: value === "people" ? "" : value, q: "" });
            }}
            className="-mb-px h-10 border-b-2 border-transparent px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:border-primary aria-selected:font-medium aria-selected:text-foreground"
          >
            {w.tabs[value]}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        {tab === "people" && <PeopleTab department={department} canEdit={canEdit} />}
        {tab === "areas" && (
          <AreasTab
            department={department}
            {...(canManage
              ? {
                  onCreate: () => {
                    onCreateArea({ id, name: department.name });
                  },
                }
              : {})}
          />
        )}
      </div>

      <AddPeopleDialog
        department={department}
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
      />
      <SpaceFormDialog
        target={creatingSpace ? { department: { id: department.id, name: department.name } } : null}
        onClose={() => {
          setCreatingSpace(false);
        }}
      />
      <DepartmentFormDialog
        target={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(openState) => {
          if (!openState) setDeleting(null);
        }}
        icon={Trash2}
        title={deleting === null ? "" : t.confirmDelete.title(deleting.name)}
        description={
          deleting === null
            ? ""
            : t.confirmDelete.text(deleting.name, deleting.memberCount, deleting.childCount)
        }
        confirmLabel={t.confirmDelete.action}
        pendingLabel={t.confirmDelete.pending}
        tone="destructive"
        {...(deleting === null ? {} : { requireText: deleting.name })}
        onConfirm={async () => {
          if (deleting === null) return;
          await adminApi.deleteDepartment(workspaceSlug, deleting.id);
          toast.success(t.toasts.deleted);
          await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
          onDeleted();
        }}
      />
    </Card>
  );
}

function Leader({
  icon,
  person,
}: {
  icon: "head" | "deputy";
  person: { membershipId: string; name: string } | null;
}) {
  const w = texts.admin.departments.workspace;
  if (person === null) {
    return icon === "head" ? (
      <span className="text-muted-foreground">{texts.admin.departments.noHead}</span>
    ) : null;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar name={person.name} className="size-7 text-xs" />
      <span>
        <Star
          className="mr-1 inline size-3.5 text-warning"
          strokeWidth={2}
          fill={icon === "head" ? "currentColor" : "none"}
          aria-label={icon === "head" ? w.head : w.deputy}
        />
        {person.name}
      </span>
    </span>
  );
}

// ─── Personas ────────────────────────────────────────────────────────────────────────────

function PeopleTab({ department, canEdit }: { department: DepartmentView; canEdit: boolean }) {
  const t = texts.admin.departments;
  const w = t.workspace;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  // Solo lectura (un departamento que no gestiona): personas con nombre, puesto y cargo, desde el
  // directorio, sin email ni acciones. Gestionando: la lista de gestión.
  const readOnly = department.access === "read";
  const fetchBy = (positions: "leaders" | "members") => (cursor: string | undefined) =>
    adminApi.departmentMembers(workspaceSlug, department.id, {
      q,
      positions,
      pageSize: 25,
      ...(cursor === undefined ? {} : { cursor }),
    });
  const fetchPublic = (positions: "leaders" | "members") => (cursor: string | undefined) =>
    adminApi.orgMembers(workspaceSlug, department.id, {
      q,
      positions,
      pageSize: 25,
      ...(cursor === undefined ? {} : { cursor }),
    });
  const peopleKey = (kind: string) =>
    [...adminKeys.department(workspaceSlug, department.id), "people", kind, q] as const;
  const leaders = useInfiniteList<MemberView>({
    queryKey: peopleKey("leaders"),
    fetchPage: fetchBy("leaders"),
    enabled: !readOnly,
  });
  const members = useInfiniteList<MemberView>({
    queryKey: peopleKey("members"),
    fetchPage: fetchBy("members"),
    enabled: !readOnly,
  });
  const publicLeaders = useInfiniteList<PersonData>({
    queryKey: peopleKey("public-leaders"),
    fetchPage: fetchPublic("leaders"),
    enabled: readOnly,
  });
  const publicMembers = useInfiniteList<PersonData>({
    queryKey: peopleKey("public-members"),
    fetchPage: fetchPublic("members"),
    enabled: readOnly,
  });
  const shown = readOnly
    ? { leaders: publicLeaders, members: publicMembers }
    : { leaders, members };
  const loading = shown.leaders.query.isPending || shown.members.query.isPending;
  const empty = !loading && shown.leaders.items.length === 0 && shown.members.items.length === 0;
  return (
    <div className="grid gap-4">
      <SearchField
        placeholder={t.detail.searchMembers}
        label={texts.admin.common.search}
        value={search}
        onChange={setSearch}
      />
      {loading ? (
        <Skeleton className="h-14 w-full" />
      ) : empty ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          {q === "" ? w.noPeople : t.detail.noResults}
        </p>
      ) : (
        <ul aria-label={w.tabs.people} className="m-0 list-none divide-y divide-border p-0">
          {readOnly
            ? [...publicLeaders.items, ...publicMembers.items].map((person) => (
                <ReadOnlyLine key={person.id} person={person} department={department} />
              ))
            : [...leaders.items, ...members.items].map((person) => (
                <PersonLine
                  key={person.id}
                  person={person}
                  department={department}
                  canEdit={canEdit}
                />
              ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={shown.members.query.hasNextPage}
        isFetching={shown.members.query.isFetchingNextPage}
        onLoadMore={shown.members.loadMore}
      />
      {!loading && !empty && (
        <ShownCounter
          className="static border-t-0 px-0"
          shown={shown.leaders.items.length + shown.members.items.length}
          total={shown.leaders.total + shown.members.total}
        />
      )}
    </div>
  );
}

const POSITIONS: DepartmentPosition[] = ["HEAD", "DEPUTY", "MEMBER"];

/** Fila de solo lectura: avatar, nombre, puesto y cargo; sin email ni acciones. */
function ReadOnlyLine({ person, department }: { person: PersonData; department: DepartmentView }) {
  const w = texts.admin.departments.workspace;
  const position: DepartmentPosition =
    person.departments.find((entry) => entry.id === department.id)?.position ?? "MEMBER";
  return (
    <li className="flex min-h-14 flex-wrap items-center gap-3 py-2">
      <Avatar name={person.name} src={person.avatarUrl} />
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm font-medium">
          {person.name}
          {person.isSelf && (
            <Badge tone="primary" className="ml-2 align-middle">
              {texts.admin.members.you}
            </Badge>
          )}
        </p>
        {person.jobTitle !== null && person.jobTitle !== "" && (
          <p className="truncate text-xs text-muted-foreground">{person.jobTitle}</p>
        )}
      </div>
      <Badge tone={position === "MEMBER" ? "neutral" : "warning"}>{w.position[position]}</Badge>
    </li>
  );
}

function PersonLine({
  person,
  department,
  canEdit,
}: {
  person: MemberView;
  department: DepartmentView;
  canEdit: boolean;
}) {
  const w = texts.admin.departments.workspace;
  const d = texts.admin.departments.detail;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const actor = useMembership().role.base;
  const [removing, setRemoving] = useState(false);
  const position: DepartmentPosition =
    person.departments.find((entry) => entry.id === department.id)?.position ?? "MEMBER";
  const global = actor === "OWNER" || actor === "ADMIN";
  // Un jefe solo nombra subjefes (y no toca al jefe del área ni a sí mismo).
  const canSetPosition = canEdit && !person.isSelf && (global || position !== "HEAD");
  const options = global ? POSITIONS : POSITIONS.filter((value) => value !== "HEAD");
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });

  const change = useMutation({
    mutationFn: (next: DepartmentPosition) =>
      adminApi.setDepartmentPosition(workspaceSlug, department.id, person.id, { position: next }),
    onSuccess: async (result) => {
      toast.success(texts.admin.common.saved);
      if (result.needsFullSeat) {
        toast.warning(texts.admin.departments.workspace.needsFullSeat(person.name));
      }
      await refresh();
    },
    onError: async (error) => {
      toast.error(adminErrorText(error));
      await refresh();
    },
  });

  return (
    <li className="flex min-h-14 flex-wrap items-center gap-3 py-2">
      <Avatar name={person.name} src={person.avatarUrl} />
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm font-medium">
          {person.name}
          {person.isSelf && (
            <Badge tone="primary" className="ml-2 align-middle">
              {texts.admin.members.you}
            </Badge>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[person.jobTitle, person.email]
            .filter((part) => part !== null && part !== "")
            .join(" · ")}
        </p>
      </div>
      {canSetPosition ? (
        <select
          aria-label={w.positionOf(person.name)}
          value={position}
          disabled={change.isPending}
          onChange={(event) => {
            const next = POSITIONS.find((value) => value === event.target.value);
            if (next !== undefined && next !== position) change.mutate(next);
          }}
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
        >
          {options.map((value) => (
            <option key={value} value={value}>
              {w.position[value]}
            </option>
          ))}
        </select>
      ) : (
        <Badge tone={position === "MEMBER" ? "neutral" : "warning"}>{w.position[position]}</Badge>
      )}
      {canEdit && !person.isSelf && position !== "HEAD" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={d.removeMember(person.name)}>
              <MoreHorizontal strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-danger"
              onSelect={() => {
                setRemoving(true);
              }}
            >
              <UserMinus aria-hidden="true" />
              {w.removeFromDepartment}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="size-10" aria-hidden="true" />
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        icon={UserMinus}
        title={d.confirmRemoveMember.title(person.name, department.name)}
        description={d.confirmRemoveMember.text(department.name)}
        confirmLabel={d.confirmRemoveMember.action(department.name)}
        pendingLabel={d.confirmRemoveMember.pending}
        tone="destructive"
        onConfirm={async () => {
          await adminApi.removeDepartmentMember(workspaceSlug, department.id, person.id);
          toast.success(texts.admin.departments.toasts.memberRemoved);
          await refresh();
        }}
      />
    </li>
  );
}

function AddPeopleDialog({
  department,
  open,
  onClose,
}: {
  department: DepartmentView;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open && <AddPeopleForm department={department} onClose={onClose} />}
    </Dialog>
  );
}

function AddPeopleForm({
  department,
  onClose,
}: {
  department: DepartmentView;
  onClose: () => void;
}) {
  const t = texts.admin.departments.detail;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const source = useDirectorySource(workspaceSlug, { inDepartment: department.id });
  const [picked, setPicked] = useState<string[]>([]);
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());

  const add = useMutation({
    mutationFn: () => adminApi.addDepartmentMembers(workspaceSlug, department.id, picked),
    onSuccess: async (result) => {
      toast.success(texts.admin.departments.toasts.membersAdded(result.added));
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  return (
    <DialogContent
      title={t.addMembers}
      description={t.pickMembers}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={add.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={add.isPending || picked.length === 0}
            onClick={() => {
              add.mutate();
            }}
          >
            {add.isPending ? t.adding : t.addMembers}
          </Button>
        </>
      }
    >
      <FormField label={t.members}>
        {(control) => (
          <Combobox
            multiple
            id={control.id}
            label={t.members}
            placeholder={texts.admin.members.searchPlaceholder}
            source={source}
            values={picked}
            valueLabels={labels}
            onChange={(ids, nextLabels) => {
              setPicked(ids);
              setLabels(nextLabels);
            }}
          />
        )}
      </FormField>
    </DialogContent>
  );
}

// ─── Subáreas y organigrama ──────────────────────────────────────────────────────────────

function AreasTab({ department, onCreate }: { department: DepartmentView; onCreate?: () => void }) {
  const w = texts.admin.departments.workspace;
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const areas = useInfiniteList<DepartmentView>({
    queryKey: [...adminKeys.departments(workspaceSlug), "areas", department.id],
    fetchPage: (cursor) =>
      adminApi.departments(workspaceSlug, {
        q: "",
        parent: department.id,
        pageSize: 25,
        sort: "name",
        dir: "asc",
        ...(cursor === undefined ? {} : { cursor }),
      }),
  });
  return (
    <div className="grid gap-4">
      {onCreate !== undefined && (
        <Button variant="outline" className="justify-self-start" onClick={onCreate}>
          <Plus strokeWidth={1.75} aria-hidden="true" />
          {w.newArea}
        </Button>
      )}
      {areas.query.isPending ? (
        <Skeleton className="h-14 w-full" />
      ) : areas.items.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">{w.noAreas}</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {areas.items.map((area) => (
            <li key={area.id}>
              <button
                type="button"
                onClick={() => {
                  void navigate(`/app/${workspaceSlug}/admin/departments/${area.id}`);
                }}
                className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <ColorDot color={area.color} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{area.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {area.head === null ? texts.admin.departments.noHead : `★ ${area.head.name}`}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {texts.admin.departments.members(area.memberCount)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={areas.query.hasNextPage}
        isFetching={areas.query.isFetchingNextPage}
        onLoadMore={areas.loadMore}
      />
      {areas.items.length > 0 && (
        <ShownCounter
          className="static border-t-0 px-0"
          shown={areas.items.length}
          total={areas.total}
        />
      )}
    </div>
  );
}

/** Organigrama de toda la empresa, a pantalla completa. */
export function OrgChartScreen() {
  const t = texts.admin.members;
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  return (
    <div className="grid min-w-0 gap-4">
      <SearchField
        placeholder={t.orgChart.searchPlaceholder}
        label={texts.admin.common.search}
        value={search}
        onChange={setSearch}
      />
      <OrgChartView q={q} />
    </div>
  );
}
