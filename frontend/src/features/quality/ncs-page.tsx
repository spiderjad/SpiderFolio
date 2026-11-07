// /app/:slug/calidad/no-conformidades — the nonconformities (docs/spec/calidad.md): code, title, origin,
// severity, status, owner and actions, with filters in the address and CSV. Whoever doesn't see every NC
// sees the ones they handle, reported or have an action in (the server decides).
import { useMutation } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardX, Download, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Card, EmptyState } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { formatUtcDate } from "@/lib/utils";
import { createBody, formReady, NcFields, useNcForm } from "./nc-form";
import {
  NC_ORIGINS,
  NC_STATUSES,
  SEVERITIES,
  qualityApi,
  qualityKeys,
  type NcFilters,
  type NcSummary,
} from "./quality-api";
import { NcStatusBadge, SeverityBadge, useQuality, usePeopleSource } from "./quality-common";
import { useAuth } from "@/auth/auth-context";
import { useMembership } from "@/features/home/workspace-layout";
import { useSearchParam } from "@/features/admin/list-params";
import { texts } from "@/i18n";

const t = texts.quality.list;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const STATUS_FILTERS = ["open", "all", ...NC_STATUSES] as const;

export function CreateDialog({
  onClose,
  supplier,
}: {
  onClose: () => void;
  /** A nonconformity of this supplier (origin «Proveedor»). */
  supplier?: { id: string; name: string };
}) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const membership = useMembership();
  const { account } = useAuth();
  const { state, set } = useNcForm(
    undefined,
    { id: membership.id, name: account?.user.name ?? "" },
    supplier === undefined ? "INTERNAL" : "SUPPLIER",
  );
  const save = useMutation({
    mutationFn: () =>
      qualityApi.create(workspaceSlug, {
        ...createBody(state),
        supplierId: supplier !== undefined && state.origin === "SUPPLIER" ? supplier.id : null,
      }),
    onSuccess: async ({ nc }) => {
      toast.success(texts.quality.form.created);
      onClose();
      await navigate(`/app/${workspaceSlug}/calidad/no-conformidades/${nc.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      size="lg"
      title={texts.quality.form.createTitle}
      {...(supplier === undefined ? {} : { description: supplier.name })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={!formReady(state, true) || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : texts.admin.common.create}
          </Button>
        </>
      }
    >
      <NcFields state={state} set={set} full />
    </DialogContent>
  );
}

/** «Comunicadas por mí»: the ones the person reported. */
export function ReportedNcsPage() {
  return <NcsPage reportedOnly />;
}

export function NcsPage({ reportedOnly = false }: { reportedOnly?: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const { manage, view } = useQuality();
  const { params, patch } = useListParams();
  const from = params.get("desde");
  const to = params.get("hasta");
  const filters = useMemo<NcFilters>(
    () => ({
      q: params.get("q") ?? undefined,
      status: STATUS_FILTERS.find((id) => id === params.get("estado")) ?? "open",
      origin: NC_ORIGINS.find((id) => id === params.get("origen")),
      severity: SEVERITIES.find((id) => id === params.get("gravedad")),
      owner: params.get("responsable") ?? undefined,
      from: from !== null && DAY.test(from) ? from : undefined,
      to: to !== null && DAY.test(to) ? to : undefined,
      mine: reportedOnly ? "reported" : undefined,
      sort: "createdAt",
      dir: "desc",
    }),
    [params, from, to, reportedOnly],
  );
  const statuses = useStaticSource(
    "quality-nc-status-filter",
    STATUS_FILTERS.map((id) => ({
      id,
      label: id === "open" ? t.statusOpen : id === "all" ? t.statusAll : texts.quality.statuses[id],
    })),
  );
  const origins = useStaticSource(
    "quality-nc-origin-filter",
    NC_ORIGINS.map((id) => ({ id, label: texts.quality.origins[id] })),
  );
  const severities = useStaticSource(
    "quality-nc-severity-filter",
    SEVERITIES.map((id) => ({ id, label: texts.quality.severities[id] })),
  );
  const people = usePeopleSource();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useSearchParam("q", filters.q ?? "", patch);
  const list = useInfiniteList<NcSummary>({
    queryKey: qualityKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => qualityApi.list(workspaceSlug, filters, cursor, signal),
  });
  const csv = useMutation({
    mutationFn: async () => {
      downloadBlobFile("no-conformidades.csv", await qualityApi.csv(workspaceSlug, filters));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const base = `/app/${workspaceSlug}/calidad/no-conformidades`;
  const columns = useMemo<ColumnDef<NcSummary>[]>(
    () => [
      {
        id: "nc",
        header: t.columns.title,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`${base}/${row.original.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.title}
            </Link>
            <p className="text-xs text-muted-foreground tabular-nums">{row.original.code}</p>
          </div>
        ),
      },
      {
        id: "severity",
        header: t.columns.severity,
        cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
      },
      {
        id: "status",
        header: t.columns.status,
        cell: ({ row }) => <NcStatusBadge status={row.original.status} />,
      },
      {
        id: "origin",
        header: t.columns.origin,
        cell: ({ row }) => texts.quality.origins[row.original.origin],
      },
      { id: "owner", header: t.columns.owner, cell: ({ row }) => row.original.owner.name },
      {
        id: "detected",
        header: t.columns.detected,
        cell: ({ row }) => formatUtcDate(row.original.detectedOn),
      },
      {
        id: "actions",
        header: t.columns.actions,
        cell: ({ row }) => (
          <span className={row.original.actions.overdue > 0 ? "text-danger" : undefined}>
            {t.actionsCount(row.original.actions.open, row.original.actions.total)}
          </span>
        ),
      },
    ],
    [base],
  );
  const filtered =
    filters.q !== undefined ||
    filters.status !== "open" ||
    filters.origin !== undefined ||
    filters.severity !== undefined ||
    filters.owner !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {filters.mine === "reported" ? texts.quality.nav.reported : t.title}
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view && (
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
          )}
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
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
          searchable={false}
          label={t.columns.status}
          placeholder={t.columns.status}
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
          label={t.columns.severity}
          placeholder={t.anySeverity}
          source={severities}
          value={filters.severity ?? null}
          onChange={(option) => {
            patch({ gravedad: option?.id });
          }}
        />
        <Combobox
          compact
          clearable
          searchable={false}
          label={t.columns.origin}
          placeholder={t.anyOrigin}
          source={origins}
          value={filters.origin ?? null}
          onChange={(option) => {
            patch({ origen: option?.id });
          }}
        />
        {view && (
          <Combobox
            compact
            clearable
            label={t.columns.owner}
            placeholder={t.anyOwner}
            source={people}
            value={filters.owner ?? null}
            onChange={(option) => {
              patch({ responsable: option?.id });
            }}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            aria-label={t.from}
            value={filters.from ?? ""}
            onChange={(event) => {
              patch({ desde: event.target.value });
            }}
          />
          <Input
            type="date"
            aria-label={t.to}
            value={filters.to ?? ""}
            onChange={(event) => {
              patch({ hasta: event.target.value });
            }}
          />
        </div>
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardX} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(nc) => nc.id}
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
          <CreateDialog
            onClose={() => {
              setCreating(false);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
