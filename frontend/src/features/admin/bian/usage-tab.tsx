// Uso: cuántas consultas hizo cada persona o departamento este período, con búsqueda, orden,
// scroll infinito y exportación a CSV. Solo cantidades: nunca el contenido de las preguntas.
import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { InfiniteList, useInfiniteList } from "@/components/ui/infinite";
import {
  adminErrorText,
  downloadTextFile,
  loadErrorIcon,
  loadErrorText,
} from "@/features/admin/admin-utils";
import { readChoice, useListParams, useSearchParam } from "@/features/admin/list-params";
import {
  bianApi,
  bianKeys,
  type DepartmentUsageRow,
  type LimitMode,
  type PersonUsageRow,
  type UsageSort,
  type UsageView,
} from "@/features/bian/bian-api";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";
import { texts } from "@/i18n";

const VIEWS = ["people", "departments"] as const satisfies readonly UsageView[];
const SORTS = ["name", "used", "limit"] as const satisfies readonly UsageSort[];

const limitText = (row: { mode: LimitMode; limit: number | null }): string =>
  row.mode === "UNLIMITED"
    ? texts.bian.admin.usage.unlimited
    : row.mode === "BLOCKED"
      ? texts.bian.admin.usage.blocked
      : String(row.limit ?? 0);

const select =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function UsageTab() {
  const t = texts.bian.admin.usage;
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const view = readChoice(params, "vista", VIEWS, "people");
  const sort = readChoice(params, "orden", SORTS, "name");
  const dir = params.get("dir") === "desc" ? "desc" : "asc";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useSearchParam("q", q, patch);

  const list = useInfiniteList<PersonUsageRow | DepartmentUsageRow>({
    queryKey: [...bianKeys.usageTable(workspaceSlug), view, q, sort, dir],
    fetchPage: (cursor, signal) =>
      bianApi.usageRows(
        workspaceSlug,
        { view, q, sort, dir, ...(cursor === undefined ? {} : { cursor }) },
        signal,
      ),
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      downloadTextFile(
        view === "people" ? "uso-de-bian-por-persona.csv" : "uso-de-bian-por-departamento.csv",
        await bianApi.usageCsv(workspaceSlug, { view, q, sort, dir }),
      );
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  return (
    <div className="grid min-w-0 gap-4">
      <p className="max-w-2xl text-xs text-muted-foreground">{t.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t.title} className="flex flex-wrap gap-1.5">
          {VIEWS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => {
                patch({ vista: value === "people" ? undefined : value, orden: undefined });
              }}
              className="h-9 rounded-full border border-border px-3.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:border-primary/30 aria-pressed:bg-primary-soft aria-pressed:font-medium aria-pressed:text-primary-soft-foreground"
            >
              {value === "people" ? t.people : t.departments}
            </button>
          ))}
        </div>
        <SearchField
          className="ml-auto min-w-48 max-w-sm flex-1 basis-56"
          value={search}
          onChange={setSearch}
          placeholder={t.search}
          label={t.search}
        />
        <select
          aria-label={t.queries}
          value={`${sort}:${dir}`}
          className={select}
          onChange={(event) => {
            const [nextSort, nextDir] = event.target.value.split(":");
            patch({
              orden: nextSort === "name" ? undefined : nextSort,
              dir: nextDir === "asc" ? undefined : nextDir,
            });
          }}
        >
          <option value="name:asc">{view === "people" ? t.person : t.department} ↑</option>
          <option value="name:desc">{view === "people" ? t.person : t.department} ↓</option>
          <option value="used:desc">{t.queries} ↓</option>
          <option value="used:asc">{t.queries} ↑</option>
          <option value="limit:desc">{view === "people" ? t.limit : t.limitPerPerson} ↓</option>
          <option value="limit:asc">{view === "people" ? t.limit : t.limitPerPerson} ↑</option>
        </select>
        <Button
          variant="outline"
          disabled={exportCsv.isPending}
          onClick={() => {
            exportCsv.mutate();
          }}
        >
          <Download strokeWidth={1.75} aria-hidden="true" />
          {exportCsv.isPending ? t.exporting : t.export}
        </Button>
      </div>

      <Card className="overflow-hidden">
        {list.query.isError && list.items.length === 0 ? (
          <EmptyState icon={loadErrorIcon(list.query.error)} title={t.error}>
            {loadErrorText(list.query.error)}
          </EmptyState>
        ) : list.items.length === 0 && !list.query.isPending ? (
          <EmptyState icon={Users} title={t.empty}>
            {t.text}
          </EmptyState>
        ) : (
          <>
            <div
              className={cn(
                "grid gap-x-4 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                view === "people"
                  ? "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5rem_6rem]"
                  : "grid-cols-[minmax(0,1.4fr)_5rem_5rem_6rem]",
              )}
            >
              <span>{view === "people" ? t.person : t.department}</span>
              <span>{view === "people" ? t.departmentsOf : t.peopleCount}</span>
              <span className="text-right">{t.queries}</span>
              <span className="text-right">{view === "people" ? t.limit : t.limitPerPerson}</span>
            </div>
            <InfiniteList
              items={list.items}
              getKey={(row) => ("membershipId" in row ? row.membershipId : row.departmentId)}
              label={t.title}
              estimateHeight={44}
              maxHeightClass="max-h-[60vh]"
              paging={{
                total: list.total,
                hasNextPage: list.query.hasNextPage,
                isFetchingNextPage: list.query.isFetchingNextPage,
                onLoadMore: list.loadMore,
              }}
              renderItem={(row) => (
                <div
                  className={cn(
                    "grid items-center gap-x-4 px-4 py-2 text-sm",
                    view === "people"
                      ? "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5rem_6rem]"
                      : "grid-cols-[minmax(0,1.4fr)_5rem_5rem_6rem]",
                  )}
                >
                  <span className="truncate font-medium">{row.name}</span>
                  <span className="truncate text-muted-foreground">
                    {"departments" in row ? row.departments.join(" · ") : row.people}
                  </span>
                  <span className="text-right tabular-nums">{row.used}</span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {limitText(row)}
                  </span>
                </div>
              )}
            />
          </>
        )}
      </Card>
    </div>
  );
}
