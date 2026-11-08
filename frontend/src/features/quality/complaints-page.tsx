// /app/:slug/calidad/reclamaciones — complaints (docs/spec/calidad.md, «Fase 5»): the list with its
// deadlines and filters in the address, and the indicators tab (complaints per million units, by
// category) with the units sold of each month. Anyone records a complaint.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MessageSquareWarning, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { cn, formatUtcDate } from "@/lib/utils";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_SOURCES,
  complaintKeys,
  complaintsApi,
  qualityKeys,
  type Complaint,
  type ComplaintCategory,
  type ComplaintFilters,
  type ComplaintSource,
  type ComplaintStatus,
} from "./quality-api";
import { todayDay, useQuality, usePeopleSource } from "./quality-common";
import { LotPicker } from "./lot-picker";
import { locale, texts } from "@/i18n";

const t = texts.quality.complaints;

/** «nov. 2026», in the person's language. */
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
const STATUS_FILTERS = ["all", "overdue", "OPEN", "ANSWERED", "CLOSED"] as const;
const statusTone = { OPEN: "warning", ANSWERED: "primary", CLOSED: "success" } as const;

export function ComplaintStatusBadge({ status }: { status: ComplaintStatus }) {
  return <Badge tone={statusTone[status]}>{t.statuses[status]}</Badge>;
}

