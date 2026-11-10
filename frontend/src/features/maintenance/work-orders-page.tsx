// /app/:slug/mantenimiento/ot — work orders (docs/spec/mantenimiento.md, section 2): maintenance sees them
// all (the open ones by priority by default), a technician «mine», and whoever only reports sees what they
// reported. Filters live in the address.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock, Plus, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { formatShortDate, formatUtcDate } from "@/lib/utils";
import {
  PRIORITIES,
  WORK_KINDS,
  WORK_STATUSES,
  maintenanceApi,
  maintenanceKeys,
  type WorkOrderDetail,
  type WorkOrderFilters,
  type WorkOrderSummary,
} from "./maintenance-api";
import {
  PriorityBadge,
  StatusBadge,
  useAssetSource,
  useAssets,
  useMaintenance,
  useTechnicianSource,
} from "./maintenance-common";
import { texts } from "@/i18n";

const t = texts.maintenance.list;
const k = texts.maintenance;

export function WorkOrdersPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage, work, view } = useMaintenance();
  const { params, patch } = useListParams();
  const filters = useMemo<WorkOrderFilters>(() => {
    const estado = params.get("estado");
    return {
      estado: estado === "open" ? "open" : WORK_STATUSES.find((status) => status === estado),
      prioridad: PRIORITIES.find((value) => value === params.get("prioridad")),
      tipo: WORK_KINDS.find((value) => value === params.get("tipo")),
      equipo: params.get("equipo") ?? undefined,
      mias: params.get("mias") === "1" ? "1" : undefined,
      q: params.get("q") ?? undefined,
    };
  }, [params]);
  const [search, setSearch] = useSearchParam("q", filters.q ?? "", patch);
  const [creating, setCreating] = useState(false);
  const statuses = useStaticSource("maintenance-statuses", [
    { id: "open", label: t.open },
    ...WORK_STATUSES.map((id) => ({ id, label: k.statuses[id] })),
  ]);
  const priorities = useStaticSource(
    "maintenance-priorities",
    PRIORITIES.map((id) => ({ id, label: k.priorities[id] })),
  );
  const list = useInfiniteList<WorkOrderSummary>({
    queryKey: maintenanceKeys.workOrders(workspaceSlug, filters),
    fetchPage: (cursor, signal) =>
      maintenanceApi.workOrders(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<WorkOrderSummary>[]>(
    () => [
      {
        id: "order",
        header: t.columns.order,
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-0.5">
            <Link
              to={`/app/${workspaceSlug}/mantenimiento/ot/${row.original.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.title}
            </Link>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="tabular-nums">{row.original.code}</span>·
              <span>{formatShortDate(row.original.reportedAt)}</span>·
              <span>{k.kinds[row.original.kind]}</span>
              {row.original.lockout && (
                <Badge tone="warning">
                  <Lock className="mr-1 inline size-3" aria-hidden="true" />
                  {t.lockout}
                </Badge>
              )}
            </span>
          </div>
        ),
      },
      {
        id: "asset",
        header: t.columns.asset,
        cell: ({ row }) =>
          row.original.asset === null ? (
            k.common.none
          ) : (
            <span>
              <span className="font-medium tabular-nums">{row.original.asset.code}</span>{" "}
              <span className="text-muted-foreground">{row.original.asset.name}</span>
            </span>
          ),
      },
      {
        id: "status",
        header: t.columns.status,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <PriorityBadge priority={row.original.priority} />
            <StatusBadge status={row.original.status} />
          </div>
        ),
      },
      {
        id: "assigned",
        header: t.columns.assigned,
        cell: ({ row }) => row.original.assignedTo?.name ?? k.common.none,
      },
      {
        id: "due",
        header: t.columns.due,
        cell: ({ row }) =>
          row.original.dueOn === null ? k.common.none : formatUtcDate(row.original.dueOn),
      },
    ],
    [workspaceSlug],
  );
  const title = filters.mias === "1" ? t.mineTitle : t.title;
  const subtitle = !view ? t.reporterSubtitle : filters.mias === "1" ? t.mineSubtitle : t.subtitle;
  const filtered =
    filters.prioridad !== undefined ||
    filters.tipo !== undefined ||
    filters.equipo !== undefined ||
    (filters.q !== undefined && filters.q !== "");
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {work && filters.mias !== "1" && (
            <Button
              variant="outline"
              onClick={() => {
                patch({ mias: "1", estado: "open" });
              }}
            >
              {k.nav.mine}
            </Button>
          )}
          {manage && (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.new}
            </Button>
          )}
        </div>
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
          value={filters.estado ?? null}
          onChange={(option) => {
            patch({ estado: option?.id });
          }}
        />
        <Combobox
          searchable={false}
          clearable
          label={k.form.priority}
          placeholder={t.allPriorities}
          source={priorities}
          value={filters.prioridad ?? null}
          onChange={(option) => {
            patch({ prioridad: option?.id });
          }}
        />
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={Wrench} title={filtered ? t.emptyFiltered : t.empty}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={title}
            columns={columns}
            data={list.items}
            getRowId={(row) => row.id}
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
      {creating && (
        <WorkOrderDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

/** Create a work order (maintenance.manage), or edit one. */
export function WorkOrderDialog({
  workOrder,
  onClose,
}: {
  workOrder?: WorkOrderDetail | undefined;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const f = texts.maintenance.form;
  const assets = useAssets();
  const assetSource = useAssetSource("dialog", assets.data ?? []);
  const technicians = useTechnicianSource();
  const kinds = useStaticSource(
    "maintenance-kinds",
    WORK_KINDS.map((id) => ({ id, label: k.kinds[id] })),
  );
  const priorities = useStaticSource(
    "maintenance-dialog-priorities",
    PRIORITIES.map((id) => ({ id, label: k.priorities[id] })),
  );
  const [state, setState] = useState({
    title: workOrder?.title ?? "",
    description: workOrder?.description ?? "",
    assetId: workOrder?.asset?.id ?? null,
    kind: workOrder?.kind ?? "CORRECTIVE",
    priority: workOrder?.priority ?? "NORMAL",
    assigned: workOrder?.assignedTo ?? null,
    dueOn: workOrder?.dueOn ?? "",
    lockout: workOrder?.lockout ?? false,
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: state.title.trim(),
        description: state.description.trim(),
        assetId: state.assetId,
        kind: state.kind,
        priority: state.priority,
        assignedToId: state.assigned?.id ?? null,
        dueOn: state.dueOn === "" ? null : state.dueOn,
        lockout: state.lockout,
      };
      return workOrder === undefined
        ? maintenanceApi.createWorkOrder(workspaceSlug, body)
        : maintenanceApi.updateWorkOrder(workspaceSlug, workOrder.id, body);
    },
    onSuccess: async ({ workOrder: saved }) => {
      toast.success(workOrder === undefined ? k.common.created : k.common.saved);
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
      onClose();
      if (workOrder === undefined) {
        await navigate(`/app/${workspaceSlug}/mantenimiento/ot/${saved.id}`);
      }
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={workOrder === undefined ? f.newTitle : f.editTitle}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={save.isPending}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={state.title.trim() === "" || save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {save.isPending ? texts.admin.common.saving : texts.admin.common.save}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <FormField label={f.title}>
            {(control) => (
              <Input
                {...control}
                maxLength={160}
                value={state.title}
                onChange={(event) => {
                  set({ title: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.asset}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={f.asset}
                placeholder={f.assetPlaceholder}
                source={assetSource}
                value={state.assetId}
                onChange={(option) => {
                  set({ assetId: option?.id ?? null });
                }}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
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
                    const kind = WORK_KINDS.find((id) => id === option?.id);
                    if (kind !== undefined) set({ kind });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.priority}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  searchable={false}
                  label={f.priority}
                  placeholder={f.priority}
                  source={priorities}
                  value={state.priority}
                  onChange={(option) => {
                    const priority = PRIORITIES.find((id) => id === option?.id);
                    if (priority !== undefined) set({ priority });
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.assigned}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  label={f.assigned}
                  placeholder={f.assignedPlaceholder}
                  source={technicians}
                  value={state.assigned?.id ?? null}
                  valueLabel={state.assigned?.name}
                  onChange={(option) => {
                    set({
                      assigned: option === null ? null : { id: option.id, name: option.label },
                    });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.dueOn}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={state.dueOn}
                  onChange={(event) => {
                    set({ dueOn: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>
          <FormField label={f.description}>
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
          <Checkbox
            label={f.lockout}
            checked={state.lockout}
            onChange={(event) => {
              set({ lockout: event.target.checked });
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
