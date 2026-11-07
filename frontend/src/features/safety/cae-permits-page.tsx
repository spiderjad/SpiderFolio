// /app/:slug/seguridad/cae/permisos — work permits (docs/spec/cae.md, «Permisos de trabajo»): for
// contractors and own staff, with status, type, company and day in the address. Whoever manages CAE
// issues them; whoever checks contractors reads them.
import type { ColumnDef } from "@tanstack/react-table";
import { FileCheck2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  COMBO_PAGE_SIZE,
  useStaticSource,
  type ComboboxSource,
} from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog } from "@/components/ui/overlay";
import { useListParams } from "@/features/admin/list-params";
import { formatDateTime } from "@/lib/utils";
import {
  CAE_PERMIT_STATUSES,
  CAE_PERMIT_TYPES,
  caeApi,
  caeKeys,
  type CaePermit,
  type CaePermitFilters,
  type CaePermitState,
} from "./cae-api";
import { CaeNav, useCae } from "./cae-common";
import { PermitForm } from "./cae-permit-form";
import { texts } from "@/i18n";

const t = texts.cae.permits;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

const stateTone = {
  draft: "neutral",
  scheduled: "primary",
  active: "success",
  expired: "warning",
  closed: "neutral",
  cancelled: "danger",
} as const;

export function PermitStateBadge({ state }: { state: CaePermitState }) {
  return <Badge tone={stateTone[state]}>{t.states[state]}</Badge>;
}

export const permitName = (permit: Pick<CaePermit, "type" | "customName">): string =>
  permit.type === "OTHER" ? (permit.customName ?? t.types.OTHER) : t.types[permit.type];

function useCompanyFilterSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: [...caeKeys.all(workspaceSlug), "permit-filter-companies"],
      search: async (q, cursor, signal) => {
        const page = await caeApi.companies(
          workspaceSlug,
          { q, status: undefined },
          cursor,
          signal,
          COMBO_PAGE_SIZE,
        );
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

export function CaePermitsPage() {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const cae = useCae();
  const { params, patch } = useListParams();
  const dayParam = params.get("dia");
  const filters = useMemo<CaePermitFilters>(
    () => ({
      status: CAE_PERMIT_STATUSES.find((status) => status === params.get("estado")),
      type: CAE_PERMIT_TYPES.find((type) => type === params.get("tipo")),
      companyId: params.get("empresa") ?? undefined,
      day: dayParam !== null && DAY.test(dayParam) ? dayParam : undefined,
    }),
    [params, dayParam],
  );
  const statuses = useStaticSource(
    "cae-permit-statuses",
    CAE_PERMIT_STATUSES.map((id) => ({ id, label: t.statuses[id] })),
  );
  const types = useStaticSource(
    "cae-permit-filter-types",
    CAE_PERMIT_TYPES.map((id) => ({ id, label: t.types[id] })),
  );
  const companies = useCompanyFilterSource();
  const [creating, setCreating] = useState(false);
  const list = useInfiniteList<CaePermit>({
    queryKey: caeKeys.permits(workspaceSlug, filters),
    fetchPage: (cursor, signal) => caeApi.permits(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<CaePermit>[]>(
    () => [
      {
        id: "type",
        header: t.columns.type,
        cell: ({ row }) => (
          <Link
            to={`${cae.base}/permisos/${row.original.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {permitName(row.original)}
          </Link>
        ),
      },
      { id: "place", header: t.columns.place, cell: ({ row }) => row.original.location },
      {
        id: "company",
        header: t.columns.company,
        cell: ({ row }) => row.original.company?.name ?? t.ownStaff,
      },
      {
        id: "validity",
        header: t.columns.validity,
        cell: ({ row }) => (
          <span className="text-xs">
            {t.validity(
              formatDateTime(row.original.validFrom),
              formatDateTime(row.original.validTo),
            )}
          </span>
        ),
      },
      {
        id: "state",
        header: t.columns.state,
        cell: ({ row }) => <PermitStateBadge state={row.original.state} />,
      },
    ],
    [cae.base],
  );
  const filtered = Object.values(filters).some((value) => value !== undefined);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        {cae.manage && (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus strokeWidth={1.75} aria-hidden="true" />
            {t.create}
          </Button>
        )}
      </div>
      <CaeNav />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[200px_200px_1fr_180px]">
        <Combobox
          compact
          clearable
          searchable={false}
          label={t.filters.status}
          placeholder={t.filters.anyStatus}
          source={statuses}
          value={filters.status ?? null}
          onChange={(option) => {
            patch({ estado: option?.id });
          }}
        />
        <Combobox
          compact
          clearable
          searchable={false}
          label={t.filters.type}
          placeholder={t.filters.anyType}
          source={types}
          value={filters.type ?? null}
          onChange={(option) => {
            patch({ tipo: option?.id });
          }}
        />
        <Combobox
          compact
          clearable
          label={t.filters.company}
          placeholder={t.filters.anyCompany}
          source={companies}
          value={filters.companyId ?? null}
          onChange={(option) => {
            patch({ empresa: option?.id });
          }}
        />
        <Input
          type="date"
          aria-label={t.filters.day}
          value={filters.day ?? ""}
          onChange={(event) => {
            patch({ dia: event.target.value });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={FileCheck2} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(permit) => permit.id}
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
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <PermitForm
            permit={null}
            onClose={() => {
              setCreating(false);
            }}
            onSaved={(permit) => {
              void navigate(`${cae.base}/permisos/${permit.id}`);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
