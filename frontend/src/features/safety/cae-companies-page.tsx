// /app/:slug/seguridad/cae — the external companies that work at the site (docs/spec/cae.md,
// «Pantallas»): search, type and state in the address, each one's authorization with its reasons and
// the new-company dialog for whoever manages CAE.
import type { ColumnDef } from "@tanstack/react-table";
import { Handshake, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { SearchField } from "@/components/ui/filter-bar";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog } from "@/components/ui/overlay";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import {
  CAE_KINDS,
  CAE_STATES,
  caeApi,
  caeKeys,
  type CaeCompanyFilters,
  type CaeCompanyRow,
} from "./cae-api";
import { CaeNav, CaeStateBadge, useCae } from "./cae-common";
import { CompanyForm } from "./cae-company-form";
import { PpeTabs } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.cae.companies;

export function CaeCompaniesPage() {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const cae = useCae();
  const { params, patch } = useListParams();
  const filters = useMemo<CaeCompanyFilters>(
    () => ({
      q: params.get("q") ?? undefined,
      kind: CAE_KINDS.find((kind) => kind === params.get("tipo")),
      status: CAE_STATES.find((state) => state === params.get("estado")),
    }),
    [params],
  );
  const [search, setSearch] = useSearchParam("q", filters.q ?? "", patch);
  const kinds = useStaticSource(
    `cae-kinds-${cae.terms.companies}`,
    CAE_KINDS.map((id) => ({ id, label: cae.terms.kinds[id] })),
  );
  const states = useStaticSource(
    "cae-states",
    CAE_STATES.map((id) => ({ id, label: texts.cae.states[id] })),
  );
  const list = useInfiniteList<CaeCompanyRow>({
    queryKey: caeKeys.companies(workspaceSlug, filters),
    fetchPage: (cursor, signal) => caeApi.companies(workspaceSlug, filters, cursor, signal),
  });
  const [creating, setCreating] = useState(false);
  const columns = useMemo<ColumnDef<CaeCompanyRow>[]>(
    () => [
      {
        id: "name",
        header: t.columns.name,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`${cae.base}/empresas/${row.original.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.parent !== null && (
              <p className="truncate text-xs text-muted-foreground">
                {t.dependsOn(row.original.parent.name)}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "kind",
        header: t.columns.kind,
        cell: ({ row }) => cae.terms.kinds[row.original.kind],
      },
      {
        id: "responsible",
        header: t.columns.responsible,
        cell: ({ row }) => row.original.responsible?.name ?? "—",
      },
      {
        id: "workers",
        header: t.columns.workers,
        cell: ({ row }) => row.original.workers ?? "—",
      },
      {
        id: "status",
        header: t.columns.status,
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-1">
            <span className="flex flex-wrap gap-1">
              <CaeStateBadge state={row.original.status.state} />
              {row.original.pending !== null && row.original.pending > 0 && (
                <Badge tone="primary">{t.pending(row.original.pending)}</Badge>
              )}
            </span>
            {row.original.status.reasons.length > 0 && (
              <p className="truncate text-xs text-muted-foreground">
                {row.original.status.reasons[0]}
                {row.original.status.reasons.length > 1 &&
                  ` (+${String(row.original.status.reasons.length - 1)})`}
              </p>
            )}
          </div>
        ),
      },
    ],
    [cae.base, cae.terms],
  );
  const filtered =
    filters.q !== undefined || filters.kind !== undefined || filters.status !== undefined;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{cae.terms.companies}</h1>
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
      <PpeTabs />
      <CaeNav />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_220px_200px]">
        <SearchField
          placeholder={t.search}
          label={texts.admin.common.search}
          value={search}
          onChange={setSearch}
        />
        <Combobox
          compact
          clearable
          searchable={false}
          label={t.kind}
          placeholder={t.anyKind}
          source={kinds}
          value={filters.kind ?? null}
          onChange={(option) => {
            patch({ tipo: option?.id });
          }}
        />
        <Combobox
          compact
          clearable
          searchable={false}
          label={t.status}
          placeholder={t.anyStatus}
          source={states}
          value={filters.status ?? null}
          onChange={(option) => {
            patch({ estado: option?.id });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={Handshake} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={cae.terms.companies}
            columns={columns}
            data={list.items}
            getRowId={(company) => company.id}
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
          <CompanyForm
            company={null}
            onClose={() => {
              setCreating(false);
            }}
            onSaved={(company) => {
              void navigate(`${cae.base}/empresas/${company.id}`);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
