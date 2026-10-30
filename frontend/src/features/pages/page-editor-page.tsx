// /app/:slug/files/:spaceId/p/:pageId — una página con el editor por bloques (Tiptap 3). El texto se
// guarda solo (con control de conflictos); el título es el nombre del nodo; las subpáginas cuelgan
// de la página. Lo que se puede hacer lo decide el servidor (nivel de acceso): acá solo se oculta.
import { contentExtensions } from "@spiderfolio/content";
import { EditorContent, useEditor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CloudOff,
  FilePlus2,
  ClipboardCheck,
  Sparkles,
  QrCode,
  Copy,
  FileText,
  MessageSquareText,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Printer,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useCitationHighlight } from "./cite-highlight";
import { toast } from "sonner";
import { Badge, Banner, Card, Skeleton } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { useAuth } from "@/auth/auth-context";
import { adminErrorText } from "@/features/admin/admin-utils";
import { NotFoundPage } from "@/features/home/not-found-page";
import { cn, timeAgo } from "@/lib/utils";
import { canEdit, commentsApi, filesApi, filesKeys, pagesApi, type PageDetail } from "../files/api";
import { NodeIcon } from "../files/file-utils";
import { useBian } from "../bian/bian-context";
import { CommentsPanel, commentsKey, type AnchorDraft } from "./comments-panel";
import { FolderTree } from "../files/folder-tree";
import { ContextBar, SelectionToolbar } from "./format-toolbar";
import { NewPageDialog } from "./new-page-dialog";
import { BlockHandles } from "./block-handles";
import { PageImageView } from "./image-view";
import { PageIdentity } from "./page-chrome";
import {
  EmbedFileDialog,
  FileEmbedView,
  nodeLinksApi,
  PageLinkView,
  ToggleView,
} from "./page-nodes";
import { MIN_TOC_HEADINGS, PageToc, useHeadings } from "./page-toc";
import { ControlDialog, StatusBadge } from "@/features/documents/control-dialog";
import { QrDialog } from "@/features/qr/qr-dialog";
import { ShareDialog } from "@/features/sharing/share-dialog";
import { createMentionExtension, useAccessNotice } from "./mentions";
import {
  createSlashExtension,
  createSuggestionExtension,
  SlashMenu,
  type SlashItem,
  type SlashState,
} from "./slash-menu";
import { IMAGE_TYPES, ImageRejected, isPageImage, uploadPageImage } from "./upload-image";
import { useAutosave, type SaveState } from "./use-autosave";
import { useMembership } from "@/features/home/workspace-layout";
import { PluginNodeMenuItems } from "@/plugins/plugin-actions";
import { texts } from "@/i18n";

/** Nodos del schema que el editor reemplaza por la misma versión con su vista de React. */
const REPLACED_NODES = ["pageImage", "pageLink", "fileEmbed", "toggle"];

