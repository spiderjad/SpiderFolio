// /app/:slug/calidad/retenido — product on hold (docs/spec/calidad.md, «Producto retenido»): what's on
// hold first, its nonconformity and the signed decision; quality.manage decides and puts product on hold
// without a nonconformity.
import type { ColumnDef } from "@tanstack/react-table";
import { PackageX, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog } from "@/components/ui/overlay";
import { useListParams } from "@/features/admin/list-params";
import { formatDateTime } from "@/lib/utils";
import { DecisionDialog, HoldDialog } from "./hold-dialogs";
import { haccpApi, haccpKeys, type Hold, type HoldStatus } from "./quality-api";
import { useQuality } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.holds;
const FILTERS = ["held", "decided", "all"] as const;

const statusTone = {
  HELD: "warning",
  RELEASED: "success",
  REWORKED: "primary",
  DIVERTED: "primary",
  DESTROYED: "danger",
} as const;

export function HoldStatusBadge({ status }: { status: HoldStatus }) {
  return <Badge tone={statusTone[status]}>{t.statuses[status]}</Badge>;
}

export function HoldsPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage } = useQuality();
  const { params, patch } = useListParams();
  const status = FILTERS.find((id) => id === params.get("estado")) ?? "held";
  const filters = useStaticSource(
    "quality-hold-filters",
    FILTERS.map((id) => ({ id, label: t.filters[id] })),
  );
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<Hold | null>(null);
  const list = useInfiniteList<Hold>({
    queryKey: haccpKeys.holds(workspaceSlug, status),
    fetchPage: (cursor, signal) => haccpApi.holds(workspaceSlug, status, cursor, signal),
  });
  const columns = useMemo<ColumnDef<Hold>[]>(
    () => [
      {
        id: "product",
        header: t.columns.product,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium">{row.original.product}</p>
            <p className="text-xs text-muted-foreground">
              {[row.original.quantity, row.original.location].filter(Boolean).join(" · ")}
            </p>
          </div>
        ),
      },
      { id: "lot", header: t.columns.lot, cell: ({ row }) => row.original.lot ?? "—" },
      {
        id: "nc",
        header: t.columns.nc,
        cell: ({ row }) =>
          row.original.nc === null ? (
            "—"
          ) : (
            <Link
              to={`/app/${workspaceSlug}/calidad/no-conformidades/${row.original.nc.id}`}
              className="text-sm tabular-nums underline-offset-4 hover:underline"
            >
              {row.original.nc.code}
            </Link>
          ),
      },
      {
        id: "status",
        header: t.columns.status,
        cell: ({ row }) => (
          <div className="grid gap-1">
            <HoldStatusBadge status={row.original.status} />
            {row.original.decision !== null && (
              <span className="text-xs text-muted-foreground">
                {t.decision.by(
                  row.original.decision.by.name,
                  formatDateTime(row.original.decision.at),
                )}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "since",
        header: t.columns.since,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: "decide",
        header: () => <span className="sr-only">{t.decide}</span>,
        cell: ({ row }) =>
          row.original.canDecide ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDeciding(row.original);
                }}
              >
                {t.decide}
              </Button>
            </div>
          ) : null,
      },
    ],
    [workspaceSlug],
  );
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
        <Combobox
          compact
          searchable={false}
          label={t.columns.status}
          placeholder={t.columns.status}
          source={filters}
          value={status}
          onChange={(option) => {
            patch({ estado: option?.id === "held" ? undefined : option?.id });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={PackageX}>{t.empty}</EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(hold) => hold.id}
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
          <HoldDialog
            ncId={null}
            onClose={() => {
              setCreating(false);
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={deciding !== null}
        onOpenChange={(open) => {
          if (!open) setDeciding(null);
        }}
      >
        {deciding !== null && (
          <DecisionDialog
            hold={deciding}
            onClose={() => {
              setDeciding(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
