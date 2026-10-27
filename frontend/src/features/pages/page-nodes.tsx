// Nodos del editor que dependen del resto del workspace: enlaces internos («[[»), archivos
// incrustados y desplegables. El documento guarda solo ids; los nombres y archivos se piden al
// mostrarlos, con los permisos de quien lee: sin acceso se ve «Documento sin acceso».
import { FileEmbed, PageLink, Toggle } from "@spiderfolio/content";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText, Lock, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { filesApi, type NodeType } from "@/features/files/api";
import { NodeIcon } from "@/features/files/file-utils";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { texts } from "@/i18n";

// ─── Servidor ────────────────────────────────────────────────────────────────────────────

export interface NodeRef {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  spaceName: string;
  parentId: string | null;
  mimeType: string | null;
}

export type ResolvedNode = { id: string; accessible: false } | (NodeRef & { accessible: true });

interface SearchPage {
  items: NodeRef[];
  nextCursor: string | null;
}

export const nodeLinksApi = {
  search: (
    slug: string,
    kind: "link" | "embed",
    q: string,
    cursor?: string,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ kind, q, pageSize: "20" });
    if (cursor !== undefined) params.set("cursor", cursor);
    return api<SearchPage>(`/w/${slug}/search/nodes?${params.toString()}`, {
      ...(signal === undefined ? {} : { signal }),
    });
  },
  resolve: (slug: string, ids: string[]) =>
    api<{ items: ResolvedNode[] }>(`/w/${slug}/nodes/resolve`, {
      method: "POST",
      body: { ids },
    }),
  duplicatePage: (slug: string, pageId: string) =>
    api<{ page: { node: { id: string; spaceId: string } } }>(
      `/w/${slug}/pages/${pageId}/duplicate`,
      {
        method: "POST",
      },
    ),
};

interface Waiter {
  resolve: (node: ResolvedNode) => void;
  reject: (error: unknown) => void;
}

const batches = new Map<string, Map<string, Waiter[]>>();

async function flushBatch(slug: string): Promise<void> {
  const batch = batches.get(slug);
  batches.delete(slug);
  if (batch === undefined) return;
  const ids = [...batch.keys()];
  try {
    for (let start = 0; start < ids.length; start += 50) {
      const chunk = ids.slice(start, start + 50);
      const { items } = await nodeLinksApi.resolve(slug, chunk);
      const byId = new Map(items.map((item) => [item.id, item]));
      for (const id of chunk) {
        const node = byId.get(id) ?? { id, accessible: false as const };
        for (const waiter of batch.get(id) ?? []) waiter.resolve(node);
      }
    }
  } catch (error) {
    for (const waiters of batch.values()) for (const waiter of waiters) waiter.reject(error);
  }
}

/** Pide un nodo; los pedidos de un mismo instante viajan juntos (una página puede tener muchos enlaces). */
function resolveNode(slug: string, id: string): Promise<ResolvedNode> {
  return new Promise((resolve, reject) => {
    let batch = batches.get(slug);
    if (batch === undefined) {
      batch = new Map();
      batches.set(slug, batch);
      setTimeout(() => {
        void flushBatch(slug);
      }, 15);
    }
    batch.set(id, [...(batch.get(id) ?? []), { resolve, reject }]);
  });
}

export function useNodeRef(slug: string, id: string) {
  return useQuery({
    queryKey: ["w", slug, "node-ref", id],
    queryFn: () => resolveNode(slug, id),
    enabled: id !== "",
    staleTime: 60_000,
    retry: 1,
  });
}

/** A dónde lleva un nodo: páginas y carpetas se abren; un archivo, su carpeta. */
export function hrefOfNode(slug: string, node: NodeRef): string {
  const base = `/app/${slug}/files/${node.spaceId}`;
  if (node.type === "PAGE") return `${base}/p/${node.id}`;
  if (node.type === "FOLDER") return `${base}/f/${node.id}`;
  return node.parentId === null ? base : `${base}/f/${node.parentId}`;
}

interface Options {
  slug: string;
}

const idOf = (node: NodeViewProps["node"]): string =>
  typeof node.attrs.nodeId === "string" ? node.attrs.nodeId : "";

// ─── Enlace interno ──────────────────────────────────────────────────────────────────────

