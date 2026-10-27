// Valoraciones: el porcentaje de 👍 y, por documento citado, cuántos 👍 y 👎 hubo (y por qué), para
// saber qué documentos confunden a Bian. Filtros por valoración, documento y fecha en la URL, scroll
// infinito y «Mostrando N de M». Solo documentos que quien mira puede ver.
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { MessageSquareText } from "lucide-react";
import { useMemo } from "react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/data";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/form";
import { InfiniteList } from "@/components/ui/infinite";
import { loadErrorIcon, loadErrorText } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { bianApi, bianKeys, FEEDBACK_REASONS, type FeedbackStats } from "@/features/bian/bian-api";
import { formatShortDate } from "@/lib/utils";
import { texts } from "@/i18n";

const select =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function FeedbackTab() {
  const t = texts.bian.feedbackAdmin;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const ratingParam = params.get("valoracion");
  const rating = ratingParam === "UP" || ratingParam === "DOWN" ? ratingParam : undefined;
  const q = params.get("q") ?? "";
  const from = params.get("desde") ?? "";
  const to = params.get("hasta") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);
  const filtered = rating !== undefined || q !== "" || from !== "" || to !== "";

  const query = useInfiniteQuery({
    queryKey: [...bianKeys.feedbackStats(workspaceSlug), rating ?? "", q, from, to],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      bianApi.feedbackStats(
        workspaceSlug,
        {
          ...(rating === undefined ? {} : { rating }),
          ...(q === "" ? {} : { q }),
          ...(from === "" ? {} : { from }),
          ...(to === "" ? {} : { to }),
          ...(pageParam === undefined ? {} : { cursor: pageParam }),
        },
        signal,
      ),
    getNextPageParam: (last) => last.documents.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.documents.items) ?? [],
    [query.data],
  );
  // Los números de arriba son los de todo lo filtrado (no solo de las páginas cargadas).
  const stats: FeedbackStats | undefined = query.data?.pages[0];
  const list = {
    query,
    items,
    total: query.data?.pages.at(-1)?.documents.total ?? 0,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
  };

  if (list.query.isError && list.items.length === 0) {
    return (
      <Card>
        <EmptyState icon={loadErrorIcon(list.query.error)} title={t.error}>
          {loadErrorText(list.query.error)}
        </EmptyState>
      </Card>
    );
  }
  if (list.query.isPending) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="grid min-w-0 gap-4">
      <p className="max-w-2xl text-xs text-muted-foreground">{t.text}</p>

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t.filters.rating}>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.filters.rating}
          <select
            value={rating ?? ""}
            className={select}
            onChange={(event) => {
              patch({ valoracion: event.target.value });
            }}
          >
            <option value="">{t.filters.all}</option>
            <option value="UP">{t.filters.up}</option>
            <option value="DOWN">{t.filters.down}</option>
          </select>
        </label>
        <SearchField
          className="min-w-48 max-w-sm flex-1 basis-56"
          value={search}
          onChange={setSearch}
          placeholder={t.filters.search}
          label={t.filters.search}
        />
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.filters.from}
          <Input
            type="date"
            value={from}
            className="h-9"
            onChange={(event) => {
              patch({ desde: event.target.value });
            }}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.filters.to}
          <Input
            type="date"
            value={to}
            className="h-9"
            onChange={(event) => {
              patch({ hasta: event.target.value });
            }}
          />
        </label>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              patch({ valoracion: undefined, q: undefined, desde: undefined, hasta: undefined });
            }}
          >
            {t.filters.clear}
          </Button>
        )}
      </div>

      {stats !== undefined && stats.total > 0 && <Summary stats={stats} />}

      {list.items.length === 0 ? (
        <Card>
          <EmptyState icon={MessageSquareText} title={filtered ? t.emptyFiltered : t.empty}>
            {filtered ? "" : t.emptyText}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardTitle className="px-4 pb-2 pt-4 text-base sm:px-5">{t.documentsTitle}</CardTitle>
          <InfiniteList
            items={list.items}
            getKey={(doc) => doc.node.id}
            label={t.documentsTitle}
            estimateHeight={72}
            maxHeightClass="max-h-[60vh]"
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
            renderItem={(doc) => (
              <div className="grid gap-1.5 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {doc.code !== null && (
                        <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                          {doc.code}
                        </span>
                      )}
                      {doc.node.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{doc.node.spaceName}</p>
                  </div>
                  <Badge tone="success" className="tabular-nums">
                    {doc.up} {t.up}
                  </Badge>
                  <Badge tone={doc.down > 0 ? "danger" : "primary"} className="tabular-nums">
                    {doc.down} {t.down}
                  </Badge>
                </div>
                {doc.down > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t.reasons}:{" "}
                    {[
                      ...FEEDBACK_REASONS.map((reason) =>
                        doc.reasons[reason] > 0
                          ? `${texts.bian.reasons[reason]} (${String(doc.reasons[reason])})`
                          : null,
                      ),
                      doc.reasons.NONE > 0 ? `${t.noReason} (${String(doc.reasons.NONE)})` : null,
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </p>
                )}
              </div>
            )}
          />
        </Card>
      )}
    </div>
  );
}

function Summary({ stats }: { stats: FeedbackStats }) {
  const t = texts.bian.feedbackAdmin;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="text-base">{t.title}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {t.period(formatShortDate(stats.since))}
        </span>
      </div>
      <div className="flex items-baseline gap-3">
        <p className="text-4xl font-semibold tabular-nums">{stats.percentUp ?? 0} %</p>
        <p className="text-sm text-muted-foreground">{t.percentUp}</p>
      </div>
      <ProgressBar value={stats.up} max={Math.max(1, stats.total)} label={t.percentUp} />
      <p className="text-xs text-muted-foreground">
        {t.ratings(stats.total, stats.up, stats.down)}
      </p>
    </Card>
  );
}
