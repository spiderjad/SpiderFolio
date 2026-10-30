// /app/:slug/files/:spaceId[/f/:folderId] — explorador de archivos de un espacio, estilo Drive:
// árbol de carpetas a la izquierda, ruta navegable, lista o cuadrícula, subidas arrastrando y
// soltando (cola con progreso), vista previa, descarga, renombrar y mover. Lo que se ve y se puede
// hacer lo decide el servidor (nivel de acceso de cada nodo); acá solo se oculta lo que no vale.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FolderUp,
  Eye,
  FileArchive,
  FolderPlus,
  FolderSearch,
  LayoutGrid,
  List,
  MoreHorizontal,
  NotebookText,
  History,
  Move,
  Pencil,
  Plus,
  Trash2,
  X,
  Upload,
  Users,
  ClipboardCheck,
  Sparkles,
  QrCode,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import { useDropzone } from "react-dropzone";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar, Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox } from "@/components/ui/form";
import {
  LIST_VIRTUALIZE_AFTER,
  LoadMore,
  ShownCounter,
  useInfiniteList,
} from "@/components/ui/infinite";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui/overlay";
import { adminErrorText, loadErrorIcon, loadErrorText } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { NotFoundPage } from "@/features/home/not-found-page";
import { SearchField } from "@/components/ui/filter-bar";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";
import { undoToast } from "@/components/ui/undo-toast";
import {
  canEdit,
  canManage,
  filesApi,
  filesKeys,
  previewKind,
  trashApi,
  type NodeType,
  type NodeView,
} from "./api";
import { VersionsDialog } from "./versions-dialog";
import { isNodeDrag, NODE_DRAG_TYPE, NodeIcon, spaceReasonText } from "./file-utils";
import { FolderTree } from "./folder-tree";
import { SpaceMark } from "./space-mark";
import { ImportReportDialog, relativePathOf, useFolderImport, ZipImportDialog } from "./imports";
import { NewFolderDialog, RenameDialog } from "./node-dialogs";
import { cutClipboard, MoveDialog, useCutNodes, useMover, type MoveTarget } from "./move";
import { PreviewDialog } from "./preview-dialog";
import { useBian } from "../bian/bian-context";
import { ControlDialog } from "../documents/control-dialog";
import { QrDialog } from "../qr/qr-dialog";
import { ShareDialog } from "../sharing/share-dialog";
import { SharedMark } from "../sharing/shared-mark";
import { NewPageDialog } from "../pages/new-page-dialog";
import { useUploads } from "./uploads";
import { useMembership } from "../home/workspace-layout";
import { PluginFolderMenuItems, PluginNodeMenuItems } from "@/plugins/plugin-actions";
import { texts } from "@/i18n";

const SORTS = { nombre: "name", modificado: "updatedAt" } as const;
type SortParam = keyof typeof SORTS;

