// /app/:slug/seguridad/incidentes — accidents and incidents (docs/spec/seguridad-salud.md): health data,
// only for safety.health. Filters in the address and the CSV with the same filters.
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Siren } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { FormField as LabeledField, Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { readChoice, useListParams } from "@/features/admin/list-params";
import { formatUtcDate } from "@/lib/utils";
import { incidentsApi, incidentsKeys, type Incident, type IncidentFilters } from "./safety-api";
import { PpeTabs, ReportIncidentButton } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.incidents;
const TYPES = ["leave", "no_leave", "incident", "near_miss"] as const;

export function IncidentsPage() {
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const filters = useMemo<IncidentFilters>(() => {
    const day = (key: string) => {
      const value = params.get(key) ?? "";
      return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
    };
    const type = TYPES.find((id) => id === params.get("tipo"));
    return {
      from: day("desde"),
      to: day("hasta"),
      type,
      status: readChoice(params, "estado", ["all", "open", "closed"] as const, "all"),
    };
  }, [params]);
  const types = useStaticSource(
    "incident-types",
    TYPES.map((id) => ({ id, label: t.types[id] })),
  );
  const statuses = useStaticSource(
    "incident-status",
    (["all", "open", "closed"] as const).map((id) => ({ id, label: t.statuses[id] })),
  );
  const list = useInfiniteList<Incident>({
    queryKey: incidentsKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => incidentsApi.list(workspaceSlug, filters, cursor, signal),
  });
  const csv = useMutation({
    mutationFn: async () => {
      downloadBlobFile(`${t.title}.csv`, await incidentsApi.csv(workspaceSlug, filters));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const base = `/app/${workspaceSlug}/seguridad/incidentes`;
  const columns = useMemo<ColumnDef<Incident>[]>(
    () => [
      {
        id: "date",
        header: t.columns.date,
        cell: ({ row }) => (
          <Link
            to={`${base}/${row.original.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {formatUtcDate(row.original.occurredOn)}
          </Link>
        ),
      },
      {
        id: "type",
        header: t.columns.type,
        cell: ({ row }) => (
          <span>
            {t.types[row.original.type]}
            {row.original.severity !== null && (
              <span className="text-muted-foreground">
                {" "}
                · {t.severities[row.original.severity]}
              </span>
            )}
          </span>
        ),
      },
      {
        id: "person",
        header: t.columns.person,
        cell: ({ row }) => row.original.person?.name ?? "—",
      },
      { id: "place", header: t.columns.place, cell: ({ row }) => row.original.place ?? "—" },
      {
        id: "status",
        header: t.columns.status,
        cell: ({ row }) =>
          row.original.status === "OPEN" ? (
            <Badge tone="warning">{t.open}</Badge>
          ) : (
            <Badge tone="success">{t.closed}</Badge>
          ),
      },
      {
        id: "actions",
        header: t.columns.actions,
        cell: ({ row }) =>
          `${String(row.original.actions.done)}/${String(row.original.actions.total)}`,
      },
    ],
    [base],
  );
  const f = t.filters;
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
            <Download className="size-4" aria-hidden="true" />
            {t.csv}
          </Button>
          <ReportIncidentButton />
        </div>
      </div>
      <PpeTabs />
      <Card className="grid gap-3 p-0">
        <div className="grid grid-cols-2 gap-3 px-4 pt-4 lg:grid-cols-4 lg:items-end">
          <LabeledField label={f.from}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={filters.from ?? ""}
                onChange={(event) => {
                  patch({ desde: event.target.value });
                }}
              />
            )}
          </LabeledField>
          <LabeledField label={f.to}>
            {(field) => (
              <Input
                {...field}
                type="date"
                value={filters.to ?? ""}
                onChange={(event) => {
                  patch({ hasta: event.target.value });
                }}
              />
            )}
          </LabeledField>
          <LabeledField label={f.type}>
            {(field) => (
              <Combobox
                {...field}
                compact
                clearable
                searchable={false}
                label={f.type}
                placeholder={f.anyType}
                source={types}
                value={filters.type ?? null}
                onChange={(option) => {
                  patch({ tipo: option?.id });
                }}
              />
            )}
          </LabeledField>
          <LabeledField label={f.status}>
            {(field) => (
              <Combobox
                {...field}
                compact
                searchable={false}
                label={f.status}
                placeholder={t.statuses.all}
                source={statuses}
                value={filters.status ?? "all"}
                onChange={(option) => {
                  patch({ estado: option === null || option.id === "all" ? undefined : option.id });
                }}
              />
            )}
          </LabeledField>
        </div>
        {!list.query.isPending && list.items.length === 0 ? (
          <EmptyState icon={Siren} title={t.empty}>
            {null}
          </EmptyState>
        ) : (
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(incident) => incident.id}
            loading={list.query.isPending}
            paging={{
              total: list.total,
              hasNextPage: list.query.hasNextPage,
              isFetchingNextPage: list.query.isFetchingNextPage,
              onLoadMore: list.loadMore,
            }}
          />
        )}
      </Card>
    </div>
  );
}
