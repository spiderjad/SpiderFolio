// /app/:slug/files — los espacios a los que la persona tiene acceso, pensados para decenas de ellos:
// favoritos y recientes arriba, filtros rápidos, tarjetas compactas agrupadas por área o una lista
// ordenable. Todo se filtra, ordena y pagina en el servidor (scroll infinito). Cada espacio abre su
// explorador. Crear espacios pide spaces.create (o ser jefe del departamento); archivarlos y dar
// acceso, gestionar el espacio.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  FolderOpen,
  LayoutGrid,
  List,
  Lock,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { InfiniteList, LoadMore, ShownCounter, useInfiniteList } from "@/components/ui/infinite";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui/overlay";
import { adminErrorText, loadErrorIcon, loadErrorText } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { useMembership } from "@/features/home/workspace-layout";
import { ShareDialog } from "@/features/sharing/share-dialog";
import { SharedMark } from "@/features/sharing/shared-mark";
import { SearchField } from "@/components/ui/filter-bar";
import { cn, formatShortDate } from "@/lib/utils";
import { filesApi, filesKeys, type SpaceFilter, type SpaceView } from "./api";
import { spaceAccessText } from "./file-utils";
import { SpaceMark } from "./space-mark";
import { SpaceFormDialog, type SpaceTarget } from "./space-dialogs";
import { texts } from "@/i18n";

const FILTERS = [
  { param: "todos", filter: "all" },
  { param: "mis-departamentos", filter: "mine" },
  { param: "favoritos", filter: "favorites" },
  { param: "privados", filter: "private" },
] as const satisfies readonly { param: string; filter: SpaceFilter }[];

/** Cuántos espacios muestran las filas Favoritos y Recientes. */
const SHELF_MAX = 5;

const SORTS = { area: "department", nombre: "name", creado: "createdAt" } as const;
type SortParam = keyof typeof SORTS;

/** Marca o desmarca un espacio como favorito y refresca todo lo que lo muestra. */
function useFavorite() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (space: SpaceView) =>
      filesApi.setFavorite(workspaceSlug, space.id, !space.favorite),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
}