function PageLinkChip({ node, extension }: NodeViewProps) {
  const t = texts.pages.links;
  const { slug } = extension.options as Options;
  const ref = useNodeRef(slug, idOf(node));
  return (
    <NodeViewWrapper as="span" className="page-link" contentEditable={false}>
      {ref.isPending ? (
        <span className="text-muted-foreground">…</span>
      ) : ref.isError || !ref.data.accessible ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Lock className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          {t.noAccess}
        </span>
      ) : (
        <Link
          to={hrefOfNode(slug, ref.data)}
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
        >
          <NodeIcon node={ref.data} className="size-4" />
          {ref.data.name}
        </Link>
      )}
    </NodeViewWrapper>
  );
}

export const PageLinkView = PageLink.extend({
  addOptions() {
    return { slug: "" };
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageLinkChip, { as: "span" });
  },
});

// ─── Archivo incrustado ──────────────────────────────────────────────────────────────────

function FileEmbedBlock({ node, extension, selected }: NodeViewProps) {
  const t = texts.pages.embed;
  const { slug } = extension.options as Options;
  const id = idOf(node);
  const ref = useNodeRef(slug, id);
  const file = ref.data?.accessible === true ? ref.data : null;
  const ticket = useQuery({
    queryKey: ["w", slug, "file-embed", id],
    queryFn: () => filesApi.download(slug, id, { inline: true }),
    enabled: file !== null,
    staleTime: 45_000,
    retry: 1,
  });
  return (
    <NodeViewWrapper className="my-4" data-drag-handle>
      {ref.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : file === null ? (
        <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          <Lock className="size-4" strokeWidth={1.75} aria-hidden="true" />
          {texts.pages.links.noAccess}
        </div>
      ) : (
        <figure
          className={cn(
            "m-0 overflow-hidden rounded-lg border border-border",
            selected && "ring-2 ring-primary",
          )}
        >
          {ticket.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : ticket.isError ? (
            <p className="p-4 text-sm text-muted-foreground">{t.unavailable}</p>
          ) : ticket.data.contentType.startsWith("image/") ? (
            <img
              src={ticket.data.url}
              alt={file.name}
              className="mx-auto max-h-[560px] max-w-full"
            />
          ) : (
            <iframe
              src={ticket.data.url}
              title={file.name}
              className="block h-[560px] w-full bg-background"
            />
          )}
          <figcaption className="flex items-center gap-2 border-t border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
            <FileText className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            <Link to={hrefOfNode(slug, file)} className="truncate hover:underline">
              {file.name}
            </Link>
          </figcaption>
        </figure>
      )}
    </NodeViewWrapper>
  );
}

export const FileEmbedView = FileEmbed.extend({
  addOptions() {
    return { slug: "" };
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileEmbedBlock);
  },
});

// ─── Desplegable ─────────────────────────────────────────────────────────────────────────

function ToggleBlock() {
  const [open, setOpen] = useState(true);
  return (
    <NodeViewWrapper className="toggle-block" data-open={open}>
      <button
        type="button"
        contentEditable={false}
        aria-expanded={open}
        aria-label={open ? texts.pages.toggle.collapse : texts.pages.toggle.expand}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="toggle-chevron"
      >
        <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
      </button>
      <NodeViewContent className="toggle-body" />
    </NodeViewWrapper>
  );
}

export const ToggleView = Toggle.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ToggleBlock);
  },
});

// ─── Buscador de archivos para incrustar ─────────────────────────────────────────────────

export function EmbedFileDialog({
  open,
  slug,
  onClose,
  onPick,
}: {
  open: boolean;
  slug: string;
  onClose: () => void;
  onPick: (node: NodeRef) => void;
}) {
  const t = texts.pages.embed;
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(text.trim());
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  const query = useInfiniteQuery({
    queryKey: ["w", slug, "search-nodes", "embed", q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => nodeLinksApi.search(slug, "embed", q, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        description={t.description}
        footer={
          <DialogClose asChild>
            <Button variant="outline">{texts.admin.common.cancel}</Button>
          </DialogClose>
        }
      >
        <div className="grid gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <Input
              type="search"
              value={text}
              aria-label={t.search}
              placeholder={t.search}
              className="pl-9"
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </div>
          {query.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.empty}</p>
          ) : (
            <ul className="m-0 max-h-72 list-none overflow-y-auto p-0">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(item);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <NodeIcon node={item} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.spaceName}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {query.hasNextPage && (
                <li className="p-2 text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={query.isFetchingNextPage}
                    onClick={() => {
                      void query.fetchNextPage();
                    }}
                  >
                    {texts.common.loadMore}
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