export function ComplaintDialog({ onClose }: { onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { manage } = useQuality();
  const people = usePeopleSource();
  const sources = useStaticSource(
    "quality-complaint-sources",
    COMPLAINT_SOURCES.map((id) => ({ id, label: t.sources[id] })),
  );
  const categories = useStaticSource(
    "quality-complaint-categories",
    COMPLAINT_CATEGORIES.map((id) => ({ id, label: t.categories[id] })),
  );
  const f = t.form;
  const [state, setState] = useState({
    source: "CUSTOMER" as ComplaintSource,
    from: "",
    contact: "",
    product: "",
    lot: "",
    traced: null as { id: string; code: string } | null,
    category: "QUALITY" as ComplaintCategory,
    description: "",
    receivedOn: todayDay(),
    owner: null as { id: string; name: string } | null,
  });
  const set = (patch: Partial<typeof state>) => {
    setState((current) => ({ ...current, ...patch }));
  };
  const blank = (text: string) => (text.trim() === "" ? null : text.trim());
  const save = useMutation({
    mutationFn: () =>
      complaintsApi.create(workspaceSlug, {
        source: state.source,
        from: state.from.trim(),
        contact: blank(state.contact),
        product: state.product.trim(),
        lot: blank(state.lot),
        lotId: state.traced?.id ?? null,
        category: state.category,
        description: state.description.trim(),
        receivedOn: state.receivedOn,
        ownerId: state.owner?.id ?? null,
      }),
    onSuccess: async ({ complaint }) => {
      toast.success(f.created);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
      await navigate(`/app/${workspaceSlug}/calidad/reclamaciones/${complaint.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready =
    state.from.trim() !== "" &&
    state.product.trim() !== "" &&
    state.description.trim() !== "" &&
    state.receivedOn !== "";
  const text = (key: "from" | "contact" | "product" | "lot", label: string, max: number) => (
    <FormField label={label} {...(key === "contact" ? { hint: f.contactHint } : {})}>
      {(control) => (
        <Input
          {...control}
          maxLength={max}
          value={state[key]}
          onChange={(event) => {
            set({ [key]: event.target.value });
          }}
        />
      )}
    </FormField>
  );
  return (
    <DialogContent
      size="lg"
      title={f.title}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={!ready || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : texts.admin.common.create}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={f.source}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.source}
                placeholder={f.source}
                source={sources}
                value={state.source}
                onChange={(option) => {
                  const next = COMPLAINT_SOURCES.find((id) => id === option?.id);
                  if (next !== undefined) set({ source: next });
                }}
              />
            )}
          </FormField>
          <div className="sm:col-span-2">{text("from", f.from, 160)}</div>
        </div>
        {state.source === "CONSUMER" && text("contact", f.contact, 300)}
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          {text("product", f.product, 160)}
          {text("lot", f.lot, 120)}
        </div>
        <LotPicker
          value={state.traced}
          onChange={(picked) => {
            set(picked === null ? { traced: null } : { traced: picked, lot: picked.code });
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.category}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.category}
                placeholder={f.category}
                source={categories}
                value={state.category}
                onChange={(option) => {
                  const next = COMPLAINT_CATEGORIES.find((id) => id === option?.id);
                  if (next !== undefined) set({ category: next });
                }}
              />
            )}
          </FormField>
          <FormField label={f.receivedOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={state.receivedOn}
                onChange={(event) => {
                  set({ receivedOn: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.description}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={4000}
              value={state.description}
              onChange={(event) => {
                set({ description: event.target.value });
              }}
            />
          )}
        </FormField>
        {manage && (
          <FormField label={f.owner}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={f.owner}
                placeholder={f.ownerPlaceholder}
                source={people}
                value={state.owner?.id ?? null}
                valueLabel={state.owner?.name}
                onChange={(option) => {
                  set({ owner: option === null ? null : { id: option.id, name: option.label } });
                }}
              />
            )}
          </FormField>
        )}
      </FormGrid>
    </DialogContent>
  );
}

function Indicators({ slug, manage }: { slug: string; manage: boolean }) {
  const queryClient = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const i = t.indicators;
  const years = useStaticSource(
    `quality-complaint-years-${String(thisYear)}`,
    [thisYear, thisYear - 1, thisYear - 2].map((value) => ({
      id: String(value),
      label: String(value),
    })),
  );
  const query = useQuery({
    queryKey: complaintKeys.indicators(slug, year),
    queryFn: () => complaintsApi.indicators(slug, year),
  });
  const save = useMutation({
    mutationFn: ({ month, units }: { month: string; units: number }) =>
      complaintsApi.units(slug, `${month}-01`, units),
    onSuccess: async (_result, { month }) => {
      toast.success(i.saved);
      setDrafts((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== month)),
      );
      await queryClient.invalidateQueries({ queryKey: complaintKeys.indicators(slug, year) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = query.data;
  return (
    <div className="grid gap-4">
      <div className="w-28">
        <Combobox
          compact
          searchable={false}
          label={i.year}
          placeholder={i.year}
          source={years}
          value={String(year)}
          onChange={(option) => {
            if (option !== null) setYear(Number(option.id));
          }}
        />
      </div>
      {data === undefined ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [i.total, String(data.total.complaints)],
              [
                i.perMillion,
                data.total.perMillion === null ? "—" : data.total.perMillion.toLocaleString(),
              ],
              [i.justified, String(data.total.justified)],
            ].map(([label, value]) => (
              <Card key={label} className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </Card>
            ))}
          </div>
          {data.total.units === null && (
            <p className="text-xs text-muted-foreground">{i.noUnits}</p>
          )}
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">{i.month}</th>
                    <th className="px-4 py-2 font-medium">{i.complaints}</th>
                    <th className="px-4 py-2 font-medium">{i.units}</th>
                    <th className="px-4 py-2 font-medium">{i.rate}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.months.map((month) => {
                    const draft = drafts[month.month];
                    return (
                      <tr key={month.month}>
                        <td className="px-4 py-2">{monthLabel(month.month)}</td>
                        <td className="px-4 py-2 tabular-nums">{month.complaints}</td>
                        <td className="px-4 py-2">
                          {manage ? (
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                className="h-8 w-32"
                                aria-label={`${i.units} ${month.month}`}
                                value={draft ?? (month.units === null ? "" : String(month.units))}
                                onChange={(event) => {
                                  setDrafts({ ...drafts, [month.month]: event.target.value });
                                }}
                              />
                              {draft !== undefined && draft !== "" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={save.isPending}
                                  onClick={() => {
                                    save.mutate({ month: month.month, units: Number(draft) });
                                  }}
                                >
                                  {i.save}
                                </Button>
                              )}
                            </div>
                          ) : (
                            <span className="tabular-nums">{month.units ?? "—"}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 tabular-nums">
                          {month.perMillion === null ? "—" : month.perMillion.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            <Card className="grid content-start gap-3 p-4">
              <CardTitle>{i.byCategory}</CardTitle>
              <ul className="grid gap-2 text-sm">
                {data.categories.map((row) => (
                  <li key={row.category} className="flex justify-between gap-3">
                    <span>{t.categories[row.category]}</span>
                    <span className="tabular-nums">{row.complaints}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export function ComplaintsPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage, view } = useQuality();
  const { params, patch } = useListParams();
  const tab = view && params.get("pestana") === "indicadores" ? "indicators" : "list";
  const filters = useMemo<ComplaintFilters>(
    () => ({
      status: STATUS_FILTERS.find((id) => id === params.get("estado")) ?? "all",
      category: COMPLAINT_CATEGORIES.find((id) => id === params.get("categoria")),
      source: COMPLAINT_SOURCES.find((id) => id === params.get("origen")),
    }),
    [params],
  );
  const statuses = useStaticSource(
    "quality-complaint-status-filter",
    STATUS_FILTERS.map((id) => ({
      id,
      label: id === "all" ? t.filters.all : id === "overdue" ? t.filters.overdue : t.statuses[id],
    })),
  );
  const categories = useStaticSource(
    "quality-complaint-category-filter",
    COMPLAINT_CATEGORIES.map((id) => ({ id, label: t.categories[id] })),
  );
  const sources = useStaticSource(
    "quality-complaint-source-filter",
    COMPLAINT_SOURCES.map((id) => ({ id, label: t.sources[id] })),
  );
  const [creating, setCreating] = useState(false);
  const list = useInfiniteList<Complaint>({
    queryKey: complaintKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => complaintsApi.list(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<Complaint>[]>(
    () => [
      {
        id: "complaint",
        header: t.columns.complaint,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/app/${workspaceSlug}/calidad/reclamaciones/${row.original.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.product}
              {row.original.lot !== null && ` · ${row.original.lot}`}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {t.sources[row.original.source]} · {row.original.from}
            </p>
          </div>
        ),
      },
      {
        id: "category",
        header: t.columns.category,
        cell: ({ row }) => t.categories[row.original.category],
      },
      {
        id: "received",
        header: t.columns.received,
        cell: ({ row }) => formatUtcDate(row.original.receivedOn),
      },
      {
        id: "respondBy",
        header: t.columns.respondBy,
        cell: ({ row }) => (
          <span className={cn(row.original.overdue && "text-danger")}>
            {formatUtcDate(row.original.respondBy)}
            {row.original.overdue && <span className="block text-xs">{t.overdue}</span>}
          </span>
        ),
      },
      {
        id: "status",
        header: t.columns.status,
        cell: ({ row }) => <ComplaintStatusBadge status={row.original.status} />,
      },
    ],
    [workspaceSlug],
  );
  const filtered =
    filters.status !== "all" || filters.category !== undefined || filters.source !== undefined;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus strokeWidth={1.75} aria-hidden="true" />
          {t.create}
        </Button>
      </div>
      {view && (
        <div role="tablist" className="flex gap-1 border-b border-border">
          {(["list", "indicators"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm",
                tab === id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                patch({ pestana: id === "list" ? undefined : "indicadores" });
              }}
            >
              {t.tabs[id]}
            </button>
          ))}
        </div>
      )}
      {tab === "indicators" ? (
        <Indicators slug={workspaceSlug} manage={manage} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Combobox
              compact
              searchable={false}
              label={t.columns.status}
              placeholder={t.columns.status}
              source={statuses}
              value={filters.status ?? "all"}
              onChange={(option) => {
                patch({ estado: option?.id === "all" ? undefined : option?.id });
              }}
            />
            <Combobox
              compact
              clearable
              searchable={false}
              label={t.columns.category}
              placeholder={t.filters.anyCategory}
              source={categories}
              value={filters.category ?? null}
              onChange={(option) => {
                patch({ categoria: option?.id });
              }}
            />
            <Combobox
              compact
              clearable
              searchable={false}
              label={t.form.source}
              placeholder={t.filters.anySource}
              source={sources}
              value={filters.source ?? null}
              onChange={(option) => {
                patch({ origen: option?.id });
              }}
            />
          </div>
          {!list.query.isPending && list.items.length === 0 ? (
            <Card>
              <EmptyState
                icon={MessageSquareWarning}
                title={filtered ? t.emptyFiltered : t.empty.title}
              >
                {filtered ? null : t.empty.text}
              </EmptyState>
            </Card>
          ) : (
            <Card className="p-0">
              <DataTable
                label={t.title}
                columns={columns}
                data={list.items}
                getRowId={(complaint) => complaint.id}
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
        </>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <ComplaintDialog
            onClose={() => {
              setCreating(false);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