export function ExplorerPage() {
  const t = texts.files.explorer;
  const { workspaceSlug = "", spaceId = "", folderId } = useParams();
  const membership = useMembership();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const uploads = useUploads();
  const { params, patch } = useListParams();
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  const view = params.get("vista") === "cuadricula" ? "cuadricula" : "lista";
  const sortParam: SortParam = params.get("orden") === "modificado" ? "modificado" : "nombre";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";
  // Filtro rápido (Todo · Páginas · Archivos): las carpetas se ven siempre, para poder navegar.
  const kindParam = params.get("tipo");
  const kind = kindParam === "paginas" ? "pages" : kindParam === "archivos" ? "files" : undefined;

  const space = useQuery({
    queryKey: filesKeys.space(workspaceSlug, spaceId),
    queryFn: () => filesApi.space(workspaceSlug, spaceId),
    select: (data) => data.space,
  });
  const folder = useQuery({
    queryKey: filesKeys.node(workspaceSlug, folderId ?? ""),
    queryFn: () => filesApi.node(workspaceSlug, folderId ?? ""),
    enabled: folderId !== undefined,
  });

  // Abrir el espacio lo suma a "Recientes" (si falla, no pasa nada).
  useEffect(() => {
    filesApi.visitSpace(workspaceSlug, spaceId).catch(() => undefined);
  }, [workspaceSlug, spaceId]);

  const parent = folderId ?? "root";
  const list = useInfiniteList<NodeView>({
    queryKey: [
      ...filesKeys.nodes(workspaceSlug, spaceId),
      "list",
      parent,
      q,
      sortParam,
      dir,
      kind ?? "all",
    ],
    fetchPage: (cursor, signal) =>
      filesApi.nodes(
        workspaceSlug,
        spaceId,
        {
          parent,
          q,
          sort: SORTS[sortParam],
          dir,
          ...(kind === undefined ? {} : { kind }),
          ...(cursor === undefined ? {} : { cursor }),
        },
        signal,
      ),
  });

  const [creating, setCreating] = useState(false);
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  const [renaming, setRenaming] = useState<NodeView | null>(null);
  const [moving, setMoving] = useState<NodeView[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkTrashing, setBulkTrashing] = useState(false);
  const lastToggled = useRef<number | null>(null);
  const listScroll = useRef<HTMLDivElement>(null);
  const [versioning, setVersioning] = useState<NodeView | null>(null);
  const [sharingNode, setSharingNode] = useState<NodeView | null>(null);
  const [controlNode, setControlNode] = useState<NodeView | null>(null);
  const [qrNode, setQrNode] = useState<NodeView | null>(null);
  const [previewing, setPreviewing] = useState<NodeView | null>(null);
  const [zipNode, setZipNode] = useState<{ id: string; name: string } | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const folderImport = useFolderImport(spaceId, folderId ?? null);

  const spaceData = space.data;
  const archived = spaceData?.archived === true;
  const level = folderId === undefined ? spaceData?.level : folder.data?.node.level;
  const writable = !archived && level !== undefined && canEdit(level);
  // «Nueva página» de la paleta Ctrl+K llega con ?nueva=pagina: abre las plantillas una sola vez.
  const wantsNewPage = params.get("nueva") === "pagina";
  useEffect(() => {
    if (!wantsNewPage || level === undefined) return;
    if (writable) setChoosingTemplate(true);
    patch({ nueva: undefined });
  }, [wantsNewPage, writable, level, patch]);
  // «Revisar» desde la bandeja de aprobaciones llega con ?revisar=<id>: abre el documento controlado
  // de ese archivo, donde se aprueba o se rechaza.
  const reviewId = params.get("revisar");
  const reviewNode = useQuery({
    queryKey: filesKeys.node(workspaceSlug, reviewId ?? ""),
    queryFn: () => filesApi.node(workspaceSlug, reviewId ?? ""),
    enabled: reviewId !== null,
  });
  const reviewTarget =
    reviewId === null || reviewNode.data === undefined
      ? null
      : { id: reviewNode.data.node.id, name: reviewNode.data.node.name };
  const movable = !archived && level !== undefined && canManage(level);
  const folderName = folder.data?.node.name ?? spaceData?.name ?? "";

  // La selección vale para la lista que se está viendo: al cambiar de carpeta o de filtro se limpia.
  useEffect(() => {
    setSelected(new Set());
    lastToggled.current = null;
  }, [folderId, q, sortParam, dir]);

  const goToNode = (node: { id: string; type: NodeType } | null) => {
    if (node?.type === "PAGE") {
      void navigate(`/app/${workspaceSlug}/files/${spaceId}/p/${node.id}`);
    } else {
      goTo(node?.id ?? null);
    }
  };
  const goTo = (id: string | null) => {
    void navigate(`/app/${workspaceSlug}/files/${spaceId}${id === null ? "" : `/f/${id}`}`);
  };

  // Mover (diálogo, arrastrar y soltar, cortar y pegar): un solo camino, con conflictos y «Deshacer».
  const mover = useMover();
  const cut = useCutNodes();
  const cutIds = useMemo(() => new Set(cut.map((node) => node.id)), [cut]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Mandar a la papelera (con deshacer): se restaura desde el aviso o desde la Papelera.
  const trash = useMutation({
    mutationFn: (node: NodeView) => trashApi.trashNode(workspaceSlug, node.id),
    onSuccess: async (_result, node) => {
      await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
      undoToast(texts.files.trash.moved(node.name), async () => {
        await trashApi.restoreNode(workspaceSlug, node.id);
        await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
      });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  const download = async (node: NodeView) => {
    try {
      const ticket = await filesApi.download(workspaceSlug, node.id);
      const link = document.createElement("a");
      link.href = ticket.url;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(adminErrorText(error));
    }
  };
  const open = (node: NodeView) => {
    if (node.type === "FOLDER") goTo(node.id);
    else if (node.type === "PAGE") goToNode(node);
    else if (previewKind(node.mimeType) !== null) setPreviewing(node);
    else void download(node);
  };

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: pickFiles,
  } = useDropzone({
    noClick: true,
    noKeyboard: true,
    disabled: !writable,
    onDrop: (accepted) => {
      // Lo que viene dentro de carpetas pasa por la importación (estructura validada en el servidor).
      const flat = accepted.filter((file) => !relativePathOf(file).includes("/"));
      const nested = accepted.filter((file) => relativePathOf(file).includes("/"));
      if (flat.length > 0) {
        uploads.enqueue(flat, { spaceId, parentId: folderId ?? null });
      }
      if (nested.length > 0) void folderImport.start(nested);
    },
  });

  // «Subir archivos» del menú «+» llega con ?subir=1: abre el selector una sola vez.
  const wantsUpload = params.get("subir") === "1";
  useEffect(() => {
    if (!wantsUpload || level === undefined) return;
    if (writable) pickFiles();
    patch({ subir: undefined });
  }, [wantsUpload, writable, level, patch, pickFiles]);

  const ancestors = folder.data?.ancestors ?? [];
  const shareRoot = folder.data?.shareRoot ?? null;
  const expandedIds = useMemo(() => new Set(ancestors.map((a) => a.id)), [ancestors]);

  // Sin acceso al espacio, una carpeta compartida igual se abre (el servidor decide).
  if (space.isError && (folderId === undefined || folder.isError)) return <NotFoundPage />;
  if (folderId !== undefined && folder.isError) return <NotFoundPage />;

  // Lo que se arrastra son uno o varios ids separados por coma (la selección, si incluye al nodo).
  const dropNodes = (payload: string, folder: string | null) => {
    setDropTarget(null);
    const ids = new Set(payload.split(",").filter((id) => id !== "" && id !== folder));
    const nodes = [...list.items, ...cut].filter((node, index, all) => {
      return ids.has(node.id) && all.findIndex((other) => other.id === node.id) === index;
    });
    if (nodes.length > 0) void mover.requestMove(nodes, { spaceId, parentId: folder });
  };
  const dropFolder = (event: DragEvent, id: string | null) => {
    const payload = event.dataTransfer.getData(NODE_DRAG_TYPE);
    if (payload === "") return;
    event.preventDefault();
    dropNodes(payload, id);
  };

  const selectedNodes = list.items.filter((node) => selected.has(node.id));
  const toggle = (node: NodeView, index: number, range: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      const anchor = lastToggled.current;
      if (range && anchor !== null) {
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
        for (const item of list.items.slice(from, to + 1)) next.add(item.id);
      } else if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
    lastToggled.current = index;
  };
  const toggleAll = (all: boolean) => {
    setSelected(all ? new Set(list.items.map((node) => node.id)) : new Set());
    lastToggled.current = null;
  };

  const downloadZip = useMutation({
    mutationFn: () =>
      filesApi.requestZip(
        workspaceSlug,
        spaceId,
        selectedNodes.map((node) => node.id),
      ),
    onSuccess: (result) => {
      if (result.mode === "background") {
        // Más de 500 MB: se arma en segundo plano y llega por email.
        toast.info(t.selection.zipBackground);
        return;
      }
      // Un enlace normal: el navegador lo baja directo a disco (sin fetch ni blob en memoria).
      const link = document.createElement("a");
      link.href = result.url;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  const zipOne = useMutation({
    mutationFn: (node: NodeView) => filesApi.requestZip(workspaceSlug, spaceId, [node.id]),
    onSuccess: (result) => {
      if (result.mode === "background") {
        toast.info(t.selection.zipBackground);
        return;
      }
      const link = document.createElement("a");
      link.href = result.url;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  // Ctrl+X corta lo seleccionado y Ctrl+V lo pega en la carpeta que se está viendo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "x" && writable && selectedNodes.length > 0) {
        event.preventDefault();
        cutClipboard.set(selectedNodes.filter((node) => canEdit(node.level)));
        setSelected(new Set());
        toast.info(t.cut.done(selectedNodes.length));
      } else if (key === "v" && writable && cut.length > 0) {
        event.preventDefault();
        const nodes = [...cut];
        cutClipboard.clear();
        void mover.requestMove(nodes, { spaceId, parentId: folderId ?? null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  const trashSelected = async () => {
    let done = 0;
    let firstFailure: Error | null = null;
    for (const node of selectedNodes) {
      try {
        await trashApi.trashNode(workspaceSlug, node.id);
        done += 1;
      } catch (failure) {
        if (firstFailure === null && failure instanceof Error) firstFailure = failure;
      }
    }
    await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
    if (done === 0 && firstFailure !== null) throw firstFailure;
    const failed = selectedNodes.length - done;
    if (failed === 0) toast.success(t.selection.trashed(done));
    else toast.error(t.selection.trashPartial(done, failed));
    setSelected(new Set());
  };

  const rowProps = {
    movable,
    writable,
    cutIds,
    dropTarget,
    setDropTarget,
    onDownloadZip: (node: NodeView) => {
      zipOne.mutate(node);
    },
    onOpen: open,
    onDownload: (node: NodeView) => {
      void download(node);
    },
    onPreview: setPreviewing,
    onRename: setRenaming,
    onMove: (node: NodeView) => {
      setMoving([node]);
    },
    onVersions: setVersioning,
    onShare: setSharingNode,
    onControl: setControlNode,
    onQr: setQrNode,
    onImportZip: setZipNode,
    onTrash: (node: NodeView) => {
      trash.mutate(node);
    },
    onDropOnFolder: dropFolder,
    selected,
    onToggle: toggle,
    onToggleAll: toggleAll,
    dragIds: (node: NodeView) =>
      selected.has(node.id) && selected.size > 1 ? [...selected].join(",") : node.id,
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] lg:items-start">
      <Card className="min-w-0 overflow-hidden lg:sticky lg:top-20">
        {spaceData === undefined && shareRoot === null ? (
          <Skeleton className="m-2 h-9" />
        ) : (
          <FolderTree
            spaceId={spaceId}
            spaceName={spaceData?.name ?? folder.data?.space.name ?? ""}
            {...(spaceData === undefined
              ? {}
              : { spaceMark: <SpaceMark space={spaceData} size="sm" /> })}
            {...(shareRoot === null ? {} : { rootNode: shareRoot })}
            selectedId={folderId ?? null}
            expandedIds={expandedIds}
            canDrop={writable}
            onSelect={goToNode}
            onDropNode={dropNodes}
          />
        )}
      </Card>

      <div {...getRootProps()} className="relative grid min-w-0 gap-4 outline-none">
        <input {...getInputProps()} />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          aria-hidden="true"
          tabIndex={-1}
          {...{ webkitdirectory: "" }}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length > 0) void folderImport.start(files);
          }}
        />
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file === undefined) return;
            // Se sube como cualquier archivo y, al terminar, se pregunta cómo descomprimirlo.
            uploads.enqueue([file], { spaceId, parentId: folderId ?? null }, undefined, setZipNode);
          }}
        />
        {isDragActive && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary-soft/70 text-sm font-medium text-primary-soft-foreground"
          >
            <span className="grid gap-1 text-center">
              <span className="text-base">{t.dropHint}</span>
              <span className="text-xs font-normal">{t.dropHere(folderName)}</span>
            </span>
          </div>
        )}

        <nav aria-label={t.breadcrumb}>
          <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-0.5 p-0 text-xs text-muted-foreground">
            <Crumb
              to={
                shareRoot === null
                  ? `/app/${workspaceSlug}/files`
                  : `/app/${workspaceSlug}/files/shared`
              }
            >
              {shareRoot === null ? texts.files.nav : texts.files.shared.title}
            </Crumb>
            {shareRoot !== null && folder.data !== undefined && (
              <Crumb plain to="">
                {folder.data.space.name}
              </Crumb>
            )}
            {shareRoot === null && spaceData !== undefined && (
              <Crumb
                to={`/app/${workspaceSlug}/files/${spaceId}`}
                last={folderId === undefined}
                {...(writable
                  ? {
                      onDropPayload: (payload: string) => {
                        dropNodes(payload, null);
                      },
                    }
                  : {})}
              >
                {spaceData.name}
              </Crumb>
            )}
            {ancestors.map((ancestor) => (
              <Crumb
                key={ancestor.id}
                plain={!ancestor.accessible}
                to={`/app/${workspaceSlug}/files/${spaceId}/f/${ancestor.id}`}
                {...(writable
                  ? {
                      onDropPayload: (payload: string) => {
                        dropNodes(payload, ancestor.id);
                      },
                    }
                  : {})}
              >
                {ancestor.name}
              </Crumb>
            ))}
            {folder.data !== undefined && (
              <Crumb last to="">
                {folder.data.node.name}
              </Crumb>
            )}
          </ol>
        </nav>

        {archived && <Banner tone="warning">{t.archivedNotice}</Banner>}
        {spaceData !== undefined && (
          <p className="text-xs text-muted-foreground">
            {t.yourAccess(
              [
                texts.files.levels[spaceData.level],
                ...(spaceData.reason === null ? [] : [spaceReasonText(spaceData.reason)]),
              ].join(" · "),
            )}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {writable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Plus strokeWidth={1.75} aria-hidden="true" />
                  {t.new}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setChoosingTemplate(true);
                  }}
                >
                  <NotebookText aria-hidden="true" />
                  {texts.pages.newPage}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setCreating(true);
                  }}
                >
                  <FolderPlus aria-hidden="true" />
                  {t.newFolder}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={pickFiles}>
                  <Upload aria-hidden="true" />
                  {t.upload}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={folderImport.busy}
                  onSelect={() => folderInput.current?.click()}
                >
                  <FolderUp aria-hidden="true" />
                  {t.uploadFolder}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => zipInput.current?.click()}>
                  <FileArchive aria-hidden="true" />
                  {t.importZip}
                </DropdownMenuItem>
                <PluginFolderMenuItems
                  ctx={{
                    slug: workspaceSlug,
                    person: membership,
                    spaceId,
                    folderId: folderId ?? null,
                  }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <SearchField
            className="min-w-48 flex-1 basis-56"
            placeholder={t.searchPlaceholder}
            label={texts.admin.common.search}
            value={search}
            onChange={setSearch}
          />
          <select
            aria-label={t.sort}
            value={`${sortParam}:${dir}`}
            onChange={(event) => {
              const [orden, direction] = event.target.value.split(":");
              patch({
                orden: orden === "nombre" ? "" : orden,
                dir: direction === "asc" ? "" : direction,
              });
            }}
            className="h-9 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <option value="nombre:asc">{`${t.sortName} ↑`}</option>
            <option value="nombre:desc">{`${t.sortName} ↓`}</option>
            <option value="modificado:desc">{`${t.sortUpdated} ↓`}</option>
            <option value="modificado:asc">{`${t.sortUpdated} ↑`}</option>
          </select>
          <div
            role="group"
            aria-label={t.view}
            className="inline-flex rounded-lg border border-border p-0.5"
          >
            {(["lista", "cuadricula"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                aria-label={value === "lista" ? t.viewList : t.viewGrid}
                onClick={() => {
                  patch({ vista: value === "lista" ? "" : value });
                }}
                className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-primary-soft aria-pressed:text-primary-soft-foreground"
              >
                {value === "lista" ? (
                  <List className="size-4" strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          {spaceData !== undefined && canManage(spaceData.level) && (
            <Button asChild variant="outline">
              <Link to={`/app/${workspaceSlug}/files/${spaceId}/trash`}>
                <Trash2 strokeWidth={1.75} aria-hidden="true" />
                {texts.files.trash.open}
              </Link>
            </Button>
          )}
        </div>

        <div role="group" aria-label={t.filters.label} className="flex flex-wrap gap-1.5">
          {(
            [
              ["", t.filters.all],
              ["paginas", t.filters.pages],
              ["archivos", t.filters.files],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={(kindParam ?? "") === value}
              onClick={() => {
                patch({ tipo: value });
              }}
              className="h-8 rounded-full border border-border px-3.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:border-primary/30 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
            >
              {label}
            </button>
          ))}
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
          <Card className="grid gap-2 p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </Card>
        ) : list.items.length === 0 ? (
          <Card className="p-4 sm:p-5">
            <EmptyState icon={FolderSearch} title={q === "" ? t.empty.title : t.noResults.title}>
              {q !== "" ? t.noResults.text : writable ? t.empty.text : t.empty.textReadOnly}
            </EmptyState>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {selected.size > 0 && (
              <div
                role="toolbar"
                aria-label={t.selection.count(selected.size)}
                className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft px-4 py-2 text-sm text-primary-soft-foreground"
              >
                <span className="mr-auto font-medium">{t.selection.count(selected.size)}</span>
                {writable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setMoving(selectedNodes);
                    }}
                  >
                    <Move strokeWidth={1.75} aria-hidden="true" />
                    {t.selection.move}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloadZip.isPending}
                  onClick={() => {
                    downloadZip.mutate();
                  }}
                >
                  <Download strokeWidth={1.75} aria-hidden="true" />
                  {downloadZip.isPending ? t.selection.downloading : t.selection.download}
                </Button>
                {movable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBulkTrashing(true);
                    }}
                  >
                    <Trash2 strokeWidth={1.75} aria-hidden="true" />
                    {t.selection.trash}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t.selection.clear}
                  onClick={() => {
                    setSelected(new Set());
                  }}
                >
                  <X strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </div>
            )}
            <div ref={listScroll} className="max-h-[calc(100dvh-17rem)] min-h-48 overflow-y-auto">
              {view === "lista" ? (
                <ListView items={list.items} scrollRef={listScroll} {...rowProps} />
              ) : (
                <GridView items={list.items} {...rowProps} />
              )}
              <LoadMore
                hasNextPage={list.query.hasNextPage}
                isFetching={list.query.isFetchingNextPage}
                onLoadMore={list.loadMore}
                root={listScroll}
              />
            </div>
            <ShownCounter shown={list.items.length} total={list.total} />
          </Card>
        )}
      </div>

      <ControlDialog
        target={
          controlNode === null ? reviewTarget : { id: controlNode.id, name: controlNode.name }
        }
        onClose={() => {
          setControlNode(null);
          if (reviewId !== null) patch({ revisar: undefined });
        }}
      />
      <QrDialog
        target={qrNode === null ? null : { id: qrNode.id, name: qrNode.name }}
        onClose={() => {
          setQrNode(null);
        }}
      />
      <ShareDialog
        subject={
          sharingNode === null
            ? null
            : { type: "node", id: sharingNode.id, name: sharingNode.name, spaceId }
        }
        onClose={() => {
          setSharingNode(null);
        }}
      />
      <NewPageDialog
        open={choosingTemplate}
        spaceId={spaceId}
        parentId={folderId ?? null}
        onClose={() => {
          setChoosingTemplate(false);
        }}
      />
      <NewFolderDialog
        open={creating}
        spaceId={spaceId}
        parentId={folderId ?? null}
        onClose={() => {
          setCreating(false);
        }}
      />
      <RenameDialog
        node={renaming}
        onClose={() => {
          setRenaming(null);
        }}
      />
      <VersionsDialog
        node={versioning}
        writable={!archived}
        onClose={() => {
          setVersioning(null);
        }}
      />
      <MoveDialog
        nodes={moving}
        start={{
          space:
            spaceData === undefined
              ? null
              : { id: spaceData.id, name: spaceData.name, level: spaceData.level },
          trail: [
            ...ancestors.map((a) => ({
              id: a.id,
              name: a.name,
              level: spaceData?.level ?? "VIEW",
            })),
            ...(folder.data === undefined
              ? []
              : [
                  {
                    id: folder.data.node.id,
                    name: folder.data.node.name,
                    level: folder.data.node.level,
                  },
                ]),
          ],
        }}
        onPick={(target: MoveTarget) => {
          const nodes = moving ?? [];
          setMoving(null);
          setSelected(new Set());
          void mover.requestMove(nodes, target);
        }}
        onClose={() => {
          setMoving(null);
        }}
      />
      {mover.conflictDialog}
      <ConfirmDialog
        open={bulkTrashing}
        onOpenChange={setBulkTrashing}
        icon={Trash2}
        title={t.selection.confirmTrash.title(selectedNodes.length)}
        description={t.selection.confirmTrash.text}
        confirmLabel={t.selection.confirmTrash.action}
        pendingLabel={t.selection.confirmTrash.pending}
        tone="warning"
        onConfirm={trashSelected}
      />
      <ZipImportDialog
        node={zipNode}
        onClose={() => {
          setZipNode(null);
        }}
      />
      <ImportReportDialog report={folderImport.report} onClose={folderImport.closeReport} />
      <PreviewDialog
        node={previewing}
        onDownload={(node) => {
          void download(node);
        }}
        onClose={() => {
          setPreviewing(null);
        }}
      />
    </div>
  );
}

function Crumb({
  to,
  last = false,
  plain = false,
  children,
  onDropPayload,
}: {
  to: string;
  last?: boolean;
  /** Un nivel de la ruta que se ve pero no se puede abrir (sin acceso). */
  plain?: boolean;
  children: string;
  /** Soltar elementos sobre este nivel de la ruta los mueve acá. */
  onDropPayload?: (payload: string) => void;
}) {
  const [over, setOver] = useState(false);
  const drop =
    onDropPayload === undefined
      ? {}
      : {
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
            const payload = event.dataTransfer.getData(NODE_DRAG_TYPE);
            if (payload === "") return;
            event.preventDefault();
            onDropPayload(payload);
          },
        };
  return (
    <li
      {...drop}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md px-1",
        over && "bg-primary-soft ring-2 ring-primary",
      )}
    >
      {plain ? (
        <>
          <span className="truncate">{children}</span>
          <span aria-hidden="true">›</span>
        </>
      ) : last || to === "" ? (
        <span aria-current="page" className="truncate font-medium text-foreground">
          {children}
        </span>
      ) : (
        <>
          <Link
            to={to}
            className="truncate rounded-md hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {children}
          </Link>
          <span aria-hidden="true">›</span>
        </>
      )}
    </li>
  );
}

