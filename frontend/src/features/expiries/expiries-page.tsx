// /app/:slug/vencimientos — files and pages with an expiry (docs/spec/vencimientos.md): only what the
// person sees. A list or a month's calendar; filters in the address and the CSV with the same filters.
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField as LabeledField, Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { readChoice, useListParams } from "@/features/admin/list-params";
import { cn, formatUtcDate } from "@/lib/utils";
import {
  addDays,
  expiriesApi,
  expiriesKeys,
  type ExpiryFilters,
  type ExpiryRow,
} from "./expiries-api";
import { companyToday, ExpiryDialog, toneOf } from "./expiry-dialog";
import { texts } from "@/i18n";

const t = texts.expiries.page;
const STATUSES = ["all", "valid", "due_soon", "expired"] as const;

/** Where an element opens: a page or a form by its route, a file in its folder. */
export function elementPath(slug: string, node: ExpiryRow["node"]): string {
  const base = `/app/${slug}/files/${node.spaceId}`;
  if (node.type === "PAGE") return `${base}/p/${node.id}`;
  if (node.type === "FORM") return `${base}/form/${node.id}`;
  return node.parentId === null ? base : `${base}/f/${node.parentId}`;
}

export function ExpiriesPage() {
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const view = readChoice(params, "vista", ["list", "calendar"] as const, "list");
  const filters = useMemo<ExpiryFilters>(() => {
    const day = (key: string) => {
      const value = params.get(key) ?? "";
      return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
    };
    const text = (key: string) => params.get(key) ?? undefined;
    return {
      space: text("espacio"),
      department: text("departamento"),
      responsible: text("responsable"),
      status: readChoice(params, "estado", STATUSES, "all"),
      from: day("desde"),
      to: day("hasta"),
    };
  }, [params]);
  const options = useQuery({
    queryKey: expiriesKeys.filters(workspaceSlug),
    queryFn: () => expiriesApi.filters(workspaceSlug),
    staleTime: 60_000,
  });
  const toOptions = (rows: { id: string; name: string }[] | undefined) =>
    (rows ?? []).map((row) => ({ id: row.id, label: row.name }));
  const spaces = useStaticSource(
    `expiry-spaces-${String(options.dataUpdatedAt)}`,
    toOptions(options.data?.spaces),
  );
  const departments = useStaticSource(
    `expiry-departments-${String(options.dataUpdatedAt)}`,
    toOptions(options.data?.departments),
  );
  const people = useStaticSource(
    `expiry-people-${String(options.dataUpdatedAt)}`,
    toOptions(options.data?.people),
  );
  const statuses = useStaticSource(
    "expiry-status",
    STATUSES.map((id) => ({ id, label: t.statuses[id] })),
  );
  const csv = useMutation({
    mutationFn: async () => {
      downloadBlobFile(`${t.title}.csv`, await expiriesApi.csv(workspaceSlug, filters));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const f = t.filters;
  const nameOf = (rows: { id: string; name: string }[] | undefined, id: string | undefined) =>
    rows?.find((row) => row.id === id)?.name;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
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
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label={t.title}>
        {(["list", "calendar"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-current={view === id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              view === id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              patch({ vista: id === "list" ? undefined : id });
            }}
          >
            {t.views[id]}
          </button>
        ))}
      </nav>
      <Card className="grid gap-3 p-0">
        <div
          className={cn(
            "grid grid-cols-2 gap-3 px-4 pt-4 lg:items-end",
            view === "list" ? "lg:grid-cols-6" : "lg:grid-cols-4",
          )}
        >
          <LabeledField label={f.space}>
            {(field) => (
              <Combobox
                {...field}
                compact
                clearable
                label={f.space}
                placeholder={f.anySpace}
                source={spaces}
                value={filters.space ?? null}
                valueLabel={nameOf(options.data?.spaces, filters.space)}
                onChange={(option) => {
                  patch({ espacio: option?.id });
                }}
              />
            )}
          </LabeledField>
          <LabeledField label={f.department}>
            {(field) => (
              <Combobox
                {...field}
                compact
                clearable
                label={f.department}
                placeholder={f.anyDepartment}
                source={departments}
                value={filters.department ?? null}
                valueLabel={nameOf(options.data?.departments, filters.department)}
                onChange={(option) => {
                  patch({ departamento: option?.id });
                }}
              />
            )}
          </LabeledField>
          <LabeledField label={f.responsible}>
            {(field) => (
              <Combobox
                {...field}
                compact
                clearable
                label={f.responsible}
                placeholder={f.anyResponsible}
                source={people}
                value={filters.responsible ?? null}
                valueLabel={nameOf(options.data?.people, filters.responsible)}
                onChange={(option) => {
                  patch({ responsable: option?.id });
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
          {view === "list" && (
            <>
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
            </>
          )}
        </div>
        {view === "list" ? (
          <ExpiryList slug={workspaceSlug} filters={filters} />
        ) : (
          <ExpiryCalendar
            slug={workspaceSlug}
            filters={filters}
            month={
              /^\d{4}-\d{2}$/u.test(params.get("mes") ?? "") ? (params.get("mes") ?? "") : null
            }
            onMonth={(month) => {
              patch({ mes: month });
            }}
          />
        )}
      </Card>
    </div>
  );
}

function ExpiryList({ slug, filters }: { slug: string; filters: ExpiryFilters }) {
  const [editing, setEditing] = useState<{ id: string; name: string; type: string } | null>(null);
  const list = useInfiniteList<ExpiryRow>({
    queryKey: expiriesKeys.list(slug, filters),
    fetchPage: (cursor, signal) => expiriesApi.list(slug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<ExpiryRow>[]>(
    () => [
      {
        id: "dueOn",
        header: t.columns.dueOn,
        cell: ({ row }) => (
          <button
            type="button"
            className="font-medium underline-offset-4 hover:underline"
            onClick={() => {
              setEditing({
                id: row.original.node.id,
                name: row.original.node.name,
                type: row.original.node.type,
              });
            }}
          >
            {formatUtcDate(row.original.dueOn)}
          </button>
        ),
      },
      {
        id: "element",
        header: t.columns.element,
        cell: ({ row }) => (
          <Link
            to={elementPath(slug, row.original.node)}
            className="underline-offset-4 hover:underline"
          >
            {row.original.node.name}
          </Link>
        ),
      },
      { id: "space", header: t.columns.space, cell: ({ row }) => row.original.node.spaceName },
      {
        id: "responsible",
        header: t.columns.responsible,
        cell: ({ row }) => row.original.responsible?.name ?? "—",
      },
      {
        id: "state",
        header: t.columns.state,
        cell: ({ row }) => (
          <Badge tone={toneOf(row.original.state)}>
            {texts.expiries.states[row.original.state]}
          </Badge>
        ),
      },
    ],
    [slug],
  );
  return (
    <>
      {!list.query.isPending && list.items.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t.empty}>
          {t.emptyText}
        </EmptyState>
      ) : (
        <DataTable
          label={t.title}
          columns={columns}
          data={list.items}
          getRowId={(row) => row.node.id}
          loading={list.query.isPending}
          paging={{
            total: list.total,
            hasNextPage: list.query.hasNextPage,
            isFetchingNextPage: list.query.isFetchingNextPage,
            onLoadMore: list.loadMore,
          }}
        />
      )}
      <ExpiryDialog
        target={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
    </>
  );
}

/** How many a day shows before «y N más». */
const PER_DAY = 3;

function ExpiryCalendar({
  slug,
  filters,
  month,
  onMonth,
}: {
  slug: string;
  filters: ExpiryFilters;
  month: string | null;
  onMonth: (month: string | undefined) => void;
}) {
  const today = companyToday();
  const shown = month ?? today.slice(0, 7);
  const first = `${shown}-01`;
  const next = nextMonth(shown);
  const last = addDays(`${next}-01`, -1);
  const c = t.calendar;
  const range = { ...filters, from: first, to: last };
  // A month shows up to 100 (the page's maximum): enough for a company's calendar.
  const month100 = useQuery({
    queryKey: [...expiriesKeys.list(slug, range), "month"],
    queryFn: ({ signal }) => expiriesApi.list(slug, range, undefined, signal, 100),
  });
  const [editing, setEditing] = useState<{ id: string; name: string; type: string } | null>(null);
  const byDay = new Map<string, ExpiryRow[]>();
  for (const row of month100.data?.items ?? []) {
    byDay.set(row.dueOn, [...(byDay.get(row.dueOn) ?? []), row]);
  }
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days = Number(last.slice(8, 10));
  const trail = (7 - ((lead + days) % 7)) % 7;
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, index) => addDays(first, index)),
    ...Array.from({ length: trail }, () => null),
  ];
  const title = new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${first}T00:00:00Z`));
  return (
    <div className="grid gap-3 px-4 pb-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {title.charAt(0).toUpperCase() + title.slice(1)}
        </h2>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={c.previous}
            onClick={() => {
              onMonth(previousMonth(shown));
            }}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onMonth(undefined);
            }}
          >
            {c.today}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={c.next}
            onClick={() => {
              onMonth(next);
            }}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {month100.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
            {c.weekdays.map((name) => (
              <div
                key={name}
                className="bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
              >
                {name}
              </div>
            ))}
            {cells.map((day, index) => {
              if (day === null)
                return <div key={`lead-${String(index)}`} className="bg-background" />;
              const items = byDay.get(day) ?? [];
              return (
                <div
                  key={day}
                  className={cn(
                    "min-h-24 bg-background p-1.5",
                    day === today && "bg-primary-soft/40",
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 text-xs",
                      day === today ? "font-semibold text-primary" : "text-muted-foreground",
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </div>
                  <ul className="m-0 grid list-none gap-1 p-0">
                    {items.slice(0, PER_DAY).map((row) => (
                      <li key={row.node.id}>
                        <button
                          type="button"
                          title={row.node.name}
                          className={cn(
                            "block w-full truncate rounded px-1.5 py-0.5 text-left text-xs",
                            row.state === "expired"
                              ? "bg-danger-soft text-danger-soft-foreground"
                              : row.state === "due_soon"
                                ? "bg-warning-soft text-warning-soft-foreground"
                                : "bg-success-soft text-success-soft-foreground",
                          )}
                          onClick={() => {
                            setEditing({
                              id: row.node.id,
                              name: row.node.name,
                              type: row.node.type,
                            });
                          }}
                        >
                          {row.node.name}
                        </button>
                      </li>
                    ))}
                    {items.length > PER_DAY && (
                      <li className="px-1.5 text-xs text-muted-foreground">
                        {c.more(items.length - PER_DAY)}
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <ExpiryDialog
        target={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
    </div>
  );
}

function nextMonth(month: string): string {
  const [year = 1970, number = 1] = month.split("-").map(Number);
  return number === 12
    ? `${String(year + 1)}-01`
    : `${String(year)}-${String(number + 1).padStart(2, "0")}`;
}

function previousMonth(month: string): string {
  const [year = 1970, number = 1] = month.split("-").map(Number);
  return number === 1
    ? `${String(year - 1)}-12`
    : `${String(year)}-${String(number - 1).padStart(2, "0")}`;
}
