// Mover elementos (estilo Google Drive): un solo camino para el diálogo «Mover a…», arrastrar y
// soltar (lista, árbol y ruta) y cortar/pegar. El servidor valida todo (permisos de edición en
// origen y destino, ciclos, nombres repetidos); acá se pide, se resuelven los conflictos con
// «Reemplazar» o «Conservar ambos» y se avisa con «Deshacer» e «Ir a la carpeta».
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FolderPlus, Home } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { canEdit, filesApi, filesKeys, type NodeView, type SpaceView } from "./api";
import { NodeIcon } from "./file-utils";
import { texts } from "@/i18n";

export interface MoveTarget {
  spaceId: string;
  parentId: string | null;
}

// ─── Cortar y pegar ──────────────────────────────────────────────────────────────────────

let cutNodes: readonly NodeView[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** Lo que se cortó con Ctrl+X (sigue ahí al cambiar de carpeta hasta pegarlo). */
export const cutClipboard = {
  set(nodes: readonly NodeView[]) {
    cutNodes = nodes;
    emit();
  },
  clear() {
    cutNodes = [];
    emit();
  },
};

export function useCutNodes(): readonly NodeView[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => cutNodes,
  );
}

// ─── Destinos recientes (de esta sesión) ─────────────────────────────────────────────────

interface RecentTarget {
  spaceId: string;
  spaceName: string;
  spaceLevel: SpaceView["level"];
  trail: { id: string; name: string; level: NodeView["level"] }[];
}
let recents: RecentTarget[] = [];

const labelOf = (target: RecentTarget) =>
  [target.spaceName, ...target.trail.map((step) => step.name)].slice(-2).join(" › ");

// ─── Pedir el movimiento ─────────────────────────────────────────────────────────────────

type Conflict = "REPLACE" | "KEEP_BOTH";

interface Moved {
  node: NodeView;
}

export function useMover() {
  const t = texts.files.move;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [asking, setAsking] = useState<{
    count: number;
    resolve: (mode: Conflict | null) => void;
  } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });

  const run = async (
    nodes: readonly NodeView[],
    target: MoveTarget,
    mode: "FAIL" | Conflict,
  ): Promise<{ done: Moved[]; conflicts: NodeView[]; failed: unknown[] }> => {
    const done: Moved[] = [];
    const conflicts: NodeView[] = [];
    const failed: unknown[] = [];
    for (const node of nodes) {
      try {
        await filesApi.moveNode(workspaceSlug, node.id, target.parentId, {
          spaceId: target.spaceId,
          onConflict: mode,
        });
        done.push({ node });
      } catch (error) {
        if (mode === "FAIL" && error instanceof ApiError && error.code === "CONFLICT") {
          conflicts.push(node);
        } else failed.push(error);
      }
    }
    return { done, conflicts, failed };
  };

  /** "Finanzas › Proyectos": los dos últimos niveles del destino. */
  const describe = async (target: MoveTarget): Promise<string> => {
    const space = await queryClient.query({
      queryKey: filesKeys.space(workspaceSlug, target.spaceId),
      queryFn: () => filesApi.space(workspaceSlug, target.spaceId),
    });
    if (target.parentId === null) return space.space.name;
    const detail = await queryClient.query({
      queryKey: filesKeys.node(workspaceSlug, target.parentId),
      queryFn: () => filesApi.node(workspaceSlug, target.parentId ?? ""),
    });
    return [space.space.name, ...detail.ancestors.map((a) => a.name), detail.node.name]
      .slice(-2)
      .join(" › ");
  };

  const requestMove = async (nodes: readonly NodeView[], target: MoveTarget): Promise<void> => {
    const todo = nodes.filter(
      (node) => !(node.spaceId === target.spaceId && node.parentId === target.parentId),
    );
    if (todo.length === 0) {
      toast.info(t.alreadyThere);
      return;
    }
    const first = await run(todo, target, "FAIL");
    const done = [...first.done];
    const failed = [...first.failed];
    if (first.conflicts.length > 0) {
      const mode = await new Promise<Conflict | null>((resolve) => {
        setAsking({ count: first.conflicts.length, resolve });
      });
      setAsking(null);
      if (mode !== null) {
        const second = await run(first.conflicts, target, mode);
        done.push(...second.done);
        failed.push(...second.failed);
      }
    }
    await refresh();
    if (done.length === 0) {
      if (failed.length > 0) toast.error(adminErrorText(failed[0]));
      return;
    }
    if (failed.length > 0) toast.error(t.partial(done.length, failed.length));
    const where = await describe(target);
    toast.success(t.moved(where), {
      duration: 10_000,
      action: {
        label: texts.common.undo,
        onClick: () => {
          void (async () => {
            try {
              for (const { node } of done) {
                await filesApi.moveNode(workspaceSlug, node.id, node.parentId, {
                  spaceId: node.spaceId,
                  onConflict: "FAIL",
                });
              }
              await refresh();
              toast.success(texts.common.undone);
            } catch (error) {
              toast.error(adminErrorText(error));
            }
          })();
        },
      },
      cancel: {
        label: t.goTo,
        onClick: () => {
          void navigate(
            `/app/${workspaceSlug}/files/${target.spaceId}${target.parentId === null ? "" : `/f/${target.parentId}`}`,
          );
        },
      },
    });
  };

  const conflictDialog: ReactNode = (
    <Dialog
      open={asking !== null}
      onOpenChange={(open) => {
        if (!open) asking?.resolve(null);
      }}
    >
      {asking !== null && (
        <DialogContent
          title={t.conflict.title(asking.count)}
          description={t.conflict.text}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="outline">{texts.admin.common.cancel}</Button>
              </DialogClose>
              <Button
                variant="outline"
                onClick={() => {
                  asking.resolve("KEEP_BOTH");
                }}
              >
                {t.conflict.keepBoth}
              </Button>
              <Button
                onClick={() => {
                  asking.resolve("REPLACE");
                }}
              >
                {t.conflict.replace}
              </Button>
            </>
          }
        >
          <p className="text-xs text-muted-foreground">{t.conflict.hint}</p>
        </DialogContent>
      )}
    </Dialog>
  );

  return { requestMove, conflictDialog };
}