// ─── Lista y cuadrícula ──────────────────────────────────────────────────────────────────

interface RowProps {
  movable: boolean;
  writable: boolean;
  onOpen: (node: NodeView) => void;
  onDownload: (node: NodeView) => void;
  onPreview: (node: NodeView) => void;
  onRename: (node: NodeView) => void;
  onMove: (node: NodeView) => void;
  onVersions: (node: NodeView) => void;
  onShare: (node: NodeView) => void;
  onControl: (node: NodeView) => void;
  onQr: (node: NodeView) => void;
  onImportZip: (node: NodeView) => void;
  onTrash: (node: NodeView) => void;
  onDropOnFolder: (event: DragEvent, folderId: string | null) => void;
  selected: ReadonlySet<string>;
  onToggle: (node: NodeView, index: number, range: boolean) => void;
  onToggleAll: (all: boolean) => void;
  cutIds: ReadonlySet<string>;
  dropTarget: string | null;
  setDropTarget: (id: string | null) => void;
  onDownloadZip: (node: NodeView) => void;
  /** Lo que lleva el arrastre de este nodo: su id o toda la selección. */
  dragIds: (node: NodeView) => string;
}

/** Arrastrar (con permiso de edición) y soltar sobre carpetas, con la carpeta destino resaltada. */
function dragProps(node: NodeView, props: RowProps) {
  const canDrag = props.writable && canEdit(node.level);
  return {
    draggable: canDrag,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(NODE_DRAG_TYPE, props.dragIds(node));
      event.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      props.setDropTarget(null);
    },
    ...(node.type === "FOLDER" && props.writable && canEdit(node.level)
      ? {
          onDragOver: (event: DragEvent) => {
            if (!isNodeDrag(event)) return;
            event.preventDefault();
            props.setDropTarget(node.id);
          },
          onDragLeave: (event: DragEvent) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              props.setDropTarget(null);
            }
          },
          onDrop: (event: DragEvent) => {
            props.onDropOnFolder(event, node.id);
          },
        }
      : {}),
  };
}