export function SpacesPage() {
  const t = texts.files.spaces;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { capabilities } = useMembership();
  // Quien lidera un departamento puede crear espacios de ese departamento sin tener la capacidad.
  const hasCreateCapability = capabilities.includes("spaces.create");
  const choices = useQuery({
    queryKey: [...filesKeys.departmentChoices(workspaceSlug), "any"],
    queryFn: () => filesApi.spaceDepartmentChoices(workspaceSlug, { pageSize: 1 }),
    enabled: !hasCreateCapability,
    retry: false,
  });
  const canCreate = hasCreateCapability || (choices.data?.total ?? 0) > 0;
  const canSeeArchived = capabilities.includes("spaces.manage");

  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const archived = canSeeArchived && params.get("archivados") === "1";
  const [search, setSearch] = useSearchParam("q", q, patch);
  const filterParam = FILTERS.find((item) => item.param === params.get("filtro")) ?? FILTERS[0];
  const filter = filterParam.filter;
  const view = params.get("vista") === "lista" ? "lista" : "tarjetas";
  const sortParam: SortParam = (() => {
    const raw = params.get("orden");
    if (raw === "area" || raw === "nombre" || raw === "creado") return raw;
    return view === "lista" ? "nombre" : "area";
  })();
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  const [editing, setEditing] = useState<SpaceTarget | null>(null);
  // «Nuevo espacio» del menú «+» llega con ?crear=espacio: abre el diálogo una sola vez.
  const wantsCreate = params.get("crear") === "espacio";
  useEffect(() => {
    if (!wantsCreate) return;
    if (canCreate) setEditing("new");
    patch({ crear: undefined });
  }, [wantsCreate, canCreate, patch]);
  const [sharing, setSharing] = useState<SpaceView | null>(null);
  const [archiving, setArchiving] = useState<SpaceView | null>(null);

  const list = useInfiniteList<SpaceView>({
    queryKey: [...filesKeys.spaces(workspaceSlug), "list", q, archived, filter, sortParam, dir],
    fetchPage: (cursor, signal) =>
      filesApi.spaces(
        workspaceSlug,
        {
          q,
          archived,
          filter,
          sort: SORTS[sortParam],
          dir,
          ...(cursor === undefined ? {} : { cursor }),
        },
        signal,
      ),
  });

  // Favoritos y recientes, arriba, mientras no se esté buscando ni filtrando.
  const shelves = filter === "all" && q === "" && !archived;
  const favorites = useQuery({
    queryKey: filesKeys.favoriteSpaces(workspaceSlug),
    queryFn: () =>
      filesApi.spaces(workspaceSlug, {
        filter: "favorites",
        sort: "favorite",
        pageSize: SHELF_MAX,
      }),
    enabled: shelves,
  });
  const recents = useQuery({
    queryKey: filesKeys.recentSpaces(workspaceSlug),
    queryFn: () => filesApi.recentSpaces(workspaceSlug),
    enabled: shelves,
  });

  const restore = useMutation({
    mutationFn: (space: SpaceView) => filesApi.restoreSpace(workspaceSlug, space.id),
    onSuccess: async () => {
      toast.success(t.toasts.restored);
      await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const favorite = useFavorite();

  const actions = {
    onEdit: setEditing,
    onShare: setSharing,
    onArchive: setArchiving,
    onRestore: (space: SpaceView) => {
      restore.mutate(space);
    },
    onFavorite: (space: SpaceView) => {
      favorite.mutate(space);
    },
  };

  const sortBy = (next: SortParam) => {
    patch({
      orden: next === (view === "lista" ? "nombre" : "area") ? "" : next,
      dir: sortParam === next && dir === "asc" ? "desc" : "",
    });
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSeeArchived && (
            <Button
              variant="outline"
              onClick={() => {
                patch({ archivados: archived ? "" : "1" });
              }}
            >
              {archived ? t.hideArchived : t.showArchived}
            </Button>
          )}
          {canCreate && (
            <Button
              onClick={() => {
                setEditing("new");
              }}
            >
              <Plus strokeWidth={1.75} aria-hidden="true" />
              {t.create}
            </Button>
          )}
        </div>
      </div>

      {shelves && (
        <>
          {(favorites.data?.items.length ?? 0) > 0 && (
            <Shelf
              title={t.sectionFavorites}
              items={favorites.data?.items ?? []}
              actions={actions}
              {...((favorites.data?.total ?? 0) > SHELF_MAX
                ? {
                    viewAll: {
                      label: t.viewAllFavorites(favorites.data?.total ?? 0),
                      onClick: () => {
                        patch({ filtro: "favoritos" });
                      },
                    },
                  }
                : {})}
            />
          )}
          {(recents.data?.items.length ?? 0) > 0 && (
            <Shelf
              title={t.sectionRecent}
              items={(recents.data?.items ?? []).slice(0, SHELF_MAX)}
              actions={actions}
            />
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t.filters.label} className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.param}
              type="button"
              aria-pressed={filter === item.filter}
              onClick={() => {
                patch({ filtro: item.param === "todos" ? "" : item.param });
              }}
              className="h-9 rounded-full border border-border px-3.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:border-primary/30 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
            >
              {t.filters[item.filter]}
            </button>
          ))}
        </div>
        <SearchField
          className="ml-auto min-w-48 max-w-sm flex-1 basis-56"
          placeholder={t.searchPlaceholder}
          label={texts.admin.common.search}
          value={search}
          onChange={setSearch}
        />
        <div
          role="group"
          aria-label={t.viewLabel}
          className="inline-flex rounded-lg border border-border p-0.5"
        >
          {(["tarjetas", "lista"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              aria-label={value === "tarjetas" ? t.viewCards : t.viewList}
              onClick={() => {
                patch({ vista: value === "tarjetas" ? "" : value, orden: "", dir: "" });
              }}
              className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-primary-soft aria-pressed:text-primary-soft-foreground"
            >
              {value === "tarjetas" ? (
                <LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <List className="size-4" strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </div>

      {list.query.isError && list.query.data === undefined ? (
        <Card className="p-4 sm:p-5">
          <EmptyState
            icon={loadErrorIcon(list.query.error)}
            title={texts.admin.common.loadError}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  void list.query.refetch();
                }}
              >
                {texts.common.retry}
              </Button>
            }
          >
            {loadErrorText(list.query.error)}
          </EmptyState>
        </Card>
      ) : list.query.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : list.items.length === 0 ? (
        <Card className="p-4 sm:p-5">
          <EmptyState
            icon={filter === "favorites" ? Star : FolderOpen}
            title={
              q !== ""
                ? t.noResults.title
                : filter === "favorites"
                  ? t.noFavorites.title
                  : t.empty.title
            }
          >
            {q !== ""
              ? t.noResults.text
              : filter === "favorites"
                ? t.noFavorites.text
                : filter !== "all"
                  ? t.noResults.text
                  : canCreate
                    ? t.empty.text
                    : t.empty.textNoCreate}
          </EmptyState>
        </Card>
      ) : view === "lista" ? (
        <SpaceTable
          items={list.items}
          sortParam={sortParam}
          dir={dir}
          onSort={sortBy}
          paging={{
            total: list.total,
            hasNextPage: list.query.hasNextPage,
            isFetchingNextPage: list.query.isFetchingNextPage,
            onLoadMore: list.loadMore,
          }}
          actions={actions}
        />
      ) : (
        <>
          <CardGroups items={list.items} grouped={sortParam === "area"} actions={actions} />
          <LoadMore
            hasNextPage={list.query.hasNextPage}
            isFetching={list.query.isFetchingNextPage}
            onLoadMore={list.loadMore}
          />
          <ShownCounter
            className="static border-t-0 px-0"
            shown={list.items.length}
            total={list.total}
          />
        </>
      )}

      <SpaceFormDialog
        target={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
      <ShareDialog
        subject={
          sharing === null
            ? null
            : { type: "space", id: sharing.id, name: sharing.name, spaceId: sharing.id }
        }
        onClose={() => {
          setSharing(null);
        }}
      />
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        icon={Archive}
        title={archiving === null ? "" : t.confirmArchive.title(archiving.name)}
        description={t.confirmArchive.text}
        confirmLabel={t.confirmArchive.action}
        pendingLabel={t.confirmArchive.pending}
        tone="warning"
        onConfirm={async () => {
          if (archiving === null) return;
          await filesApi.archiveSpace(workspaceSlug, archiving.id);
          toast.success(t.toasts.archived);
          await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
        }}
      />
    </div>
  );
}

interface Actions {
  onEdit: (space: SpaceView) => void;
  onShare: (space: SpaceView) => void;
  onArchive: (space: SpaceView) => void;
  onRestore: (space: SpaceView) => void;
  onFavorite: (space: SpaceView) => void;
}

// ─── Favoritos y recientes ───────────────────────────────────────────────────────────────

function Shelf({
  title,
  items,
  actions,
  viewAll,
}: {
  title: string;
  items: readonly SpaceView[];
  actions: Actions;
  /** «Ver todos (N)»: lleva a la lista completa. */
  viewAll?: { label: string; onClick: () => void };
}) {
  const { workspaceSlug = "" } = useParams();
  return (
    <section aria-label={title} className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        {viewAll !== undefined && (
          <button
            type="button"
            onClick={viewAll.onClick}
            className="rounded text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {viewAll.label}
          </button>
        )}
      </div>
      {/* Grilla que se adapta al ancho: 5 columnas en escritorio, menos en pantallas chicas. */}
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {items.map((space) => (
          <li key={space.id} className="min-w-0">
            <Card className="group relative flex items-center gap-2.5 p-2.5 transition-colors hover:border-primary/40">
              <SpaceMark space={space} />
              <div className="min-w-0 flex-1">
                <Tooltip content={space.name}>
                  <Link
                    to={`/app/${workspaceSlug}/files/${space.id}`}
                    className="block truncate text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/40"
                  >
                    {space.name}
                  </Link>
                </Tooltip>
                <p className="truncate text-xs text-muted-foreground">
                  {space.department?.name ?? texts.files.spaces.company}
                </p>
              </div>
              <SharedMark sharing={space.sharing} className="relative z-10" />
              <FavoriteButton space={space} onToggle={actions.onFavorite} />
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FavoriteButton({
  space,
  onToggle,
}: {
  space: SpaceView;
  onToggle: (space: SpaceView) => void;
}) {
  const t = texts.files.spaces;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative z-10 size-8 shrink-0"
      aria-pressed={space.favorite}
      aria-label={space.favorite ? t.unfavorite(space.name) : t.favorite(space.name)}
      onClick={() => {
        onToggle(space);
      }}
    >
      <Star
        className={cn("size-4", space.favorite && "fill-warning text-warning")}
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </Button>
  );
}

// ─── Tarjetas ────────────────────────────────────────────────────────────────────────────

/** Secciones por área (la lista ya llega ordenada: primero la empresa y luego cada departamento). */
function CardGroups({
  items,
  grouped,
  actions,
}: {
  items: readonly SpaceView[];
  grouped: boolean;
  actions: Actions;
}) {
  if (!grouped) return <CardGrid items={items} actions={actions} />;
  const groups: { id: string; title: string; items: SpaceView[] }[] = [];
  for (const space of items) {
    const id = space.department?.id ?? "";
    const last = groups.at(-1);
    if (last?.id === id) last.items.push(space);
    else
      groups.push({
        id,
        title: space.department?.name ?? texts.files.spaces.company,
        items: [space],
      });
  }
  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <section key={group.id} aria-label={group.title} className="grid gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{group.title}</h2>
          <CardGrid items={group.items} actions={actions} />
        </section>
      ))}
    </div>
  );
}

function CardGrid({ items, actions }: { items: readonly SpaceView[]; actions: Actions }) {
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((space) => (
        <li key={space.id}>
          <SpaceCard space={space} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

function modifiedText(space: SpaceView): string {
  return space.lastModifiedAt === null
    ? texts.files.spaces.noActivity
    : texts.files.spaces.modified(formatShortDate(space.lastModifiedAt));
}

function SpaceMenu({ space, actions }: { space: SpaceView; actions: Actions }) {
  const t = texts.files.spaces;
  if (!space.canManage) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative z-10 size-8"
          aria-label={t.actions(space.name)}
        >
          <MoreHorizontal strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            actions.onEdit(space);
          }}
        >
          <Pencil aria-hidden="true" />
          {t.edit}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            actions.onShare(space);
          }}
        >
          <Users aria-hidden="true" />
          {t.manage}
        </DropdownMenuItem>
        {space.archived ? (
          <DropdownMenuItem
            onSelect={() => {
              actions.onRestore(space);
            }}
          >
            <ArchiveRestore aria-hidden="true" />
            {t.restore}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={() => {
              actions.onArchive(space);
            }}
          >
            <Archive aria-hidden="true" />
            {t.archive}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SpaceCard({ space, actions }: { space: SpaceView; actions: Actions }) {
  const t = texts.files.spaces;
  const { workspaceSlug = "" } = useParams();
  return (
    <Card className="group relative flex h-full min-w-0 flex-col gap-1.5 p-3 transition-colors hover:border-primary/40">
      <div className="flex items-start gap-2.5">
        <SpaceMark space={space} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            <Link
              to={`/app/${workspaceSlug}/files/${space.id}`}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring/40"
            >
              {space.name}
            </Link>
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {space.department === null ? t.company : t.departmentLabel(space.department.name)}
          </p>
        </div>
        <FavoriteButton space={space} onToggle={actions.onFavorite} />
        <SpaceMenu space={space} actions={actions} />
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {t.contents(space.pageCount, space.fileCount)} · {modifiedText(space)}
      </p>
      <p className="truncate text-xs text-muted-foreground" title={spaceAccessText(space)}>
        {spaceAccessText(space)}
      </p>
      {(space.isPrivate || space.archived) && (
        <div className="flex flex-wrap gap-1.5">
          {space.isPrivate && (
            <Badge className="gap-1">
              {space.isConfidential ? (
                <LockKeyhole className="size-3" strokeWidth={2} aria-hidden="true" />
              ) : (
                <Lock className="size-3" strokeWidth={2} aria-hidden="true" />
              )}
              {space.isConfidential ? t.confidential : t.private}
            </Badge>
          )}
          {space.archived && <Badge tone="warning">{t.archived}</Badge>}
        </div>
      )}
    </Card>
  );
}

// ─── Lista ───────────────────────────────────────────────────────────────────────────────

const TABLE_COLUMNS =
  "grid-cols-[minmax(0,1fr)_2.25rem_2.25rem] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_6rem_8rem_2.25rem_2.25rem]";

function SortHeader({
  label,
  param,
  sortParam,
  dir,
  onSort,
}: {
  label: string;
  param: SortParam;
  sortParam: SortParam;
  dir: "asc" | "desc";
  onSort: (param: SortParam) => void;
}) {
  const t = texts.files.spaces;
  const active = sortParam === param;
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => {
        onSort(param);
      }}
      aria-label={t.sortBy(label)}
      className="inline-flex items-center gap-1 text-left uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:underline"
    >
      {label}
      {active && <Arrow className="size-3" strokeWidth={2} aria-hidden="true" />}
    </button>
  );
}

function SpaceTable({
  items,
  sortParam,
  dir,
  onSort,
  paging,
  actions,
}: {
  items: readonly SpaceView[];
  sortParam: SortParam;
  dir: "asc" | "desc";
  onSort: (param: SortParam) => void;
  paging: {
    total: number;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    onLoadMore: () => void;
  };
  actions: Actions;
}) {
  const t = texts.files.spaces;
  const { workspaceSlug = "" } = useParams();
  return (
    <Card className="overflow-hidden">
      <div
        className={cn(
          "grid items-center gap-x-4 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground",
          TABLE_COLUMNS,
        )}
      >
        <SortHeader
          label={t.columns.name}
          param="nombre"
          sortParam={sortParam}
          dir={dir}
          onSort={onSort}
        />
        <span className="hidden md:block">
          <SortHeader
            label={t.columns.department}
            param="area"
            sortParam={sortParam}
            dir={dir}
            onSort={onSort}
          />
        </span>
        <span className="hidden uppercase tracking-wide md:block">{t.columns.files}</span>
        <span className="hidden uppercase tracking-wide md:block">{t.columns.modified}</span>
        <span />
        <span />
      </div>
      <InfiniteList
        items={items}
        getKey={(space) => space.id}
        paging={paging}
        label={texts.files.nav}
        estimateHeight={56}
        maxHeightClass="max-h-[calc(100dvh-20rem)]"
        renderItem={(space) => (
          <div
            className={cn(
              "relative grid min-h-14 items-center gap-x-4 px-4 py-1.5 transition-colors hover:bg-muted/60",
              TABLE_COLUMNS,
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <SpaceMark space={space} size="sm" />
              <div className="min-w-0">
                <Link
                  to={`/app/${workspaceSlug}/files/${space.id}`}
                  className="block truncate text-sm font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/40"
                >
                  {space.name}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">
                  {spaceAccessText(space)}
                </span>
              </div>
              {space.isPrivate &&
                (space.isConfidential ? (
                  <LockKeyhole
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={2}
                    aria-label={t.confidential}
                  />
                ) : (
                  <Lock
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={2}
                    aria-label={t.private}
                  />
                ))}
            </div>
            <span className="hidden truncate text-xs text-muted-foreground md:block">
              {space.department?.name ?? t.company}
            </span>
            <span className="hidden text-xs text-muted-foreground md:block">
              {t.contents(space.pageCount, space.fileCount)}
            </span>
            <span className="hidden truncate text-xs text-muted-foreground md:block">
              {modifiedText(space)}
            </span>
            <FavoriteButton space={space} onToggle={actions.onFavorite} />
            <div className="justify-self-end">
              <SpaceMenu space={space} actions={actions} />
            </div>
          </div>
        )}
      />
    </Card>
  );
}
