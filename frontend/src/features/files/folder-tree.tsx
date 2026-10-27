// Árbol de carpetas de un espacio (panel izquierdo del explorador): las ramas se cargan al abrirlas,
// la flecha solo abre o cierra y el nombre navega. Se sincroniza con la carpeta actual (abre sus
// ancestros) y es un destino para soltar lo que se arrastra (mover).
import { ChevronRight, FolderOpen, NotebookText } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useParams } from "react-router";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { Skeleton } from "@/components/ui/display";
import { cn } from "@/lib/utils";
import { filesApi, filesKeys, type NodeType, type NodeView } from "./api";
import { isNodeDrag, NODE_DRAG_TYPE } from "./file-utils";
import { texts } from "@/i18n";

interface TreeProps {
  spaceId: string;
  spaceName: string;
  /** Marca del espacio (emoji y color) para la fila raíz. */
  spaceMark?: React.ReactNode;
  /** Si llega por un acceso compartido, el árbol empieza en este elemento y no en el espacio. */
  rootNode?: { id: string; name: string; type: NodeType };
  selectedId: string | null;
  /** Ramas que se abren solas: las de la carpeta actual. */
  expandedIds: ReadonlySet<string>;
  /** Con permiso para mover: se puede soltar un nodo sobre una carpeta. */
  canDrop: boolean;
  /** null: la raíz del espacio; si no, la carpeta o página elegida. */
  onSelect: (node: { id: string; type: NodeType } | null) => void;
  onDropNode: (nodeId: string, folderId: string | null) => void;
}

export function FolderTree(props: TreeProps) {
  const t = texts.files.explorer;
  const { workspaceSlug = "" } = useParams();
  const roots = useInfiniteList<NodeView>({
    queryKey: [
      ...filesKeys.nodes(workspaceSlug, props.spaceId),
      "tree",
      props.rootNode?.id ?? "root",
    ],
    fetchPage: (cursor) =>
      filesApi.nodes(workspaceSlug, props.spaceId, {
        parent: props.rootNode?.id ?? "root",
        type: "CONTAINER",
        sort: "name",
        dir: "asc",
        ...(cursor === undefined ? {} : { cursor }),
      }),
  });
  return (
    <nav aria-label={t.treeLabel} className="max-h-[calc(100dvh-7rem)] overflow-y-auto p-2">
      <DropRow
        label={props.rootNode?.name ?? props.spaceName}
        selected={props.selectedId === (props.rootNode?.id ?? null)}
        depth={0}
        canDrop={props.canDrop}
        onClick={() => {
          props.onSelect(props.rootNode === undefined ? null : props.rootNode);
        }}
        onDropNode={(nodeId) => {
          props.onDropNode(nodeId, props.rootNode?.id ?? null);
        }}
        leading={
          props.rootNode === undefined && props.spaceMark !== undefined ? (
            props.spaceMark
          ) : (
            <FolderOpen
              className="size-4 shrink-0 text-primary"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          )
        }
      />
      {roots.query.isPending ? (
        <Skeleton className="mt-1 h-8 w-full" />
      ) : (
        <ul className="m-0 grid list-none gap-0.5 p-0 pt-0.5">
          {roots.items.map((folder) => (
            <TreeNode key={folder.id} folder={folder} depth={1} {...props} />
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={roots.query.hasNextPage}
        isFetching={roots.query.isFetchingNextPage}
        onLoadMore={roots.loadMore}
      />
    </nav>
  );
}

function DropRow({
  label,
  selected,
  depth,
  canDrop,
  onClick,
  onDropNode,
  leading,
  trailing,
}: {
  label: string;
  selected: boolean;
  depth: number;
  canDrop: boolean;
  onClick: () => void;
  onDropNode: (nodeId: string) => void;
  leading: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  // El árbol sigue a la carpeta actual: la deja a la vista dentro de su propio scroll.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const handlers = canDrop
    ? {
        onDragOver: (event: DragEvent) => {
          if (!isNodeDrag(event)) return;
          event.preventDefault();
          setOver(true);
        },
        onDragLeave: () => {
          setOver(false);
        },
        onDrop: (event: DragEvent) => {
          setOver(false);
          const nodeId = event.dataTransfer.getData(NODE_DRAG_TYPE);
          if (nodeId === "") return;
          event.preventDefault();
          onDropNode(nodeId);
        },
      }
    : {};
  return (
    <div
      ref={rowRef}
      {...handlers}
      className={cn(
        "flex h-9 items-center gap-1 rounded-lg pr-2 text-sm transition-colors hover:bg-muted",
        selected &&
          "bg-primary-soft font-medium text-primary-soft-foreground hover:bg-primary-soft",
        over && "ring-2 ring-primary",
      )}
      style={{ paddingLeft: `${String(depth * 16 + 4)}px` }}
    >
      {trailing ?? <span className="size-6 shrink-0" aria-hidden="true" />}
      <button
        type="button"
        aria-current={selected ? "page" : undefined}
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {leading}
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}

function TreeNode({ folder, depth, ...props }: TreeProps & { folder: NodeView; depth: number }) {
  const t = texts.files.explorer;
  const { workspaceSlug = "" } = useParams();
  const { expandedIds, selectedId } = props;
  const [open, setOpen] = useState(expandedIds.has(folder.id));
  useEffect(() => {
    if (expandedIds.has(folder.id)) setOpen(true);
  }, [expandedIds, folder.id]);
  const children = useInfiniteList<NodeView>({
    queryKey: [...filesKeys.nodes(workspaceSlug, props.spaceId), "tree", folder.id],
    enabled: open,
    fetchPage: (cursor) =>
      filesApi.nodes(workspaceSlug, props.spaceId, {
        parent: folder.id,
        type: "CONTAINER",
        sort: "name",
        dir: "asc",
        ...(cursor === undefined ? {} : { cursor }),
      }),
  });
  return (
    <li>
      <DropRow
        label={folder.name}
        selected={selectedId === folder.id}
        depth={depth}
        canDrop={props.canDrop}
        onClick={() => {
          props.onSelect({ id: folder.id, type: folder.type });
        }}
        onDropNode={(nodeId) => {
          props.onDropNode(nodeId, folder.id);
        }}
        leading={<FolderIconSmall page={folder.type === "PAGE"} />}
        trailing={
          (folder.folderCount ?? 0) === 0 ? undefined : (
            <button
              type="button"
              tabIndex={-1}
              aria-expanded={open}
              aria-label={open ? t.collapse(folder.name) : t.expand(folder.name)}
              onClick={() => {
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
          )
        }
      />
      {open && (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {children.items.map((child) => (
            <TreeNode key={child.id} folder={child} depth={depth + 1} {...props} />
          ))}
          <li>
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

function FolderIconSmall({ page }: { page: boolean }) {
  const Icon = page ? NotebookText : FolderOpen;
  return (
    <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
  );
}
