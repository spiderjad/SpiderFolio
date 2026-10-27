// /app/:slug/mis-documentos — la vista del operario, pensada primero para el celular: lo que tengo
// que leer (con un botón grande «Leí y comprendo»), las novedades de mi área esta semana, mis
// espacios favoritos y los recientes. Es el inicio por defecto de quien tiene plaza de lector.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookCheck, Clock, FolderOpen, History, Newspaper, Star } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { adminErrorText } from "@/features/admin/admin-utils";
import { filesApi, filesKeys, previewKind, type NodeType } from "@/features/files/api";
import { NodeIcon } from "@/features/files/file-utils";
import { formatShortDate, timeAgo } from "@/lib/utils";
import { documentsApi, documentsKeys, type MyReading, type NewsItem } from "./documents-api";
import { texts } from "@/i18n";

/** Cuántas lecturas me faltan (para el contador del menú). */
export function useReadingCount(slug: string): number {
  const query = useQuery({
    queryKey: [...documentsKeys.readings(slug), "count"],
    queryFn: () => documentsApi.myReadings(slug),
    staleTime: 30_000,
    select: (page) => page.total,
  });
  return query.data ?? 0;
}

export function pathOf(
  slug: string,
  node: { id: string; type: NodeType; spaceId: string },
): string | null {
  const base = `/app/${slug}/files/${node.spaceId}`;
  if (node.type === "PAGE") return `${base}/p/${node.id}`;
  if (node.type === "FOLDER") return `${base}/f/${node.id}`;
  return null;
}

/** Abre un documento: páginas y carpetas por su ruta; un archivo, su vista previa o descarga. */
export async function openFile(slug: string, node: { id: string; mimeType?: string | null }) {
  const ticket = await filesApi.download(slug, node.id, {
    inline: previewKind(node.mimeType ?? null) !== null,
  });
  window.open(ticket.url, "_blank", "noopener");
}

export function MyDocumentsPage() {
  const t = texts.documents.mine;
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <PendingReadings />
      <News />
      <Spaces kind="favorites" />
      <RecentDocuments />
    </div>
  );
}

