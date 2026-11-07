// /app/:slug/calidad/proveedores — the supplier register (docs/spec/calidad.md, «Fase 4»): name,
// category, risk, status, the worst state of its certificates and the next review, with filters in the
// address. Whoever doesn't see them all sees the ones they follow.
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog } from "@/components/ui/overlay";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { formatUtcDate } from "@/lib/utils";
import {
  RISKS,
  SUPPLIER_CATEGORIES,
  SUPPLIER_STATUSES,
  supplierKeys,
  suppliersApi,
  type DocState,
  type Risk,
  type Supplier,
  type SupplierFilters,
  type SupplierStatus,
} from "./quality-api";
import { useQuality } from "./quality-common";
import { SupplierDialog } from "./supplier-dialog";
import { texts } from "@/i18n";

const t = texts.quality.suppliers;
const STATUS_FILTERS = [...SUPPLIER_STATUSES, "archived"] as const;

const statusTone = {
  PENDING: "neutral",
  APPROVED: "success",
  CONDITIONAL: "warning",
  BLOCKED: "danger",
} as const;
const riskTone = { LOW: "neutral", MEDIUM: "warning", HIGH: "danger" } as const;
const docTone = {
  valid: "success",
  due_soon: "warning",
  expired: "danger",
  no_expiry: "neutral",
} as const;

export function SupplierStatusBadge({ status }: { status: SupplierStatus }) {
  return <Badge tone={statusTone[status]}>{t.statuses[status]}</Badge>;
}

export function RiskBadge({ risk }: { risk: Risk }) {
  return <Badge tone={riskTone[risk]}>{t.risks[risk]}</Badge>;
}

export function DocStateBadge({ state }: { state: DocState }) {
  return <Badge tone={docTone[state]}>{t.docStates[state]}</Badge>;
}

export function SuppliersPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage } = useQuality();
  const { params, patch } = useListParams();
  const filters = useMemo<SupplierFilters>(
    () => ({
      q: params.get("q") ?? undefined,
      status: STATUS_FILTERS.find((id) => id === params.get("estado")),
      category: SUPPLIER_CATEGORIES.find((id) => id === params.get("categoria")),
      risk: RISKS.find((id) => id === params.get("riesgo")),
    }),
    [params],
  );
  const [search, setSearch] = useSearchParam("q", filters.q ?? "", patch);
  const statuses = useStaticSource(
    "quality-supplier-status-filter",
    STATUS_FILTERS.map((id) => ({
      id,
      label: id === "archived" ? t.archivedFilter : t.statuses[id],
    })),
  );
  const categories = useStaticSource(
    "quality-supplier-category-filter",
    SUPPLIER_CATEGORIES.map((id) => ({ id, label: t.categories[id] })),
  );
  const risks = useStaticSource(
    "quality-supplier-risk-filter",
    RISKS.map((id) => ({ id, label: t.risks[id] })),
  );
  const [creating, setCreating] = useState(false);
  const list = useInfiniteList<Supplier>({
    queryKey: supplierKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => suppliersApi.list(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<Supplier>[]>(
    () => [
      {
        id: "name",
        header: t.columns.name,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/app/${workspaceSlug}/calidad/proveedores/${row.original.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{row.original.supplies}</p>
          </div>
        ),
      },
      {
        id: "category",
        header: t.columns.category,
        cell: ({ row }) => t.categories[row.original.category],
      },
      {
        id: "risk",
        header: t.columns.risk,
        cell: ({ row }) => <RiskBadge risk={row.original.risk} />,
      },
      {
        id: "status",
        header: t.columns.status,
        cell: ({ row }) => <SupplierStatusBadge status={row.original.status} />,
      },
      {
        id: "certificates",
        header: t.columns.certificates,
        cell: ({ row }) =>
          row.original.certificates === null ? (
            <span className="text-xs text-muted-foreground">{t.noCertificates}</span>
          ) : (
            <DocStateBadge state={row.original.certificates} />
          ),
      },
      {
        id: "review",
        header: t.columns.nextReview,
        cell: ({ row }) =>
          row.original.nextReviewOn === null ? (
            "—"
          ) : (
            <span className={row.original.reviewDue ? "text-danger" : undefined}>
              {formatUtcDate(row.original.nextReviewOn)}
              {row.original.reviewDue && <span className="block text-xs">{t.reviewDue}</span>}
            </span>
          ),
      },
    ],
    [workspaceSlug],
  );
  const filtered =
    filters.q !== undefined ||
    filters.status !== undefined ||
    filters.category !== undefined ||
    filters.risk !== undefined;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        {manage && (
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          type="search"
          aria-label={t.search}
          placeholder={t.search}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <Combobox
          compact
          clearable
          searchable={false}
          label={t.columns.status}
          placeholder={t.anyStatus}
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
          label={t.columns.category}
          placeholder={t.anyCategory}
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
          label={t.columns.risk}
          placeholder={t.anyRisk}
          source={risks}
          value={filters.risk ?? null}
          onChange={(option) => {
            patch({ riesgo: option?.id });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(supplier) => supplier.id}
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
          <SupplierDialog
            onClose={() => {
              setCreating(false);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
