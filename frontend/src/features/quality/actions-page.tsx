// /app/:slug/calidad/acciones — the CAPA actions (docs/spec/calidad.md): every action of the
// nonconformities the person sees, or only their own with ?mine=1 («Mis acciones»), filters in the
// address. Whoever has to do one marks it done here.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, ListChecks } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { useInfiniteList } from "@/components/ui/infinite";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { formatUtcDate } from "@/lib/utils";
import {
  ACTION_KINDS,
  qualityApi,
  qualityKeys,
  type ActionFilters,
  type QualityAction,
} from "./quality-api";
import { useQuality } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.actions;
const STATUSES = ["open", "overdue", "done", "all"] as const;

/** «Mis acciones»: only the person's own. */
export function MyQualityActionsPage() {
  return <QualityActionsPage mineOnly />;
}

export function QualityActionsPage({ mineOnly = false }: { mineOnly?: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { view } = useQuality();
  const { params, patch } = useListParams();
  // Without quality.view, the list is always their own.
  const mine = mineOnly || params.get("mine") === "1" || !view;
  const filters = useMemo<ActionFilters>(
    () => ({
      status: STATUSES.find((id) => id === params.get("estado")) ?? "open",
      kind: ACTION_KINDS.find((id) => id === params.get("tipo")),
      mine: mine ? "1" : undefined,
    }),
    [params, mine],
  );
  const statuses = useStaticSource(
    "quality-action-statuses",
    STATUSES.map((id) => ({ id, label: t.statuses[id] })),
  );
  const kinds = useStaticSource(
    "quality-action-kind-filter",
    ACTION_KINDS.map((id) => ({ id, label: texts.quality.kinds[id] })),
  );
  const list = useInfiniteList<QualityAction>({
    queryKey: qualityKeys.actions(workspaceSlug, filters),
    fetchPage: (cursor, signal) => qualityApi.actions(workspaceSlug, filters, cursor, signal),
  });
  const done = useMutation({
    mutationFn: (id: string) => qualityApi.doneAction(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(texts.quality.action.doneToast);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const columns = useMemo<ColumnDef<QualityAction>[]>(
    () => [
      {
        id: "action",
        header: t.columns.action,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p
              className={
                row.original.done === null ? "font-medium" : "text-muted-foreground line-through"
              }
            >
              {row.original.description}
            </p>
            {row.original.done !== null && (
              <Badge tone="success">{texts.quality.detail.actions.done}</Badge>
            )}
            {row.original.overdue && (
              <Badge tone="danger">{texts.quality.detail.actions.overdue}</Badge>
            )}
          </div>
        ),
      },
      {
        id: "nc",
        header: t.columns.nc,
        cell: ({ row }) => (
          <Link
            to={`/app/${workspaceSlug}/calidad/no-conformidades/${row.original.nc.id}`}
            className="min-w-0 underline-offset-4 hover:underline"
          >
            <span className="block text-xs text-muted-foreground tabular-nums">
              {row.original.nc.code}
            </span>
            <span className="block truncate text-sm">{row.original.nc.title}</span>
          </Link>
        ),
      },
      {
        id: "kind",
        header: t.columns.kind,
        cell: ({ row }) => texts.quality.kinds[row.original.kind],
      },
      {
        id: "responsible",
        header: t.columns.responsible,
        cell: ({ row }) => row.original.responsible.name,
      },
      { id: "due", header: t.columns.due, cell: ({ row }) => formatUtcDate(row.original.dueOn) },
      {
        id: "done",
        header: () => <span className="sr-only">{texts.quality.detail.actions.markDone}</span>,
        cell: ({ row }) =>
          row.original.canComplete ? (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="icon"
                aria-label={texts.quality.detail.actions.markDone}
                disabled={done.isPending}
                onClick={() => {
                  done.mutate(row.original.id);
                }}
              >
                <CheckCircle2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </div>
          ) : null,
      },
    ],
    [done, workspaceSlug],
  );
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{mine ? t.mineTitle : t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          {mine ? t.mineSubtitle : t.subtitle}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Combobox
          compact
          searchable={false}
          label={texts.quality.list.columns.status}
          placeholder={texts.quality.list.columns.status}
          source={statuses}
          value={filters.status ?? "open"}
          onChange={(option) => {
            patch({ estado: option?.id === "open" ? undefined : option?.id });
          }}
        />
        <Combobox
          compact
          clearable
          searchable={false}
          label={t.columns.kind}
          placeholder={t.anyKind}
          source={kinds}
          value={filters.kind ?? null}
          onChange={(option) => {
            patch({ tipo: option?.id });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={ListChecks}>{t.empty}</EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={mine ? t.mineTitle : t.title}
            columns={columns}
            data={list.items}
            getRowId={(action) => action.id}
            loading={list.query.isPending}
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
          />
        </Card>
      )}
    </div>
  );
}