export function PageEditorPage() {
  const { workspaceSlug = "", pageId = "" } = useParams();
  const query = useQuery({
    queryKey: ["w", workspaceSlug, "pages", pageId],
    queryFn: () => pagesApi.get(workspaceSlug, pageId),
    // Solo sirve para arrancar el editor: después manda lo que se escribe, no una consulta.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  if (query.isError) return <NotFoundPage />;
  if (query.isPending) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return <PageEditor key={pageId} page={query.data.page} />;
}

function SaveIndicator({ state, message }: { state: SaveState; message: string | null }) {
  const t = texts.pages.status;
  const view = {
    saved: { icon: Check, text: t.saved, tone: "text-muted-foreground" },
    dirty: { icon: Loader2, text: t.dirty, tone: "text-muted-foreground" },
    saving: { icon: Loader2, text: t.saving, tone: "text-muted-foreground" },
    offline: { icon: CloudOff, text: t.offline, tone: "text-warning-soft-foreground" },
    conflict: { icon: TriangleAlert, text: t.conflict, tone: "text-danger" },
    error: { icon: TriangleAlert, text: message ?? t.error, tone: "text-danger" },
  }[state];
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-1.5 text-xs", view.tone)}
    >
      <view.icon
        className={cn("size-3.5", (state === "saving" || state === "dirty") && "animate-spin")}
        strokeWidth={2}
        aria-hidden="true"
      />
      {view.text}
    </p>
  );
}

function PageEditor({ page }: { page: PageDetail }) {
  const t = texts.pages;
  const bian = useBian();
  const membership = useMembership();
  const { workspaceSlug = "", spaceId = "" } = useParams();
  const queryClient = useQueryClient();
  const writable = canEdit(page.node.level) && !page.space.archived;
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [mention, setMention] = useState<SlashState | null>(null);
  const [linkMenu, setLinkMenu] = useState<SlashState | null>(null);
  const [embedding, setEmbedding] = useState(false);
  const { account } = useAuth();
  const [sharing, setSharing] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [qr, setQr] = useState(false);
  const accessNotice = useAccessNotice({
    pageId: page.node.id,
    spaceId,
    pageName: page.node.name,
    canManage: page.node.level === "MANAGE" && !page.space.archived,
  });
  // «Sin título» (el nombre que se pone solo) se muestra como el texto de ejemplo en gris.
  const isDefaultName = /^Sin título( \(\d+\))?$/u.test(page.node.name);
  const [title, setTitle] = useState(isDefaultName ? "" : page.node.name);
  const navigate = useNavigate();
  // El árbol abre las carpetas del camino y las subpáginas de la página actual.
  const expandedIds = useMemo(
    () => new Set([...page.ancestors.map((ancestor) => ancestor.id), page.node.id]),
    [page.ancestors, page.node.id],
  );
  const [choosingTemplate, setChoosingTemplate] = useState(false);
  // Quien solo puede comentar (COMMENT) no escribe el texto, pero sí agrega comentarios anclados.
  const commentable =
    !page.space.archived && (page.node.level !== "VIEW" || page.controlled?.reviewer === true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<AnchorDraft | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const openThread = useRef<(id: string) => void>(() => undefined);

  const imageInput = useRef<HTMLInputElement>(null);
  const editorBox = useRef<HTMLDivElement>(null);
  // Sube las imágenes (pegadas, arrastradas o elegidas) y las inserta donde está el cursor.
  const insertImages = useRef<(files: File[]) => void>(() => undefined);

  const extensions = useMemo(
    () => [
      // La imagen del schema se reemplaza por la misma con su vista de React.
      ...contentExtensions.filter((extension) => !REPLACED_NODES.includes(extension.name)),
      PageImageView.configure({ slug: workspaceSlug, pageId: page.node.id }),
      PageLinkView.configure({ slug: workspaceSlug }),
      FileEmbedView.configure({ slug: workspaceSlug }),
      ToggleView,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? t.headingPlaceholder
            : node.type.name === "toggleSummary"
              ? t.toggle.summaryPlaceholder
              : t.placeholder,
      }),
      // «[[» busca páginas y archivos del workspace que la persona ve.
      createSuggestionExtension({
        name: "pageLinkSuggestion",
        char: "[[",
        allowSpaces: true,
        bridge: { set: setLinkMenu },
        getItems: async (query) => {
          const result = await nodeLinksApi.search(workspaceSlug, "link", query.trim());
          return result.items.map((item): SlashItem => ({
            id: item.id,
            title: item.name,
            description: item.spaceName,
            keywords: "",
            icon: FileText,
            run: (current, range) => {
              current
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent([
                  { type: "pageLink", attrs: { nodeId: item.id } },
                  { type: "text", text: " " },
                ])
                .run();
            },
          }));
        },
      }),
      createMentionExtension({ set: setMention }, async (query) => {
        const result = await pagesApi.mentionCandidates(workspaceSlug, page.node.id, query);
        return result.items;
      }),
      createSlashExtension({ set: setSlash }, [
        {
          id: "image",
          ...t.slash.image,
          icon: ImageIcon,
          run: (current, range) => {
            current.chain().focus().deleteRange(range).run();
            imageInput.current?.click();
          },
        },
        {
          id: "file",
          ...t.slash.file,
          icon: FileText,
          run: (current, range) => {
            current.chain().focus().deleteRange(range).run();
            setEmbedding(true);
          },
        },
      ]),
    ],
    // El editor se arma una sola vez por página.
    [t.headingPlaceholder, t.placeholder, t.slash.image, workspaceSlug, page.node.id],
  );
  const editor = useEditor({
    extensions,
    content: page.content as Record<string, unknown>,
    editable: writable,
    editorProps: {
      attributes: {
        class: "prose max-w-none focus:outline-none",
        "aria-label": t.contentLabel,
      },
      handleClick: (view, pos) => {
        const mark = view.state.doc
          .resolve(pos)
          .marks()
          .find((candidate) => candidate.type.name === "commentThread");
        const id: unknown = mark?.attrs.threadId;
        if (typeof id === "string") openThread.current(id);
        return false;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter(isPageImage);
        if (files.length === 0) return false;
        event.preventDefault();
        insertImages.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter(isPageImage);
        if (files.length === 0) return false;
        event.preventDefault();
        insertImages.current(files);
        return true;
      },
    },
  });
  useCitationHighlight(editorBox);
  openThread.current = (id) => {
    setPanelOpen(true);
    setActiveThread(id);
  };
  insertImages.current = (files) => {
    if (!writable) return;
    void (async () => {
      for (const file of files) {
        const progress = toast.loading(t.image.uploading);
        try {
          const imageId = await uploadPageImage(workspaceSlug, page.node.id, file);
          editor.chain().focus().insertContent({ type: "pageImage", attrs: { imageId } }).run();
        } catch (error) {
          toast.error(error instanceof ImageRejected ? error.message : adminErrorText(error));
        } finally {
          toast.dismiss(progress);
        }
      }
    })();
  };
  // Cuántos hilos abiertos hay (insignia) y cuáles están resueltos (su resaltado se apaga).
  const openCount = useQuery({
    queryKey: [...commentsKey(workspaceSlug, page.node.id), "open-count"],
    queryFn: () => commentsApi.list(workspaceSlug, page.node.id, { status: "open", pageSize: 1 }),
  });
  const resolved = useQuery({
    queryKey: [...commentsKey(workspaceSlug, page.node.id), "resolved-ids"],
    queryFn: () =>
      commentsApi.list(workspaceSlug, page.node.id, { status: "resolved", pageSize: 100 }),
  });
  const resolvedStyle = (resolved.data?.items ?? [])
    .map((thread) => `.page-editor span[data-thread-id="${thread.id}"]`)
    .join(",")
    .concat(
      " { background: transparent !important; border-bottom-color: transparent !important; }",
    );
  // Ctrl+S (⌘S) guarda ya, sin esperar al autoguardado.
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flushRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const autosave = useAutosave({
    slug: workspaceSlug,
    pageId: page.node.id,
    editor,
    initialRevision: page.revision,
    onWithoutAccess: accessNotice.notify,
  });
  flushRef.current = autosave.flush;

  const rename = useMutation({
    mutationFn: (name: string) => filesApi.updateNode(workspaceSlug, page.node.id, { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      setTitle(isDefaultName ? "" : page.node.name);
      toast.error(adminErrorText(error));
    },
  });
  const duplicate = useMutation({
    mutationFn: () => nodeLinksApi.duplicatePage(workspaceSlug, page.node.id),
    onSuccess: async ({ page: copy }) => {
      toast.success(t.menu.duplicated);
      await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
      void navigate(`/app/${workspaceSlug}/files/${spaceId}/p/${copy.node.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const headings = useHeadings(editor);
  const showToc = !panelOpen && headings.length >= MIN_TOC_HEADINGS;
  // «Última edición»: lo que vino con la página, y desde que se guarda algo, quien lo guardó.
  const [lastEdit, setLastEdit] = useState<{ name: string | null; via: string | null; at: string }>(
    { name: page.updatedBy?.name ?? null, via: page.updatedVia, at: page.updatedAt },
  );
  const [now, setNow] = useState(() => new Date());
  const savedBefore = useRef<SaveState>(autosave.state);
  useEffect(() => {
    if (savedBefore.current === "saving" && autosave.state === "saved") {
      setLastEdit({ name: account?.user.name ?? null, via: null, at: new Date().toISOString() });
    }
    savedBefore.current = autosave.state;
  }, [autosave.state, account]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const commitTitle = () => {
    const next = title.trim();
    if (next === "" || next === page.node.name) {
      setTitle(isDefaultName ? "" : page.node.name);
      return;
    }
    rename.mutate(next);
  };

  // Llegó por un acceso compartido: la ruta muestra lo de arriba, pero solo se entra a lo que ve.
  const shared = page.shareRoot !== null;
  const crumbs: { to: string; label: string; plain?: boolean }[] = [
    shared
      ? { to: `/app/${workspaceSlug}/files/shared`, label: texts.files.shared.title }
      : { to: `/app/${workspaceSlug}/files`, label: texts.files.nav },
    {
      to: `/app/${workspaceSlug}/files/${spaceId}`,
      label: page.space.name,
      plain: shared,
    },
    ...page.ancestors.map((ancestor) => ({
      plain: !ancestor.accessible,
      to:
        ancestor.type === "PAGE"
          ? `/app/${workspaceSlug}/files/${spaceId}/p/${ancestor.id}`
          : `/app/${workspaceSlug}/files/${spaceId}/f/${ancestor.id}`,
      label: ancestor.name,
    })),
  ];

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)] lg:items-start">
      <Card className="hidden min-w-0 overflow-hidden lg:sticky lg:top-20 lg:block print:hidden">
        <FolderTree
          spaceId={spaceId}
          spaceName={page.space.name}
          {...(page.shareRoot === null ? {} : { rootNode: page.shareRoot })}
          selectedId={page.node.id}
          expandedIds={expandedIds}
          canDrop={false}
          onSelect={(node) => {
            void navigate(
              node === null
                ? `/app/${workspaceSlug}/files/${spaceId}`
                : node.type === "PAGE"
                  ? `/app/${workspaceSlug}/files/${spaceId}/p/${node.id}`
                  : `/app/${workspaceSlug}/files/${spaceId}/f/${node.id}`,
            );
          }}
          onDropNode={() => undefined}
        />
      </Card>
      <div className="grid min-w-0 gap-4">
        <style>{resolvedStyle}</style>
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <nav aria-label={texts.files.explorer.breadcrumb}>
            <ol className="m-0 flex list-none flex-wrap items-center gap-x-1 p-0 text-sm text-muted-foreground">
              {crumbs.map((crumb) => (
                <li key={crumb.to} className="flex items-center gap-1">
                  {crumb.plain === true ? (
                    <span className="truncate">{crumb.label}</span>
                  ) : (
                    <Link
                      to={crumb.to}
                      className="truncate rounded-md hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      {crumb.label}
                    </Link>
                  )}
                  <span aria-hidden="true">›</span>
                </li>
              ))}
              <li aria-current="page" className="truncate font-medium text-foreground">
                {page.node.name}
              </li>
            </ol>
          </nav>
          <div className="flex items-center gap-3">
            {page.controlled !== null && (
              <span className="flex items-center gap-1.5">
                <Badge tone="solid">{page.controlled.code}</Badge>
                <StatusBadge status={page.controlled.status} />
              </span>
            )}
            {commentable && <SaveIndicator state={autosave.state} message={autosave.message} />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label={t.menu.label}>
                  <MoreHorizontal strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!page.space.archived && canEdit(page.node.level) && (
                  <DropdownMenuItem
                    disabled={duplicate.isPending}
                    onSelect={() => {
                      duplicate.mutate();
                    }}
                  >
                    <Copy aria-hidden="true" />
                    {t.menu.duplicate}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => {
                    setControlling(true);
                  }}
                >
                  <ClipboardCheck aria-hidden="true" />
                  {texts.documents.menu}
                </DropdownMenuItem>
                {canEdit(page.node.level) && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setQr(true);
                    }}
                  >
                    <QrCode aria-hidden="true" />
                    {texts.qr.menu}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => {
                    bian.open({ kind: "summarize", nodeId: page.node.id, name: page.node.name });
                  }}
                >
                  <Sparkles aria-hidden="true" />
                  {texts.bian.summarize}
                </DropdownMenuItem>
                {page.controlled !== null && (
                  <DropdownMenuItem
                    onSelect={() => {
                      bian.open({ kind: "changes", nodeId: page.node.id, name: page.node.name });
                    }}
                  >
                    <Sparkles aria-hidden="true" />
                    {texts.bian.changes}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => {
                    window.print();
                  }}
                >
                  <Printer aria-hidden="true" />
                  {t.menu.print}
                </DropdownMenuItem>
                <PluginNodeMenuItems
                  kind="documentActions"
                  ctx={{
                    slug: workspaceSlug,
                    person: membership,
                    node: {
                      id: page.node.id,
                      spaceId,
                      type: "PAGE",
                      name: page.node.name,
                      mimeType: null,
                      level: page.node.level,
                    },
                  }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            {page.node.level === "MANAGE" && !page.space.archived && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSharing(true);
                }}
              >
                <Users strokeWidth={1.75} aria-hidden="true" />
                {texts.sharing.open}
              </Button>
            )}
            <Button
              size="sm"
              variant={panelOpen ? "primary" : "outline"}
              aria-pressed={panelOpen}
              aria-expanded={panelOpen}
              onClick={() => {
                setPanelOpen((open) => !open);
              }}
            >
              <MessageSquareText strokeWidth={1.75} aria-hidden="true" />
              {t.comments.title}
              {(openCount.data?.total ?? 0) > 0 && (
                <Badge tone="primary" className="ml-1">
                  {openCount.data?.total}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 print:hidden">
          {page.space.archived && (
            <Banner tone="warning">{texts.files.explorer.archivedNotice}</Banner>
          )}
          {!page.space.archived && !writable && <Banner tone="info">{t.readOnly}</Banner>}
          {page.controlled?.showing === "published" &&
            page.controlled.publishedVersion !== null && (
              <Banner tone="info">
                {texts.documents.banner.published(
                  page.controlled.code,
                  page.controlled.publishedVersion,
                )}
              </Banner>
            )}
          {autosave.state === "conflict" && (
            <Banner tone="warning">
              <div className="grid gap-2">
                <p className="font-medium">{t.conflictTitle}</p>
                <p className="text-sm">{t.conflictText}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void autosave.reloadLatest().catch((error: unknown) => {
                        toast.error(adminErrorText(error));
                      });
                    }}
                  >
                    {t.conflictReload}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(editor.getText()).then(
                        () => {
                          toast.success(t.copied);
                        },
                        () => {
                          toast.error(t.copyFailed);
                        },
                      );
                    }}
                  >
                    {t.conflictCopy}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      void autosave.overwrite().catch((error: unknown) => {
                        toast.error(adminErrorText(error));
                      });
                    }}
                  >
                    {t.conflictOverwrite}
                  </Button>
                </div>
              </div>
            </Banner>
          )}
        </div>
        <div
          className={cn(
            "grid gap-4",
            panelOpen && "lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start",
            showToc && "xl:grid-cols-[minmax(0,1fr)_220px] xl:items-start",
          )}
        >
          <div className="mx-auto grid w-full min-w-0 max-w-[720px] gap-4">
            <div className="page-editor pt-4 sm:pt-14">
              <PageIdentity
                slug={workspaceSlug}
                nodeId={page.node.id}
                icon={page.node.icon}
                cover={page.node.cover}
                canEdit={writable}
              >
                <input
                  value={title}
                  readOnly={!writable}
                  maxLength={255}
                  aria-label={t.titleLabel}
                  placeholder={t.untitled}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitTitle();
                      editor.commands.focus("start");
                    }
                  }}
                  className="mb-3 w-full bg-transparent text-[2.5rem] font-bold leading-tight tracking-tight outline-none placeholder:text-muted-foreground/60"
                />
              </PageIdentity>
              {writable && <ContextBar editor={editor} />}
              <div ref={editorBox} className="relative md:-mx-20 md:px-20">
                <EditorContent editor={editor} />
                <BlockHandles editor={editor} containerRef={editorBox} />
              </div>
              {(writable || commentable) && (
                <SelectionToolbar
                  editor={editor}
                  canFormat={writable}
                  {...(commentable
                    ? {
                        onComment: (anchor: AnchorDraft) => {
                          setDraft(anchor);
                          setPanelOpen(true);
                        },
                      }
                    : {})}
                />
              )}
              <SlashMenu state={slash} />
              <SlashMenu state={mention} />
              <SlashMenu state={linkMenu} />
              <EmbedFileDialog
                open={embedding}
                slug={workspaceSlug}
                onClose={() => {
                  setEmbedding(false);
                }}
                onPick={(file) => {
                  setEmbedding(false);
                  editor
                    .chain()
                    .focus()
                    .insertContent({ type: "fileEmbed", attrs: { nodeId: file.id } })
                    .run();
                }}
              />
              {accessNotice.dialog}
              <ControlDialog
                target={controlling ? { id: page.node.id, name: page.node.name } : null}
                onClose={() => {
                  setControlling(false);
                }}
              />
              <QrDialog
                target={qr ? { id: page.node.id, name: page.node.name } : null}
                onClose={() => {
                  setQr(false);
                }}
              />
              <ShareDialog
                subject={
                  sharing ? { type: "node", id: page.node.id, name: page.node.name, spaceId } : null
                }
                onClose={() => {
                  setSharing(false);
                }}
              />
              <input
                ref={imageInput}
                type="file"
                accept={IMAGE_TYPES.join(",")}
                hidden
                aria-hidden="true"
                tabIndex={-1}
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = "";
                  insertImages.current(files);
                }}
              />
            </div>

            <p className="px-1 text-xs text-muted-foreground print:hidden">
              {lastEdit.name === null
                ? t.footer.lastEditUnknown(timeAgo(lastEdit.at, now))
                : lastEdit.via === null
                  ? t.footer.lastEdit(lastEdit.name, timeAgo(lastEdit.at, now))
                  : t.footer.lastEditVia(lastEdit.name, lastEdit.via, timeAgo(lastEdit.at, now))}
            </p>

            <div className="print:hidden">
              <Subpages
                page={page}
                writable={writable}
                onCreate={() => {
                  setChoosingTemplate(true);
                }}
              />
            </div>
            <NewPageDialog
              open={choosingTemplate}
              spaceId={spaceId}
              parentId={page.node.id}
              onClose={() => {
                setChoosingTemplate(false);
              }}
            />
          </div>
          {showToc && <PageToc editor={editor} entries={headings} />}
          {panelOpen && (
            <div className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto print:hidden">
              <CommentsPanel
                slug={workspaceSlug}
                pageId={page.node.id}
                editor={editor}
                canComment={commentable}
                draft={draft}
                onDraftDone={() => {
                  setDraft(null);
                }}
                activeThreadId={activeThread}
                onWithoutAccess={accessNotice.notify}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Páginas y carpetas que cuelgan de esta página. */
function Subpages({
  page,
  writable,
  onCreate,
}: {
  page: PageDetail;
  writable: boolean;
  onCreate: () => void;
}) {
  const t = texts.pages.subpages;
  const { workspaceSlug = "", spaceId = "" } = useParams();
  const children = useQuery({
    queryKey: [...filesKeys.nodes(workspaceSlug, spaceId), "children", page.node.id],
    queryFn: () =>
      filesApi.nodes(workspaceSlug, spaceId, {
        parent: page.node.id,
        type: "CONTAINER",
        sort: "name",
        dir: "asc",
      }),
  });
  const items = children.data?.items ?? [];
  if (items.length === 0 && !writable) return null;
  return (
    <section aria-label={t.title} className="grid gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t.title}</h2>
        {writable && (
          <Button size="sm" variant="outline" onClick={onCreate}>
            <FilePlus2 strokeWidth={1.75} aria-hidden="true" />
            {t.create}
          </Button>
        )}
      </div>
      {items.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0">
          {items.map((child) => (
            <li key={child.id}>
              <Link
                to={
                  child.type === "PAGE"
                    ? `/app/${workspaceSlug}/files/${spaceId}/p/${child.id}`
                    : `/app/${workspaceSlug}/files/${spaceId}/f/${child.id}`
                }
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <NodeIcon node={child} />
                <span className="truncate">{child.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
