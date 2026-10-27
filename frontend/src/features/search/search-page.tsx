// /app/:slug/search?q= — resultados de la búsqueda de texto completo: título, código y contenido de
// páginas, PDF y DOCX, con un fragmento y la palabra resaltada, por relevancia y de a páginas. El
// servidor ya filtra por lo que la persona ve; acá solo se muestra.
import { File, FileText, Folder, Search } from "lucide-react";
import { Fragment } from "react";
import { Link, useParams } from "react-router";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { cn } from "@/lib/utils";
import { searchApi, searchKeys, type FullTextHit, type Segment } from "./search-api";
import { texts } from "@/i18n";

/** Texto con la palabra buscada resaltada; todo se escribe como texto (nunca como HTML). */
function Highlighted({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.match ? (
            <mark className="rounded bg-warning-soft px-0.5 text-warning-soft-foreground">
              {segment.text}
            </mark>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </>
  );
}

function hrefOf(slug: string, hit: FullTextHit): string {
  const base = `/app/${slug}/files/${hit.spaceId}`;
  if (hit.type === "PAGE") return `${base}/p/${hit.id}`;
  if (hit.type === "FOLDER") return `${base}/f/${hit.id}`;
  return hit.parentId === null ? base : `${base}/f/${hit.parentId}`;
}

export function SearchPage() {
  const t = texts.search.page;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const q = (params.get("q") ?? "").trim();
  const [text, setText] = useSearchParam("q", q, patch);
  const ready = q.length >= 2;
  const list = useInfiniteList<FullTextHit>({
    queryKey: searchKeys.full(workspaceSlug, q),
    enabled: ready,
    fetchPage: async (cursor, signal) => {
      const page = await searchApi.full(workspaceSlug, q, cursor, signal);
      // La búsqueda no cuenta el total (se arma por tandas): el contador muestra lo cargado.
      return { ...page, total: 0 };
    },
  });
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <SearchField
        value={text}
        onChange={setText}
        placeholder={t.placeholder}
        label={t.placeholder}
        className="max-w-xl"
      />
      <Card className="overflow-hidden">
        {!ready ? (
          <EmptyState icon={Search} title={t.hintTitle}>
            {t.hint}
          </EmptyState>
        ) : list.query.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : list.query.isError ? (
          <p role="alert" className="p-4 text-sm text-danger">
            {t.loadError}
          </p>
        ) : list.items.length === 0 ? (
          <EmptyState icon={Search} title={t.emptyTitle(q)}>
            {t.empty}
          </EmptyState>
        ) : (
          <ul className="m-0 list-none divide-y divide-border p-0">
            {list.items.map((hit) => {
              const Icon = hit.type === "PAGE" ? FileText : hit.type === "FOLDER" ? Folder : File;
              return (
                <li key={hit.id}>
                  <Link
                    to={hrefOf(workspaceSlug, hit)}
                    className="flex gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                  >
                    <Icon
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="break-words text-sm font-medium">
                          <Highlighted segments={hit.name} />
                        </span>
                        {hit.code !== null && <Badge tone="solid">{hit.code}</Badge>}
                        <span className="text-xs text-muted-foreground">{hit.spaceName}</span>
                      </span>
                      {hit.snippet.length > 0 && (
                        <span
                          className={cn(
                            "mt-0.5 block break-words text-xs text-muted-foreground",
                            "line-clamp-3",
                          )}
                        >
                          …<Highlighted segments={hit.snippet} />…
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <LoadMore
          hasNextPage={list.query.hasNextPage}
          isFetching={list.query.isFetchingNextPage}
          onLoadMore={list.loadMore}
        />
      </Card>
      {ready && list.items.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {t.shown(list.items.length, list.query.hasNextPage)}
        </p>
      )}
    </div>
  );
}