function NodeMenu({ node, ...props }: RowProps & { node: NodeView }) {
  const t = texts.files.explorer;
  const membership = useMembership();
  const bian = useBian();
  const isFile = node.type === "FILE";
  const canPreview = isFile && previewKind(node.mimeType) !== null;
  const canRename = props.writable && canEdit(node.level);
  const canMove = props.writable && canEdit(node.level);
  const canTrash = props.movable && canManage(node.level);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          aria-label={t.actions(node.name)}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <MoreHorizontal strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      {/* El menú está en un portal pero React propaga sus clics a la fila: sin esto, elegir una
          opción también abría o descargaba el elemento. */}
      <DropdownMenuContent
        align="end"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {!isFile && (
          <DropdownMenuItem
            onSelect={() => {
              props.onOpen(node);
            }}
          >
            <FolderSearch aria-hidden="true" />
            {t.menu.open}
          </DropdownMenuItem>
        )}
        {canPreview && (
          <DropdownMenuItem
            onSelect={() => {
              props.onPreview(node);
            }}
          >
            <Eye aria-hidden="true" />
            {t.menu.preview}
          </DropdownMenuItem>
        )}
        {node.type === "FOLDER" && (
          <DropdownMenuItem
            onSelect={() => {
              props.onDownloadZip(node);
            }}
          >
            <Download aria-hidden="true" />
            {t.menu.downloadZip}
          </DropdownMenuItem>
        )}
        {isFile && (
          <DropdownMenuItem
            onSelect={() => {
              props.onDownload(node);
            }}
          >
            <Download aria-hidden="true" />
            {t.menu.download}
          </DropdownMenuItem>
        )}
        {canRename && (
          <DropdownMenuItem
            onSelect={() => {
              props.onRename(node);
            }}
          >
            <Pencil aria-hidden="true" />
            {t.menu.rename}
          </DropdownMenuItem>
        )}
        {canMove && (
          <DropdownMenuItem
            onSelect={() => {
              props.onMove(node);
            }}
          >
            <Move aria-hidden="true" />
            {t.menu.move}
          </DropdownMenuItem>
        )}
        {isFile && (
          <DropdownMenuItem
            onSelect={() => {
              bian.open({ kind: "summarize", nodeId: node.id, name: node.name });
            }}
          >
            <Sparkles aria-hidden="true" />
            {texts.bian.summarize}
          </DropdownMenuItem>
        )}
        {isFile && node.currentVersion > 1 && (
          <DropdownMenuItem
            onSelect={() => {
              bian.open({ kind: "changes", nodeId: node.id, name: node.name });
            }}
          >
            <Sparkles aria-hidden="true" />
            {texts.bian.changes}
          </DropdownMenuItem>
        )}
        {node.type !== "FOLDER" && canManage(node.level) && (
          <DropdownMenuItem
            onSelect={() => {
              props.onControl(node);
            }}
          >
            <ClipboardCheck aria-hidden="true" />
            {texts.documents.menu}
          </DropdownMenuItem>
        )}
        {node.type !== "FOLDER" && canEdit(node.level) && (
          <DropdownMenuItem
            onSelect={() => {
              props.onQr(node);
            }}
          >
            <QrCode aria-hidden="true" />
            {texts.qr.menu}
          </DropdownMenuItem>
        )}
        {canManage(node.level) && (
          <DropdownMenuItem
            onSelect={() => {
              props.onShare(node);
            }}
          >
            <Users aria-hidden="true" />
            {t.menu.share}
          </DropdownMenuItem>
        )}
        {isFile && (
          <DropdownMenuItem
            onSelect={() => {
              props.onVersions(node);
            }}
          >
            <History aria-hidden="true" />
            {t.menu.versions}
          </DropdownMenuItem>
        )}
        {isFile && props.writable && node.mimeType === "application/zip" && (
          <DropdownMenuItem
            onSelect={() => {
              props.onImportZip(node);
            }}
          >
            <FileArchive aria-hidden="true" />
            {t.menu.importZip}
          </DropdownMenuItem>
        )}
        {canTrash && (
          <DropdownMenuItem
            className="text-danger"
            onSelect={() => {
              props.onTrash(node);
            }}
          >
            <Trash2 aria-hidden="true" />
            {t.menu.trash}
          </DropdownMenuItem>
        )}
        <PluginNodeMenuItems
          kind="explorerActions"
          ctx={{
            slug: membership.workspace.slug,
            person: membership,
            node: {
              id: node.id,
              spaceId: node.spaceId,
              type: node.type,
              name: node.name,
              mimeType: node.mimeType,
              level: node.level,
            },
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ROW_COLUMNS = "md:grid-cols-[1.25rem_minmax(0,1fr)_11rem_9.5rem_5.5rem_2.5rem]";
const ROW_HEIGHT = 56;

function ListView({
  items,
  scrollRef,
  ...props
}: RowProps & { items: NodeView[]; scrollRef: RefObject<HTMLDivElement | null> }) {
  const t = texts.files.explorer;
  // Con muchas filas solo se dibujan las visibles (todas miden lo mismo).
  const virtualize = items.length > LIST_VIRTUALIZE_AFTER;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: virtualize,
  });
  const virtualItems = virtualize ? virtualizer.getVirtualItems() : [];
  const rows = virtualize
    ? virtualItems.flatMap((virtual) => {
        const node = items[virtual.index];
        return node === undefined ? [] : [{ node, index: virtual.index }];
      })
    : items.map((node, index) => ({ node, index }));
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom = virtualize
    ? virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0)
    : 0;
  const allSelected = items.length > 0 && items.every((node) => props.selected.has(node.id));
  const someSelected = !allSelected && items.some((node) => props.selected.has(node.id));
  return (
    <div role="table" aria-label={texts.files.nav} aria-rowcount={items.length}>
      <div
        role="row"
        className={cn(
          "sticky top-0 z-10 hidden items-center gap-x-4 border-b border-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid",
          ROW_COLUMNS,
        )}
      >
        <Checkbox
          aria-label={t.selection.selectAll}
          checked={allSelected}
          ref={(box) => {
            if (box !== null) box.indeterminate = someSelected;
          }}
          onChange={(event) => {
            props.onToggleAll(event.target.checked);
          }}
        />
        <span role="columnheader">{t.columns.name}</span>
        <span role="columnheader">{t.columns.updatedBy}</span>
        <span role="columnheader">{t.columns.updated}</span>
        <span role="columnheader" className="text-right">
          {t.columns.size}
        </span>
        <span />
      </div>
      <div style={virtualize ? { paddingTop, paddingBottom } : undefined}>
        {rows.map(({ node, index }) => {
          const isSelected = props.selected.has(node.id);
          return (
            <div
              key={node.id}
              role="row"
              aria-selected={isSelected}
              {...dragProps(node, props)}
              onClick={() => {
                props.onOpen(node);
              }}
              className={cn(
                "grid h-14 cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_2.5rem] items-center gap-x-4 border-b border-border px-4 transition-colors hover:bg-muted/60",
                ROW_COLUMNS,
                isSelected && "bg-primary-soft/50 hover:bg-primary-soft/60",
                props.cutIds.has(node.id) && "opacity-50",
                props.dropTarget === node.id && "bg-primary-soft ring-2 ring-inset ring-primary",
              )}
            >
              <Checkbox
                aria-label={t.selection.selectOne(node.name)}
                checked={isSelected}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggle(node, index, event.shiftKey);
                }}
                onChange={() => undefined}
              />
              <div role="cell" className="flex min-w-0 items-center gap-3">
                <NodeIcon node={node} />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      className="block min-w-0 truncate text-left text-sm font-medium focus-visible:outline-none focus-visible:underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onOpen(node);
                      }}
                    >
                      {node.name}
                    </button>
                    <SharedMark sharing={node.sharing} />
                    {node.type === "FILE" && node.currentVersion > 1 && (
                      <Tooltip content={t.versionTip(node.currentVersion)}>
                        <button
                          type="button"
                          aria-label={t.versionTip(node.currentVersion)}
                          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-primary-soft px-2 text-xs font-medium leading-5 text-primary-soft-foreground ring-1 ring-inset ring-primary/20 transition-colors hover:bg-primary/15 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onVersions(node);
                          }}
                        >
                          <History className="size-3" strokeWidth={2} aria-hidden="true" />
                          {`v${String(node.currentVersion)}`}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                  {node.type === "FOLDER" &&
                    node.childCount !== undefined &&
                    node.childCount !== null && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {t.items(node.childCount)}
                      </span>
                    )}
                </div>
              </div>
              <span role="cell" className="hidden min-w-0 items-center gap-2 md:flex">
                {node.updatedBy !== undefined && node.updatedBy !== null && (
                  <>
                    <Avatar
                      name={node.updatedBy.name}
                      src={node.updatedBy.avatarUrl}
                      className="size-6 text-[10px]"
                    />
                    <span className="truncate text-xs text-muted-foreground">
                      {node.updatedVia === undefined || node.updatedVia === null
                        ? node.updatedBy.name
                        : t.via(node.updatedBy.name, node.updatedVia)}
                    </span>
                  </>
                )}
              </span>
              <span role="cell" className="hidden text-xs text-muted-foreground md:block">
                {formatDateTime(node.updatedAt)}
              </span>
              <span
                role="cell"
                className="hidden text-right text-xs text-muted-foreground md:block"
              >
                {node.type === "PAGE"
                  ? texts.files.explorer.pageLabel
                  : node.type === "FOLDER"
                    ? node.totalBytes === undefined
                      ? ""
                      : node.totalBytes === null
                        ? "—"
                        : formatBytes(node.totalBytes)
                    : node.sizeBytes === null
                      ? ""
                      : formatBytes(node.sizeBytes)}
              </span>
              <div role="cell" className="justify-self-end">
                <NodeMenu node={node} {...props} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GridView({ items, ...props }: RowProps & { items: NodeView[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-4">
      {items.map((node) => (
        <li
          key={node.id}
          {...dragProps(node, props)}
          onClick={() => {
            props.onOpen(node);
          }}
          className={cn(
            "relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-border p-4 text-center transition-colors hover:border-primary/40 hover:bg-muted/40",
            props.cutIds.has(node.id) && "opacity-50",
            props.dropTarget === node.id && "border-primary bg-primary-soft ring-2 ring-primary",
          )}
        >
          <div className="absolute right-1 top-1">
            <NodeMenu node={node} {...props} />
          </div>
          <NodeIcon node={node} className="mt-3 size-12" />
          <button
            type="button"
            className="w-full truncate text-sm font-medium focus-visible:outline-none focus-visible:underline"
            onClick={(event) => {
              event.stopPropagation();
              props.onOpen(node);
            }}
          >
            {node.name}
          </button>
          <SharedMark sharing={node.sharing} />
          <p className="text-xs text-muted-foreground">
            {node.sizeBytes === null ? formatDateTime(node.updatedAt) : formatBytes(node.sizeBytes)}
          </p>
        </li>
      ))}
    </ul>
  );
}
