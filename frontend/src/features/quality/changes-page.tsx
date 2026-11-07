// /app/:slug/calidad/cambios — change management (docs/spec/calidad.md, «Fase 6c»): what's proposed, approved
// or implemented, with its HACCP review. Anyone active (not a guest) proposes a change and sees the ones they
// proposed or are in charge of; quality.view sees them all. The filters live in the address.
import type { ColumnDef } from "@tanstack/react-table";
import { GitPullRequestArrow, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { formatUtcDate } from "@/lib/utils";
import {
  CHANGE_IMPACTS,
  CHANGE_KINDS,
  CHANGE_STATUSES,
  changeKeys,
  changesApi,
  type ChangeDetail,
  type ChangeFilters,
  type ChangeStatus,
  type ChangeSummary,
} from "./culture-api";
import { qualityKeys } from "./quality-api";
import { usePeopleSource, useQuality } from "./quality-common";
import { useProductSource } from "./sampling-page";
import { texts } from "@/i18n";

const t = texts.quality.changes;

const statusTone = {
  PROPOSED: "warning",
  APPROVED: "primary",
  REJECTED: "danger",
  IMPLEMENTED: "success",
  CANCELLED: "neutral",
} as const;

export function ChangeStatusBadge({ status }: { status: ChangeStatus }) {
  return <Badge tone={statusTone[status]}>{t.statuses[status]}</Badge>;
}

/** Propose a change (anyone) or, with quality.manage, edit it with its owner and impact. */
export function ChangeDialog({
  change,
  onClose,
}: {
  change?: ChangeDetail | undefined;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { view } = useQuality();
  const f = t.form;
  const people = usePeopleSource();
  const products = useProductSource();
  const kinds = useStaticSource(
    "quality-change-kinds",
    CHANGE_KINDS.map((id) => ({ id, label: t.kinds[id] })),
  );
  const impacts = useStaticSource(
    "quality-change-impacts",
    CHANGE_IMPACTS.map((id) => ({ id, label: t.impacts[id] })),
  );
  const [state, setState] = useState({
    title: change?.title ?? "",
    kind: change?.kind ?? "RECIPE",
    description: change?.description ?? "",
    product: change?.product ?? null,
    plannedOn: change?.plannedOn ?? "",
    owner: change?.owner ?? null,
    impact: change?.impact ?? null,
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: state.title.trim(),
        kind: state.kind,
        description: state.description.trim(),
        productId: state.product?.id ?? null,
        plannedOn: state.plannedOn === "" ? null : state.plannedOn,
      };
      return change === undefined
        ? changesApi.propose(workspaceSlug, body)
        : changesApi.update(workspaceSlug, change.id, {
            ...body,
            ownerId: state.owner?.id ?? null,
            impact: state.impact,
          });
    },
    onSuccess: async ({ change: saved }) => {
      toast.success(change === undefined ? f.proposed : f.saved);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: changeKeys.all(workspaceSlug) }),
        queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) }),
      ]);
      onClose();
      if (change === undefined) await navigate(`/app/${workspaceSlug}/calidad/cambios/${saved.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = state.title.trim() !== "";
  return (
    <DialogContent
      size="lg"
      title={change === undefined ? f.title : f.editTitle}
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
            {save.isPending
              ? texts.admin.common.saving
              : change === undefined
                ? t.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <FormField label={f.name}>
            {(control) => (
              <Input
                {...control}
                maxLength={160}
                placeholder={f.namePlaceholder}
                value={state.title}
                onChange={(event) => {
                  set({ title: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.kind}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.kind}
                placeholder={f.kind}
                source={kinds}
                value={state.kind}
                onChange={(option) => {
                  const next = CHANGE_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) set({ kind: next });
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.description} hint={f.descriptionHint}>
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              maxLength={4000}
              value={state.description}
              onChange={(event) => {
                set({ description: event.target.value });
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          {view && (
            <FormField label={f.product}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  label={f.product}
                  placeholder={f.productPlaceholder}
                  source={products}
                  value={state.product?.id ?? null}
                  valueLabel={state.product?.name}
                  onChange={(option) => {
                    set({
                      product: option === null ? null : { id: option.id, name: option.label },
                    });
                  }}
                />
              )}
            </FormField>
          )}
          <FormField label={f.plannedOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={state.plannedOn}
                onChange={(event) => {
                  set({ plannedOn: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        {change !== undefined && (
          <div className="grid gap-4 sm:grid-cols-2">
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
            <FormField label={f.impact}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  searchable={false}
                  clearable
                  label={f.impact}
                  placeholder={f.impactPlaceholder}
                  source={impacts}
                  value={state.impact}
                  onChange={(option) => {
                    set({ impact: CHANGE_IMPACTS.find((id) => id === option?.id) ?? null });
                  }}
                />
              )}
            </FormField>
          </div>
        )}
      </FormGrid>
    </DialogContent>
  );
}

export function ChangesPage() {
  const { workspaceSlug = "" } = useParams();
  const { view } = useQuality();
  const { params, patch } = useListParams();
  const filters = useMemo<ChangeFilters>(
    () => ({
      q: params.get("q") ?? undefined,
      status: CHANGE_STATUSES.find((status) => status === params.get("estado")),
      kind: CHANGE_KINDS.find((kind) => kind === params.get("tipo")),
    }),
    [params],
  );
  const [search, setSearch] = useSearchParam("q", filters.q ?? "", patch);
  const [creating, setCreating] = useState(false);
  const statuses = useStaticSource(
    "quality-change-statuses",
    CHANGE_STATUSES.map((id) => ({ id, label: t.statuses[id] })),
  );
  const kinds = useStaticSource(
    "quality-change-kinds",
    CHANGE_KINDS.map((id) => ({ id, label: t.kinds[id] })),
  );
  const list = useInfiniteList<ChangeSummary>({
    queryKey: changeKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => changesApi.list(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<ChangeSummary>[]>(
    () => [
      {
        id: "change",
        header: t.columns.change,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/app/${workspaceSlug}/calidad/cambios/${row.original.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.title}
            </Link>
            <p className="truncate text-xs tabular-nums text-muted-foreground">
              {row.original.code} · {row.original.proposedBy.name}
            </p>
          </div>
        ),
      },
      { id: "kind", header: t.columns.kind, cell: ({ row }) => t.kinds[row.original.kind] },
      {
        id: "status",
        header: t.columns.status,
        cell: ({ row }) => (
          <div className="grid justify-items-start gap-1">
            <ChangeStatusBadge status={row.original.status} />
            {(row.original.status === "PROPOSED" || row.original.status === "APPROVED") && (
              <span className="text-xs text-muted-foreground">
                {t.pendingPoints(row.original.pending)}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "planned",
        header: t.columns.planned,
        cell: ({ row }) => (
          <div className="grid gap-1">
            <span className="whitespace-nowrap tabular-nums">
              {row.original.plannedOn === null ? "—" : formatUtcDate(row.original.plannedOn)}
            </span>
            {row.original.overdue && <span className="text-xs text-danger">{t.overdue}</span>}
          </div>
        ),
      },
      {
        id: "owner",
        header: t.columns.owner,
        cell: ({ row }) => row.original.owner?.name ?? "—",
      },
    ],
    [workspaceSlug],
  );
  const filtered =
    filters.q !== undefined || filters.status !== undefined || filters.kind !== undefined;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            {view ? t.subtitle : t.subtitleMine}
          </p>
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
      <div className="grid gap-3 sm:grid-cols-3">
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
        <Combobox
          searchable={false}
          clearable
          label={t.columns.kind}
          placeholder={t.allKinds}
          source={kinds}
          value={filters.kind ?? null}
          onChange={(option) => {
            patch({ tipo: option?.id });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={GitPullRequestArrow}
            title={filtered ? t.emptyFiltered : view ? t.empty.title : t.emptyMine}
          >
            {filtered || !view ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(change) => change.id}
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
          <ChangeDialog
            onClose={() => {
              setCreating(false);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
