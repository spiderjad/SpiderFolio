// /app/:slug/seguridad/planificacion — the planning of the preventive activity (docs/spec/seguridad-
// salud.md; Ley 31/1995, art. 16): every measure with its origin, priority, responsible, date and cost,
// filters in the address, CSV. For whoever manages the module; an accident's measure says only
// «Accidente o incidente» unless the viewer has the health data capability.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, ClipboardList, Download, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { formatUtcDate } from "@/lib/utils";
import { ActionDialog } from "./action-dialog";
import {
  ACTION_ORIGINS,
  ACTION_PRIORITIES,
  incidentsApi,
  incidentsKeys,
  planningApi,
  planningKeys,
  type ActionReference,
  type PlanningFilters,
  type SafetyAction,
} from "./safety-api";
import { PpeTabs, usePeopleSource } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.planning;
const STATUSES = ["open", "overdue", "done", "all"] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

const priorityTone = { HIGH: "danger", MEDIUM: "warning", LOW: "neutral" } as const;

/** «12,50 €»-like, in the person's language (the currency is the company's own). */
const costText = (cents: number | null): string =>
  cents === null
    ? "—"
    : (cents / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

/** Where the reference opens, if the viewer may open it. */
export function referenceHref(slug: string, reference: ActionReference): string | null {
  if (reference === null) return null;
  if (reference.kind === "incident") {
    return reference.id === null ? null : `/app/${slug}/seguridad/incidentes/${reference.id}`;
  }
  if (reference.kind === "document") {
    if (reference.spaceId === null) return null;
    const base = `/app/${slug}/files/${reference.spaceId}`;
    // A page opens; a file, its folder.
    return reference.page
      ? `${base}/p/${reference.id}`
      : reference.parentId === null
        ? base
        : `${base}/f/${reference.parentId}`;
  }
  return reference.spaceId === null || reference.formId === null
    ? null
    : `/app/${slug}/files/${reference.spaceId}/form/${reference.formId}/r/${reference.id}`;
}

export function OriginCell({ action }: { action: SafetyAction }) {
  const { workspaceSlug = "" } = useParams();
  const href = referenceHref(workspaceSlug, action.reference);
  const label = action.reference?.label ?? t.origins[action.origin];
  return (
    <div className="min-w-0">
      <p className="text-sm">{t.origins[action.origin]}</p>
      {action.reference !== null && label !== t.origins[action.origin] && (
        <p className="truncate text-xs text-muted-foreground">
          {href === null ? (
            label
          ) : (
            <Link to={href} className="underline-offset-4 hover:underline">
              {label}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

export function PlanningPage() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { params, patch } = useListParams();
  const from = params.get("desde");
  const to = params.get("hasta");
  const filters = useMemo<PlanningFilters>(
    () => ({
      origin: ACTION_ORIGINS.find((id) => id === params.get("origen")),
      status: STATUSES.find((id) => id === params.get("estado")) ?? "open",
      responsible: params.get("responsable") ?? undefined,
      priority: ACTION_PRIORITIES.find((id) => id === params.get("prioridad")),
      from: from !== null && DAY.test(from) ? from : undefined,
      to: to !== null && DAY.test(to) ? to : undefined,
    }),
    [params, from, to],
  );
  const origins = useStaticSource(
    "safety-action-origins",
    ACTION_ORIGINS.map((id) => ({ id, label: t.origins[id] })),
  );
  const statuses = useStaticSource(
    "safety-action-statuses",
    STATUSES.map((id) => ({ id, label: t.statuses[id] })),
  );
  const priorities = useStaticSource(
    "safety-action-priority-filter",
    ACTION_PRIORITIES.map((id) => ({ id, label: t.priorities[id] })),
  );
  const people = usePeopleSource();
  const [editing, setEditing] = useState<SafetyAction | "new" | null>(null);
  const list = useInfiniteList<SafetyAction>({
    queryKey: planningKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => planningApi.list(workspaceSlug, filters, cursor, signal),
  });
  const done = useMutation({
    mutationFn: (id: string) => incidentsApi.done(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(texts.safety.incidents.toasts.done);
      await queryClient.invalidateQueries({ queryKey: incidentsKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const csv = useMutation({
    mutationFn: async () => {
      downloadBlobFile("planificacion.csv", await planningApi.csv(workspaceSlug, filters));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const columns = useMemo<ColumnDef<SafetyAction>[]>(
    () => [
      {
        id: "measure",
        header: t.columns.measure,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p
              className={
                row.original.done === null ? "font-medium" : "text-muted-foreground line-through"
              }
            >
              {row.original.description}
            </p>
            {row.original.done !== null && <Badge tone="success">{t.done}</Badge>}
            {row.original.overdue && <Badge tone="danger">{t.overdue}</Badge>}
          </div>
        ),
      },
      {
        id: "origin",
        header: t.columns.origin,
        cell: ({ row }) => <OriginCell action={row.original} />,
      },
      {
        id: "priority",
        header: t.columns.priority,
        cell: ({ row }) => (
          <Badge tone={priorityTone[row.original.priority]}>
            {t.priorities[row.original.priority]}
          </Badge>
        ),
      },
      {
        id: "responsible",
        header: t.columns.responsible,
        cell: ({ row }) => row.original.responsible.name,
      },
      { id: "due", header: t.columns.due, cell: ({ row }) => formatUtcDate(row.original.dueOn) },
      {
        id: "cost",
        header: t.columns.cost,
        cell: ({ row }) => costText(row.original.estimatedCost),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t.columns.actions}</span>,
        cell: ({ row }) =>
          row.original.done === null && row.original.canEdit ? (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.markDone}
                disabled={done.isPending}
                onClick={() => {
                  done.mutate(row.original.id);
                }}
              >
                <CheckCircle2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.edit(row.original.description)}
                onClick={() => {
                  setEditing(row.original);
                }}
              >
                <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </div>
          ) : null,
      },
    ],
    [done],
  );
  const filtered =
    filters.origin !== undefined ||
    filters.status !== "open" ||
    filters.responsible !== undefined ||
    filters.priority !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={csv.isPending}
            onClick={() => {
              csv.mutate();
            }}
          >
            <Download className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {t.csv}
          </Button>
          <Button
            onClick={() => {
              setEditing("new");
            }}
          >
            <Plus strokeWidth={1.75} aria-hidden="true" />
            {t.create}
          </Button>
        </div>
      </div>
      <PpeTabs />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Combobox
          compact
          searchable={false}
          label={t.filters.status}
          placeholder={t.filters.status}
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
          label={t.filters.origin}
          placeholder={t.filters.anyOrigin}
          source={origins}
          value={filters.origin ?? null}
          onChange={(option) => {
            patch({ origen: option?.id });
          }}
        />
        <Combobox
          compact
          clearable
          searchable={false}
          label={t.filters.priority}
          placeholder={t.filters.anyPriority}
          source={priorities}
          value={filters.priority ?? null}
          onChange={(option) => {
            patch({ prioridad: option?.id });
          }}
        />
        <Combobox
          compact
          clearable
          label={t.filters.responsible}
          placeholder={t.filters.anyResponsible}
          source={people}
          value={filters.responsible ?? null}
          onChange={(option) => {
            patch({ responsable: option?.id });
          }}
        />
        <Input
          type="date"
          aria-label={t.filters.from}
          value={filters.from ?? ""}
          onChange={(event) => {
            patch({ desde: event.target.value });
          }}
        />
        <Input
          type="date"
          aria-label={t.filters.to}
          value={filters.to ?? ""}
          onChange={(event) => {
            patch({ hasta: event.target.value });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
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
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && (
          <ActionDialog
            {...(editing === "new" ? { from: { origin: "OTHER" as const } } : { action: editing })}
            onClose={() => {
              setEditing(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
