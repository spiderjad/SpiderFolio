// /app/:slug/seguridad/epis — PPE handouts (docs/spec/seguridad-salud.md, «EPIs»): whoever manages the
// module sees everyone's and records new ones; heads see their area's; everyone else their own. The
// filters live in the address.
import type { ColumnDef } from "@tanstack/react-table";
import { HardHat, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { FormField as LabeledField, Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { readChoice, useListParams } from "@/features/admin/list-params";
import { cn, formatDateTime } from "@/lib/utils";
import { safetyApi, safetyKeys, type Delivery, type DeliveryFilters } from "./safety-api";
import { PpeTabs, useItemSource, usePeopleSource, useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.deliveries;

const STATUSES = (["all", "valid", "voided"] as const).map((id) => ({
  id,
  label: t.filters.statuses[id],
}));

function filtersOf(params: URLSearchParams): DeliveryFilters {
  const day = (key: string) => {
    const value = params.get(key) ?? "";
    return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
  };
  return {
    person: params.get("persona") ?? undefined,
    item: params.get("equipo") ?? undefined,
    from: day("desde"),
    to: day("hasta"),
    status: readChoice(params, "estado", ["all", "valid", "voided"] as const, "all"),
  };
}

export function DeliveriesPage() {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const safety = useSafety();
  const seesOthers = safety.canManage || safety.leads;
  const { params, patch } = useListParams();
  const filters = useMemo(() => filtersOf(params), [params]);
  const [personLabel, setPersonLabel] = useState<string | undefined>(undefined);
  const peopleSource = usePeopleSource();
  const itemSource = useItemSource();
  const statuses = useStaticSource("safety-delivery-status", STATUSES);
  const list = useInfiniteList<Delivery>({
    queryKey: safetyKeys.deliveries(workspaceSlug, filters),
    fetchPage: (cursor, signal) => safetyApi.deliveries(workspaceSlug, filters, cursor, signal),
  });
  const filtered =
    filters.person !== undefined ||
    filters.item !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined ||
    filters.status !== "all";
  const base = `/app/${workspaceSlug}/seguridad`;
  const columns = useMemo<ColumnDef<Delivery>[]>(
    () => [
      {
        id: "date",
        header: t.columns.date,
        cell: ({ row }) => (
          <Link
            to={`${base}/epis/${row.original.id}`}
            className={cn(
              "font-medium underline-offset-4 hover:underline",
              row.original.voided !== null && "text-muted-foreground line-through",
            )}
          >
            {formatDateTime(row.original.deliveredAt)}
          </Link>
        ),
      },
      ...(seesOthers
        ? [
            {
              id: "person",
              header: t.columns.person,
              cell: ({ row }: { row: { original: Delivery } }) => (
                <Link
                  to={`${base}/personas/${row.original.person.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {row.original.person.name}
                </Link>
              ),
            } satisfies ColumnDef<Delivery>,
          ]
        : []),
      {
        id: "items",
        header: t.columns.items,
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1.5">
            {row.original.voided !== null && <Badge tone="warning">{t.voided}</Badge>}
            <span className="text-sm">
              {row.original.lines
                .map((line) =>
                  line.quantity === 1
                    ? line.item.name
                    : `${line.item.name} ×${String(line.quantity)}`,
                )
                .join(", ")}
            </span>
          </span>
        ),
      },
      {
        id: "by",
        header: t.columns.by,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.deliveredBy.name}</span>
        ),
      },
    ],
    [base, seesOthers],
  );
  const f = t.filters;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title(safety.terms.ppes)}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            {seesOthers ? t.subtitle : t.subtitleOwn}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {safety.canManage && (
            <Button
              onClick={() => {
                void navigate(`${base}/epis/nueva`);
              }}
            >
              <Plus strokeWidth={1.75} aria-hidden="true" />
              {t.new}
            </Button>
          )}
        </div>
      </div>
      <PpeTabs />
      <Card className="grid gap-3 p-0">
        <div className="grid grid-cols-2 gap-3 px-4 pt-4 sm:grid-cols-3 lg:grid-cols-5 lg:items-end">
          {seesOthers && (
            <LabeledField label={f.person}>
              {(field) => (
                <Combobox
                  {...field}
                  compact
                  label={f.person}
                  placeholder={f.anyPerson}
                  source={peopleSource}
                  value={filters.person ?? null}
                  valueLabel={personLabel ?? (filters.person === undefined ? undefined : f.person)}
                  clearable
                  onChange={(option) => {
                    setPersonLabel(option?.label);
                    patch({ persona: option?.id });
                  }}
                />
              )}
            </LabeledField>
          )}
          {safety.canManage && (
            <LabeledField label={f.item}>
              {(field) => (
                <Combobox
                  {...field}
                  compact
                  label={f.item}
                  placeholder={f.anyItem}
                  source={itemSource}
                  value={filters.item ?? null}
                  clearable
                  onChange={(option) => {
                    patch({ equipo: option?.id });
                  }}
                />
              )}
            </LabeledField>
          )}
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
          <LabeledField label={f.status}>
            {(field) => (
              <Combobox
                {...field}
                compact
                label={f.status}
                placeholder={f.statuses.all}
                source={statuses}
                searchable={false}
                value={filters.status ?? "all"}
                onChange={(option) => {
                  patch({ estado: option === null || option.id === "all" ? undefined : option.id });
                }}
              />
            )}
          </LabeledField>
        </div>
        {filtered && (
          <div className="px-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPersonLabel(undefined);
                patch({
                  persona: undefined,
                  equipo: undefined,
                  desde: undefined,
                  hasta: undefined,
                  estado: undefined,
                });
              }}
            >
              <X className="size-4" aria-hidden="true" />
              {f.clear}
            </Button>
          </div>
        )}
        {!list.query.isPending && list.items.length === 0 ? (
          <EmptyState
            icon={HardHat}
            title={filtered ? t.emptyFiltered : seesOthers ? t.empty.title : t.emptyOwn}
          >
            {filtered || !safety.canManage ? null : t.empty.text}
          </EmptyState>
        ) : (
          <DataTable
            label={t.title(safety.terms.ppes)}
            columns={columns}
            data={list.items}
            getRowId={(delivery) => delivery.id}
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