// ─── Diálogo «Mover a…» ──────────────────────────────────────────────────────────────────

interface Location {
  /** null = la lista de espacios. */
  space: { id: string; name: string; level: SpaceView["level"] } | null;
  trail: { id: string; name: string; level: NodeView["level"] }[];
}

export function MoveDialog({
  nodes,
  start,
  onPick,
  onClose,
}: {
  nodes: readonly NodeView[] | null;
  /** Dónde abrir: la carpeta actual. */
  start: Location;
  onPick: (target: MoveTarget) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={nodes !== null && nodes.length > 0}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {nodes !== null && nodes.length > 0 && (
        <MoveForm
          key={nodes.map((n) => n.id).join(",")}
          nodes={nodes}
          start={start}
          onPick={onPick}
        />
      )}
    </Dialog>
  );
}

function MoveForm({
  nodes,
  start,
  onPick,
}: {
  nodes: readonly NodeView[];
  start: Location;
  onPick: (target: MoveTarget) => void;
}) {
  const t = texts.files.move;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [location, setLocation] = useState<Location>(start);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const movingIds = new Set(nodes.map((node) => node.id));
  const { space, trail } = location;
  const current = trail.at(-1) ?? null;

  const spaces = useInfiniteList<SpaceView>({
    queryKey: [...filesKeys.spaces(workspaceSlug), "move", search],
    enabled: space === null,
    fetchPage: (cursor) =>
      filesApi.spaces(workspaceSlug, {
        q: search,
        sort: "name",
        pageSize: 50,
        ...(cursor === undefined ? {} : { cursor }),
      }),
  });
  const folders = useInfiniteList<NodeView>({
    queryKey: [
      ...filesKeys.nodes(workspaceSlug, space?.id ?? ""),
      "move",
      current?.id ?? "root",
      search,
    ],
    enabled: space !== null,
    fetchPage: (cursor) =>
      filesApi.nodes(workspaceSlug, space?.id ?? "", {
        parent: current?.id ?? "root",
        type: "FOLDER",
        q: search,
        sort: "name",
        dir: "asc",
        ...(cursor === undefined ? {} : { cursor }),
      }),
  });

  const go = (next: Location) => {
    setLocation(next);
    setSearch("");
    setCreating(null);
    setError(null);
  };
  const levelHere = space === null ? null : (current?.level ?? space.level);
  const editableHere = levelHere !== null && canEdit(levelHere);
  const sameAsSource = nodes.every(
    (node) => node.spaceId === space?.id && node.parentId === (current?.id ?? null),
  );
  const insideMoving = trail.some((step) => movingIds.has(step.id));
  const blocked: string | null =
    space === null
      ? t.pickSpace
      : insideMoving
        ? t.reasons.inside
        : !editableHere
          ? t.reasons.noPermission
          : sameAsSource
            ? t.reasons.alreadyHere
            : null;

  const create = async () => {
    if (space === null || creating === null || creating.trim() === "") return;
    try {
      const { node } = await filesApi.createFolder(workspaceSlug, space.id, {
        parentId: current?.id ?? null,
        name: creating.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: filesKeys.nodes(workspaceSlug, space.id) });
      go({ space, trail: [...trail, { id: node.id, name: node.name, level: node.level }] });
    } catch (failure) {
      setError(adminErrorText(failure));
    }
  };

  const pick = () => {
    if (space === null || blocked !== null) return;
    recents = [
      { spaceId: space.id, spaceName: space.name, spaceLevel: space.level, trail },
      ...recents.filter(
        (r) => !(r.spaceId === space.id && r.trail.at(-1)?.id === trail.at(-1)?.id),
      ),
    ].slice(0, 4);
    onPick({ spaceId: space.id, parentId: current?.id ?? null });
  };

  const row = (
    key: string,
    icon: ReactNode,
    name: string,
    disabledReason: string | null,
    onEnter: () => void,
  ) => (
    <li key={key}>
      <button
        type="button"
        disabled={disabledReason !== null}
        onClick={onEnter}
        className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          {disabledReason !== null && (
            <span className="block truncate text-xs text-muted-foreground">{disabledReason}</span>
          )}
        </span>
        {disabledReason === null && (
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
    </li>
  );

  return (
    <DialogContent
      title={nodes.length === 1 ? t.title(nodes[0]?.name ?? "") : t.titleMany(nodes.length)}
      size="lg"
      footer={
        <>
          <p className="mr-auto min-w-0 truncate text-xs text-muted-foreground">{blocked}</p>
          <DialogClose asChild>
            <Button variant="outline">{texts.admin.common.cancel}</Button>
          </DialogClose>
          <Button disabled={blocked !== null} onClick={pick}>
            {t.here}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {recents.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t.recent}</span>
            {recents.map((target) => (
              <button
                key={`${target.spaceId}:${target.trail.at(-1)?.id ?? ""}`}
                type="button"
                onClick={() => {
                  go({
                    space: { id: target.spaceId, name: target.spaceName, level: target.spaceLevel },
                    trail: target.trail,
                  });
                }}
                className="h-7 max-w-48 truncate rounded-full border border-border px-2.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {labelOf(target)}
              </button>
            ))}
          </div>
        )}
        <nav aria-label={t.path}>
          <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 p-0 text-sm">
            <li>
              <button
                type="button"
                onClick={() => {
                  go({ space: null, trail: [] });
                }}
                className="inline-flex items-center gap-1 rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:underline"
              >
                <Home className="size-3.5" aria-hidden="true" />
                {t.spaces}
              </button>
            </li>
            {space !== null && (
              <li className="flex items-center gap-1">
                <span aria-hidden="true">›</span>
                <button
                  type="button"
                  onClick={() => {
                    go({ space, trail: [] });
                  }}
                  className={cn(
                    "rounded-md hover:underline focus-visible:outline-none focus-visible:underline",
                    trail.length === 0 && "font-medium",
                  )}
                >
                  {space.name}
                </button>
              </li>
            )}
            {trail.map((step, index) => (
              <li key={step.id} className="flex items-center gap-1">
                <span aria-hidden="true">›</span>
                <button
                  type="button"
                  onClick={() => {
                    go({ space, trail: trail.slice(0, index + 1) });
                  }}
                  className={cn(
                    "rounded-md hover:underline focus-visible:outline-none focus-visible:underline",
                    index === trail.length - 1 && "font-medium",
                  )}
                >
                  {step.name}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex gap-2">
          <Input
            type="search"
            value={search}
            placeholder={space === null ? t.searchSpaces : t.searchFolders}
            aria-label={texts.admin.common.search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          <Button
            variant="outline"
            disabled={!editableHere || space === null}
            onClick={() => {
              setCreating("");
            }}
          >
            <FolderPlus strokeWidth={1.75} aria-hidden="true" />
            {t.newFolder}
          </Button>
        </div>
        {creating !== null && (
          <div className="flex gap-2">
            <Input
              autoFocus
              value={creating}
              maxLength={255}
              placeholder={t.newFolderName}
              aria-label={t.newFolderName}
              onChange={(event) => {
                setCreating(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
                if (event.key === "Escape") setCreating(null);
              }}
            />
            <Button disabled={creating.trim() === ""} onClick={() => void create()}>
              {t.create}
            </Button>
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <ul className="m-0 h-72 list-none overflow-y-auto p-0">
          {space === null ? (
            spaces.query.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              spaces.items.map((item) =>
                row(
                  item.id,
                  <Home className="size-5 shrink-0 text-primary" aria-hidden="true" />,
                  item.name,
                  item.archived
                    ? t.reasons.archived
                    : !canEdit(item.level)
                      ? t.reasons.noPermission
                      : null,
                  () => {
                    go({ space: { id: item.id, name: item.name, level: item.level }, trail: [] });
                  },
                ),
              )
            )
          ) : folders.query.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : folders.items.length === 0 ? (
            <li className="py-6 text-center text-xs text-muted-foreground">{t.noFolders}</li>
          ) : (
            folders.items.map((folder) =>
              row(
                folder.id,
                <NodeIcon node={folder} />,
                folder.name,
                movingIds.has(folder.id)
                  ? t.reasons.itself
                  : !canEdit(folder.level)
                    ? t.reasons.noPermission
                    : null,
                () => {
                  go({
                    space,
                    trail: [...trail, { id: folder.id, name: folder.name, level: folder.level }],
                  });
                },
              ),
            )
          )}
          <LoadMore
            hasNextPage={space === null ? spaces.query.hasNextPage : folders.query.hasNextPage}
            isFetching={
              space === null ? spaces.query.isFetchingNextPage : folders.query.isFetchingNextPage
            }
            onLoadMore={space === null ? spaces.loadMore : folders.loadMore}
          />
        </ul>
      </div>
    </DialogContent>
  );
}
