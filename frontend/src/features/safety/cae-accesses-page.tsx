// /app/:slug/seguridad/cae/accesos — the gatehouse log (docs/spec/cae.md, «Modelo» CaeAccess): a day's
// entries and exits, newest first, with the day and the company in the address. Only while the company
// records them (settings.safety.cae.accessLog). Also each company's «Accesos de hoy».
import type { ColumnDef } from "@tanstack/react-table";
import { DoorOpen } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Combobox, COMBO_PAGE_SIZE, type ComboboxSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, CardTitle } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { useListParams } from "@/features/admin/list-params";
import { NotFoundPage } from "@/features/home/not-found-page";
import { formatDateTime } from "@/lib/utils";
import { caeApi, caeKeys, type CaeAccess, type CaeAccessFilters } from "./cae-api";
import { CaeNav, useCae } from "./cae-common";
import { texts } from "@/i18n";

const t = texts.cae.accesses;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** Every company (active or not), to filter the log. */
function useCompanySource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: [...caeKeys.all(workspaceSlug), "company-options"],
      search: async (q, cursor, signal) => {
        const page = await caeApi.companies(workspaceSlug, { q }, cursor, signal, COMBO_PAGE_SIZE);
        return {
          items: page.items.map((company) => ({ id: company.id, label: company.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: async (ids) =>
        (await caeApi.companies(workspaceSlug, { ids }, undefined)).items.map((company) => ({
          id: company.id,
          label: company.name,
        })),
    }),
    [workspaceSlug],
  );
}

/** A day's accesses, optionally of one company. */
export function AccessesTable({
  filters,
  showCompany = true,
  empty,
}: {
  filters: CaeAccessFilters;
  showCompany?: boolean;
  empty: string;
}) {
  const { workspaceSlug = "" } = useParams();
  const cae = useCae();
  const list = useInfiniteList<CaeAccess>({
    queryKey: caeKeys.accesses(workspaceSlug, filters),
    fetchPage: (cursor, signal) => caeApi.accesses(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<CaeAccess>[]>(
    () => [
      { id: "at", header: t.columns.at, cell: ({ row }) => formatDateTime(row.original.at) },
      {
        id: "worker",
        header: t.columns.worker,
        cell: ({ row }) => (
          <Link
            to={`${cae.base}/trabajadores/${row.original.worker.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.original.worker.name}
          </Link>
        ),
      },
      ...(showCompany
        ? [
            {
              id: "company",
              header: t.columns.company,
              cell: ({ row }: { row: { original: CaeAccess } }) => row.original.company.name,
            },
          ]
        : []),
      {
        id: "direction",
        header: t.columns.direction,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            <Badge tone={row.original.direction === "IN" ? "success" : "neutral"}>
              {t.directions[row.original.direction]}
            </Badge>
            {!row.original.authorized && <Badge tone="danger">{t.notAuthorized}</Badge>}
          </span>
        ),
      },
      { id: "by", header: t.columns.by, cell: ({ row }) => row.original.by.name },
    ],
    [cae.base, showCompany],
  );
  if (!list.query.isPending && list.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <DataTable
      label={t.title}
      columns={columns}
      data={list.items}
      getRowId={(access) => access.id}
      loading={list.query.isPending}
      paging={{
        total: list.total,
        hasNextPage: list.query.hasNextPage,
        isFetchingNextPage: list.query.isFetchingNextPage,
        onLoadMore: list.loadMore,
      }}
    />
  );
}

export function CaeAccessesPage() {
  const cae = useCae();
  const { params, patch } = useListParams();
  const companies = useCompanySource();
  const dayParam = params.get("dia");
  const filters = useMemo<CaeAccessFilters>(
    () => ({
      day: dayParam !== null && DAY.test(dayParam) ? dayParam : undefined,
      companyId: params.get("empresa") ?? undefined,
    }),
    [dayParam, params],
  );
  if (!cae.accessLog) return <NotFoundPage />;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <CaeNav />
      <div className="grid gap-3 sm:grid-cols-[200px_260px]">
        <FormField label={t.day}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={filters.day ?? ""}
              onChange={(event) => {
                patch({ dia: event.target.value });
              }}
            />
          )}
        </FormField>
        <FormField label={t.company}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={t.company}
              placeholder={t.anyCompany}
              source={companies}
              value={filters.companyId ?? null}
              onChange={(option) => {
                patch({ empresa: option?.id });
              }}
            />
          )}
        </FormField>
      </div>
      <Card className="p-0">
        <AccessesTable filters={filters} empty={t.empty} />
      </Card>
    </div>
  );
}

/** «Accesos de hoy» of one company, in its record. */
export function CompanyAccessesCard({ companyId }: { companyId: string }) {
  const filters = useMemo<CaeAccessFilters>(() => ({ companyId }), [companyId]);
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <CardTitle className="flex items-center gap-2 text-base">
        <DoorOpen className="size-4 text-primary" strokeWidth={1.75} aria-hidden="true" />
        {t.today}
      </CardTitle>
      <AccessesTable filters={filters} showCompany={false} empty={t.todayEmpty} />
    </Card>
  );
}
