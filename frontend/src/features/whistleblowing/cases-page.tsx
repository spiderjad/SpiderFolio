// /app/:slug/canal — the whistleblowing channel's cases (docs/spec/canal-denuncias.md): only for its
// managers (the server answers 404 to anyone else). The list has no content: number, category, status
// and the answer deadline. The filters live in the address.
import type { ColumnDef } from "@tanstack/react-table";
import { Megaphone } from "lucide-react";
import { useMemo } from "react";
import { Link, Outlet, useParams } from "react-router";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { useInfiniteList } from "@/components/ui/infinite";
import { useListParams } from "@/features/admin/list-params";
import { useMembership } from "@/features/home/workspace-layout";
import { NotFoundPage } from "@/features/home/not-found-page";
import { formatShortDate, formatUtcDate } from "@/lib/utils";
import {
  CASE_STATUSES,
  channelApi,
  channelKeys,
  type CaseStatus,
  type CaseSummary,
  type CasesFilters,
} from "./whistleblowing-api";
import { texts } from "@/i18n";

const t = texts.whistleblowing.cases;
const w = texts.whistleblowing;

/** The channel's screens exist only for its managers. */
export function RequireChannelManager() {
  return useMembership().workspace.whistleblowing.manager ? <Outlet /> : <NotFoundPage />;
}

const statusTone = {
  RECEIVED: "warning",
  ADMITTED: "primary",
  NOT_ADMITTED: "neutral",
  INVESTIGATING: "primary",
  CLOSED: "success",
} as const;

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return <Badge tone={statusTone[status]}>{w.statuses[status]}</Badge>;
}

const OPEN: CaseStatus[] = ["RECEIVED", "ADMITTED", "INVESTIGATING"];

/** Days from today (the browser's day) to «YYYY-MM-DD»; negative once it's past. */
function daysTo(day: string): number {
  const today = new Date();
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.parse(`${day}T00:00:00Z`) - start) / 86_400_000);
}

export function DueText({ dueOn, status }: { dueOn: string; status: CaseStatus }) {
  const days = daysTo(dueOn);
  const open = OPEN.includes(status);
  return (
    <div className="grid gap-0.5">
      <span className="whitespace-nowrap tabular-nums">{formatUtcDate(dueOn)}</span>
      {open && days < 0 && <span className="text-xs text-danger">{t.overdue}</span>}
      {open && days >= 0 && days <= 30 && (
        <span
          className={days <= 7 ? "text-xs text-danger" : "text-xs text-warning-soft-foreground"}
        >
          {t.dueSoon(Math.max(days, 1))}
        </span>
      )}
    </div>
  );
}

export function CasesPage() {
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const filters = useMemo<CasesFilters>(
    () => ({
      status: CASE_STATUSES.find((status) => status === params.get("estado")),
      ...(params.get("orden") === "plazo" ? { sort: "dueOn" as const, dir: "asc" as const } : {}),
    }),
    [params],
  );
  const statuses = useStaticSource(
    "channel-statuses",
    CASE_STATUSES.map((id) => ({ id, label: w.statuses[id] })),
  );
  const list = useInfiniteList<CaseSummary>({
    queryKey: channelKeys.cases(workspaceSlug, filters),
    fetchPage: (cursor, signal) => channelApi.cases(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<CaseSummary>[]>(
    () => [
      {
        id: "case",
        header: t.columns.case,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/app/${workspaceSlug}/canal/${row.original.id}`}
              className="font-medium tabular-nums underline-offset-4 hover:underline"
            >
              {row.original.code}
            </Link>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {formatShortDate(row.original.receivedAt)} ·{" "}
              {row.original.anonymous ? t.anonymous : t.identified}
              {row.original.unread && <Badge tone="primary">{t.unread}</Badge>}
            </p>
          </div>
        ),
      },
      { id: "category", header: t.columns.category, cell: ({ row }) => row.original.category },
      {
        id: "status",
        header: t.columns.status,
        cell: ({ row }) => <CaseStatusBadge status={row.original.status} />,
      },
      {
        id: "due",
        header: t.columns.due,
        cell: ({ row }) => <DueText dueOn={row.original.dueOn} status={row.original.status} />,
      },
    ],
    [workspaceSlug],
  );
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Combobox
          searchable={false}
          clearable
          label={t.columns.status}
          placeholder={t.allStatuses}
          source={statuses}
          value={filters.status ?? null}
          onChange={(option) => {
            patch({ estado: option?.id });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title={filters.status === undefined ? t.empty : t.emptyFiltered}
          >
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(item) => item.id}
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
    </div>
  );
}