function PendingReadings() {
  const t = texts.documents.mine;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const list = useInfiniteList<MyReading>({
    queryKey: [...documentsKeys.readings(workspaceSlug), "list"],
    fetchPage: (cursor, signal) => documentsApi.myReadings(workspaceSlug, cursor, signal),
  });
  const confirm = useMutation({
    mutationFn: (item: MyReading) => documentsApi.acknowledge(workspaceSlug, item.node.id),
    onSuccess: async () => {
      toast.success(texts.documents.readings.acknowledged);
      await queryClient.invalidateQueries({ queryKey: documentsKeys.readings(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <section className="grid gap-3" aria-labelledby="mine-readings">
      <h2 id="mine-readings" className="flex items-center gap-2 text-base font-semibold">
        <BookCheck className="size-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
        {t.readings}
        {list.total > 0 && <Badge tone="solid">{list.total}</Badge>}
      </h2>
      {list.query.isPending ? (
        <Skeleton className="h-28 w-full" />
      ) : list.query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t.loadError}
        </p>
      ) : list.items.length === 0 ? (
        <Card>
          <EmptyState icon={BookCheck} title={t.readingsDoneTitle}>
            {t.readingsDone}
          </EmptyState>
        </Card>
      ) : (
        list.items.map((item) => {
          const to = pathOf(workspaceSlug, item.node);
          return (
            <Card key={item.node.id} className="grid gap-3 p-4">
              <div className="flex items-start gap-3">
                <NodeIcon node={item.node} className="mt-0.5 size-6" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-base font-medium">{item.node.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.code} · {t.version(item.version)}
                  </p>
                  {item.dueAt !== null && (
                    <p
                      className={
                        item.overdue
                          ? "mt-1 flex items-center gap-1 text-sm font-medium text-danger"
                          : "mt-1 flex items-center gap-1 text-sm text-warning-soft-foreground"
                      }
                    >
                      <Clock className="size-4" strokeWidth={1.75} aria-hidden="true" />
                      {item.overdue
                        ? t.overdue(formatShortDate(item.dueAt))
                        : t.due(formatShortDate(item.dueAt))}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {to === null ? (
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-12 text-base"
                    onClick={() => {
                      void openFile(workspaceSlug, item.node).catch((error: unknown) => {
                        toast.error(adminErrorText(error));
                      });
                    }}
                  >
                    {t.open}
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="lg" className="h-12 text-base">
                    <Link to={to}>{t.open}</Link>
                  </Button>
                )}
                <Button
                  size="lg"
                  className="h-12 text-base"
                  disabled={confirm.isPending}
                  onClick={() => {
                    confirm.mutate(item);
                  }}
                >
                  {texts.documents.readings.acknowledge}
                </Button>
              </div>
            </Card>
          );
        })
      )}
      <LoadMore
        hasNextPage={list.query.hasNextPage}
        isFetching={list.query.isFetchingNextPage}
        onLoadMore={list.loadMore}
      />
    </section>
  );
}

function News() {
  const t = texts.documents.mine;
  const { workspaceSlug = "" } = useParams();
  const list = useInfiniteList<NewsItem>({
    queryKey: [...documentsKeys.all(workspaceSlug), "news"],
    fetchPage: (cursor, signal) => documentsApi.news(workspaceSlug, cursor, signal),
  });
  return (
    <section className="grid gap-3" aria-labelledby="mine-news">
      <h2 id="mine-news" className="flex items-center gap-2 text-base font-semibold">
        <Newspaper className="size-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
        {t.news}
      </h2>
      {list.query.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : list.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.newsEmpty}</p>
      ) : (
        <Card className="overflow-hidden">
          <ul className="m-0 list-none divide-y divide-border p-0">
            {list.items.map((item) => {
              const to = pathOf(workspaceSlug, item.node);
              const body = (
                <>
                  <NodeIcon node={item.node} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium">{item.node.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[
                        item.code,
                        t.version(item.version),
                        formatShortDate(item.publishedAt),
                        item.department?.name,
                        item.changeNote,
                      ]
                        .filter((part) => part !== undefined && part !== null && part !== "")
                        .join(" · ")}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={`${item.node.id}:${String(item.version)}`}>
                  {to === null ? (
                    <button
                      type="button"
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
                      onClick={() => {
                        void openFile(workspaceSlug, item.node).catch((error: unknown) => {
                          toast.error(adminErrorText(error));
                        });
                      }}
                    >
                      {body}
                    </button>
                  ) : (
                    <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-3">
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <LoadMore
        hasNextPage={list.query.hasNextPage}
        isFetching={list.query.isFetchingNextPage}
        onLoadMore={list.loadMore}
      />
    </section>
  );
}

function Spaces({ kind }: { kind: "favorites" }) {
  const t = texts.documents.mine;
  const { workspaceSlug = "" } = useParams();
  const query = useQuery({
    queryKey: [...filesKeys.all(workspaceSlug), "mine", kind],
    queryFn: async () =>
      (await filesApi.spaces(workspaceSlug, { filter: "favorites", sort: "name", pageSize: 12 }))
        .items,
  });
  const items = query.data ?? [];
  if (query.isPending) return <Skeleton className="h-16 w-full" />;
  if (items.length === 0) return null;
  const Icon = Star;
  return (
    <section className="grid gap-3" aria-label={t.favorites}>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon className="size-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
        {t.favorites}
      </h2>
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {items.map((space) => (
          <li key={space.id}>
            <Link
              to={`/app/${workspaceSlug}/files/${space.id}`}
              className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <FolderOpen
                className="size-5 shrink-0 text-primary"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="min-w-0 truncate text-sm font-medium">{space.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Los últimos documentos que abrí (solo los míos). */
export function RecentDocuments({ limit = 10 }: { limit?: number }) {
  const t = texts.documents.mine;
  const { workspaceSlug = "" } = useParams();
  const query = useQuery({
    queryKey: [...documentsKeys.recent(workspaceSlug), limit],
    queryFn: () => documentsApi.recent(workspaceSlug, limit),
    select: (page) => page.items,
  });
  const items = query.data ?? [];
  if (query.isPending) return <Skeleton className="h-16 w-full" />;
  if (items.length === 0) return null;
  return (
    <section className="grid gap-3" aria-label={t.recent}>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <History className="size-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
        {t.recent}
      </h2>
      <Card className="overflow-hidden">
        <ul className="m-0 list-none divide-y divide-border p-0">
          {items.map((item) => {
            const to = pathOf(workspaceSlug, item.node);
            const body = (
              <>
                <NodeIcon node={item.node} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium">{item.node.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[item.code, item.node.spaceName, timeAgo(item.visitedAt)]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </span>
                </span>
              </>
            );
            return (
              <li key={item.node.id}>
                {to === null ? (
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
                    onClick={() => {
                      void openFile(workspaceSlug, item.node).catch((error: unknown) => {
                        toast.error(adminErrorText(error));
                      });
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-3">
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
