// /app/:slug/medio-ambiente/residuos — waste and animal by-products (docs/spec/medio-ambiente.md,
// section 2): the collections (the chronological record, exportable), the waste catalog and the waste
// managers and carriers. environment.record records collections; environment.manage the rest.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Pencil, Plus, Recycle, Trash2, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { cn, formatUtcDate } from "@/lib/utils";
import {
  SANDACH,
  UNITS,
  environmentApi,
  environmentKeys,
  type Contractor,
  type ExportKind,
  type Movement,
  type MovementFilters,
  type Unit,
  type Waste,
} from "./environment-api";
import { DueDate, FolderLink, orNull, useEnvironment } from "./environment-common";
import { texts } from "@/i18n";

const t = texts.environment.waste;
const c = texts.environment.common;
const e = texts.environment;

type Tab = "movements" | "catalog" | "contractors";
const TAB_PARAM: Record<Tab, string | undefined> = {
  movements: undefined,
  catalog: "catalogo",
  contractors: "gestores",
};

export function WastePage() {
  const { manage, view } = useEnvironment();
  const [params, setParams] = useSearchParams();
  const tab: Tab =
    params.get("pestana") === "catalogo"
      ? "catalog"
      : params.get("pestana") === "gestores"
        ? "contractors"
        : "movements";
  const tabs: Tab[] = view ? ["movements", "catalog", "contractors"] : ["movements"];
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      {tabs.length > 1 && (
        <div role="tablist" className="flex gap-1 border-b border-border">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                tab === id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                const next = new URLSearchParams();
                const value = TAB_PARAM[id];
                if (value !== undefined) next.set("pestana", value);
                setParams(next, { replace: true });
              }}
            >
              {t.tabs[id]}
            </button>
          ))}
        </div>
      )}
      {tab === "catalog" && view ? (
        <Catalog manage={manage} />
      ) : tab === "contractors" && view ? (
        <Contractors manage={manage} />
      ) : (
        <Movements />
      )}
    </div>
  );
}

function useInvalidate() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: environmentKeys.all(workspaceSlug) });
  };
}

function useCatalog(archived = false) {
  const { workspaceSlug = "" } = useParams();
  const wastes = useQuery({
    queryKey: environmentKeys.wastes(workspaceSlug, archived),
    queryFn: () => environmentApi.wastes(workspaceSlug, archived),
    select: (data) => data.wastes,
  });
  const contractors = useQuery({
    queryKey: environmentKeys.contractors(workspaceSlug, archived),
    queryFn: () => environmentApi.contractors(workspaceSlug, archived),
    select: (data) => data.contractors,
  });
  return { wastes, contractors };
}

function Footer({
  busy,
  ready,
  onSave,
  extra,
}: {
  busy: boolean;
  ready: boolean;
  onSave: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      {extra ?? <span />}
      <div className="flex gap-2">
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            {texts.admin.common.cancel}
          </Button>
        </DialogClose>
        <Button disabled={!ready || busy} onClick={onSave}>
          {busy ? texts.admin.common.saving : texts.admin.common.save}
        </Button>
      </div>
    </div>
  );
}

// ─── Collections ────────────────────────────────────────────────────────────────────────────

function Movements() {
  const { workspaceSlug = "" } = useParams();
  const { manage, view, record } = useEnvironment();
  const { params, patch } = useListParams();
  const filters = useMemo<MovementFilters>(
    () => ({
      residuo: params.get("residuo") ?? undefined,
      desde: params.get("desde") ?? undefined,
      hasta: params.get("hasta") ?? undefined,
      sandach: params.get("sandach") === "1" ? "1" : undefined,
    }),
    [params],
  );
  const { wastes } = useCatalog();
  const wasteSource = useStaticSource(
    "environment-movement-wastes",
    (wastes.data ?? []).map((waste) => ({ id: waste.id, label: `${waste.name} · ${waste.ler}` })),
  );
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Movement | null>(null);
  const invalidate = useInvalidate();
  const list = useInfiniteList<Movement>({
    queryKey: environmentKeys.movements(workspaceSlug, filters),
    fetchPage: (cursor, signal) => environmentApi.movements(workspaceSlug, filters, cursor, signal),
  });
  const remove = useMutation({
    mutationFn: (id: string) => environmentApi.deleteMovement(workspaceSlug, id),
    onSuccess: async () => {
      setDeleting(null);
      toast.success(t.movements.deleted);
      await invalidate();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const download = useMutation({
    mutationFn: async ({ kind, format }: { kind: ExportKind; format: "csv" | "pdf" }) => {
      const from = filters.desde ?? "";
      const to = filters.hasta ?? "";
      const blob = await environmentApi.exportFile(workspaceSlug, kind, format, from, to);
      return { blob, name: `${kind}-${from}-${to}.${format}` };
    },
    onSuccess: ({ blob, name }) => {
      downloadBlobFile(name, blob);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const columns = useMemo<ColumnDef<Movement>[]>(
    () => [
      {
        id: "date",
        header: t.movements.columns.date,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">{formatUtcDate(row.original.date)}</span>
        ),
      },
      {
        id: "waste",
        header: t.movements.columns.waste,
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-0.5">
            <span className="font-medium">{row.original.waste.name}</span>
            <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span className="tabular-nums">{row.original.waste.ler}</span>
              {row.original.waste.hazardous && <Badge tone="warning">{t.catalog.hazardous}</Badge>}
              {row.original.waste.sandach !== null && (
                <Badge tone="primary">{e.sandach[row.original.waste.sandach]}</Badge>
              )}
            </span>
          </div>
        ),
      },
      {
        id: "quantity",
        header: t.movements.columns.quantity,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.quantity.toLocaleString()} {e.units[row.original.unit]}
          </span>
        ),
      },
      {
        id: "manager",
        header: t.movements.columns.manager,
        cell: ({ row }) => (
          <div className="grid gap-0.5">
            <span>{row.original.manager?.name ?? c.none}</span>
            {row.original.carrier !== null && (
              <span className="text-xs text-muted-foreground">{row.original.carrier.name}</span>
            )}
          </div>
        ),
      },
      {
        id: "document",
        header: t.movements.columns.document,
        cell: ({ row }) => (
          <div className="grid gap-0.5">
            <span className="tabular-nums">{row.original.documentRef || c.none}</span>
            <span className="text-xs text-muted-foreground">{row.original.recordedBy}</span>
          </div>
        ),
      },
      ...(manage
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }: { row: { original: Movement } }) => (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`${t.movements.delete}: ${row.original.waste.name}`}
                  onClick={() => {
                    setDeleting(row.original);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              ),
            } satisfies ColumnDef<Movement>,
          ]
        : []),
    ],
    [manage],
  );
  const filtered =
    filters.residuo !== undefined ||
    filters.desde !== undefined ||
    filters.hasta !== undefined ||
    filters.sandach !== undefined;
  const period = filters.desde !== undefined && filters.hasta !== undefined;
  const x = t.movements.exports;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
          <Combobox
            clearable
            label={t.movements.columns.waste}
            placeholder={t.movements.allWastes}
            source={wasteSource}
            value={filters.residuo ?? null}
            onChange={(option) => {
              patch({ residuo: option?.id });
            }}
          />
          <Input
            type="date"
            aria-label={t.movements.from}
            title={t.movements.from}
            value={filters.desde ?? ""}
            onChange={(event) => {
              patch({ desde: event.target.value === "" ? undefined : event.target.value });
            }}
          />
          <Input
            type="date"
            aria-label={t.movements.to}
            title={t.movements.to}
            value={filters.hasta ?? ""}
            onChange={(event) => {
              patch({ hasta: event.target.value === "" ? undefined : event.target.value });
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            label={t.movements.onlySandach}
            checked={filters.sandach === "1"}
            onChange={(event) => {
              patch({ sandach: event.target.checked ? "1" : undefined });
            }}
          />
          {view && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={download.isPending}>
                  <Download className="size-4" aria-hidden="true" />
                  {t.movements.export}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {!period && (
                  <DropdownMenuLabel className="text-xs font-normal">
                    {x.needsPeriod}
                  </DropdownMenuLabel>
                )}
                {(["chronological", "sandach", "annual"] as const).map((kind) =>
                  (["pdf", "csv"] as const).map((format) => (
                    <DropdownMenuItem
                      key={`${kind}-${format}`}
                      disabled={!period}
                      onSelect={() => {
                        download.mutate({ kind, format });
                      }}
                    >
                      {x[kind]} · {x[format]}
                    </DropdownMenuItem>
                  )),
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {record && (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.movements.new}
            </Button>
          )}
        </div>
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={filtered ? t.movements.emptyFiltered : t.movements.empty}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.tabs.movements}
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
        <MovementDialog
          wastes={wastes.data ?? []}
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        icon={Trash2}
        tone="destructive"
        title={t.movements.deleteTitle}
        description={t.movements.deleteText}
        confirmLabel={t.movements.delete}
        pendingLabel={texts.admin.common.saving}
        onConfirm={async () => {
          if (deleting !== null) await remove.mutateAsync(deleting.id).catch(() => undefined);
        }}
      />
    </>
  );
}

function MovementDialog({ wastes, onClose }: { wastes: Waste[]; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const invalidate = useInvalidate();
  const { contractors } = useCatalog();
  const f = t.movements.form;
  const today = new Date().toISOString().slice(0, 10);
  const wasteSource = useStaticSource(
    "environment-dialog-wastes",
    wastes.map((waste) => ({ id: waste.id, label: `${waste.name} · ${waste.ler}` })),
  );
  const unitSource = useStaticSource(
    "environment-units",
    UNITS.map((id) => ({ id, label: e.units[id] })),
  );
  const managers = useStaticSource(
    "environment-managers",
    (contractors.data ?? [])
      .filter((item) => item.isManager)
      .map((item) => ({ id: item.id, label: item.name })),
  );
  const carriers = useStaticSource(
    "environment-carriers",
    (contractors.data ?? [])
      .filter((item) => item.isCarrier)
      .map((item) => ({ id: item.id, label: item.name })),
  );
  const [state, setState] = useState({
    wasteId: null as string | null,
    date: today,
    quantity: "",
    unit: "KG" as Unit,
    managerId: null as string | null,
    carrierId: null as string | null,
    documentRef: "",
    vehicle: "",
    notes: "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const quantity = Number(state.quantity.replace(",", "."));
  const save = useMutation({
    mutationFn: () =>
      environmentApi.createMovement(workspaceSlug, {
        wasteId: state.wasteId ?? "",
        date: state.date,
        quantity,
        unit: state.unit,
        managerId: state.managerId,
        carrierId: state.carrierId,
        documentRef: state.documentRef.trim(),
        vehicle: state.vehicle.trim(),
        notes: state.notes.trim(),
      }),
    onSuccess: async () => {
      toast.success(f.saved);
      await invalidate();
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready =
    state.wasteId !== null && state.date !== "" && Number.isFinite(quantity) && quantity > 0;
  const chosen = wastes.find((waste) => waste.id === state.wasteId);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={f.title}
        footer={
          <Footer
            busy={save.isPending}
            ready={ready}
            onSave={() => {
              save.mutate();
            }}
          />
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <FormField label={f.waste}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  label={f.waste}
                  placeholder={f.wastePlaceholder}
                  source={wasteSource}
                  value={state.wasteId}
                  onChange={(option) => {
                    set({ wasteId: option?.id ?? null });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.date}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={today}
                  value={state.date}
                  onChange={(event) => {
                    set({ date: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.quantity}>
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={state.quantity}
                  onChange={(event) => {
                    set({ quantity: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.unit}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  searchable={false}
                  label={f.unit}
                  placeholder={f.unit}
                  source={unitSource}
                  value={state.unit}
                  onChange={(option) => {
                    const unit = UNITS.find((id) => id === option?.id);
                    if (unit !== undefined) set({ unit });
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.manager} hint={chosen?.manager?.name ?? f.managerHint}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  searchable={false}
                  label={f.manager}
                  placeholder={chosen?.manager?.name ?? f.manager}
                  source={managers}
                  value={state.managerId}
                  onChange={(option) => {
                    set({ managerId: option?.id ?? null });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.carrier}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  searchable={false}
                  label={f.carrier}
                  placeholder={chosen?.carrier?.name ?? f.carrier}
                  source={carriers}
                  value={state.carrierId}
                  onChange={(option) => {
                    set({ carrierId: option?.id ?? null });
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <FormField label={f.documentRef}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  value={state.documentRef}
                  onChange={(event) => {
                    set({ documentRef: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.vehicle}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  value={state.vehicle}
                  onChange={(event) => {
                    set({ vehicle: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>
          <FormField label={f.notes}>
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={4000}
                value={state.notes}
                onChange={(event) => {
                  set({ notes: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Catalog ────────────────────────────────────────────────────────────────────────────────

function ArchivedSwitch({
  archived,
  onChange,
}: {
  archived: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="v-segmented" role="tablist">
      {[false, true].map((value) => (
        <button
          key={String(value)}
          type="button"
          role="tab"
          aria-selected={archived === value}
          className="v-segmented__item"
          onClick={() => {
            onChange(value);
          }}
        >
          {value ? c.archived : c.active}
        </button>
      ))}
    </div>
  );
}

function Catalog({ manage }: { manage: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const [archived, setArchived] = useState(false);
  const { wastes, contractors } = useCatalog(archived);
  const active = useCatalog(false);
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<Waste | "new" | null>(null);
  const template = useMutation({
    mutationFn: () => environmentApi.loadTemplate(workspaceSlug),
    onSuccess: async ({ added }) => {
      toast.success(t.catalog.templateDone(added));
      await invalidate();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const columns = useMemo<ColumnDef<Waste>[]>(
    () => [
      {
        id: "name",
        header: t.catalog.columns.name,
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            <span className="flex flex-wrap gap-1">
              {row.original.hazardous && <Badge tone="warning">{t.catalog.hazardous}</Badge>}
              {row.original.sandach !== null && (
                <Badge tone="primary">{e.sandach[row.original.sandach]}</Badge>
              )}
              {row.original.operation !== "" && <Badge>{row.original.operation}</Badge>}
            </span>
          </div>
        ),
      },
      {
        id: "ler",
        header: t.catalog.columns.ler,
        cell: ({ row }) => <span className="tabular-nums">{row.original.ler}</span>,
      },
      {
        id: "manager",
        header: t.catalog.columns.manager,
        cell: ({ row }) => row.original.manager?.name ?? c.none,
      },
      {
        id: "storage",
        header: t.catalog.columns.storage,
        cell: ({ row }) =>
          row.original.storageSince === null ? (
            c.none
          ) : (
            <div className="grid gap-0.5">
              <span className="tabular-nums">{formatUtcDate(row.original.storageSince)}</span>
              <DueDate day={row.original.storageUntil} warnDays={30} />
            </div>
          ),
      },
      ...(manage
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }: { row: { original: Waste } }) => (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`${c.edit}: ${row.original.name}`}
                  onClick={() => {
                    setEditing(row.original);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              ),
            } satisfies ColumnDef<Waste>,
          ]
        : []),
    ],
    [manage],
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ArchivedSwitch archived={archived} onChange={setArchived} />
        {manage && !archived && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={template.isPending}
              onClick={() => {
                template.mutate();
              }}
            >
              {t.catalog.template}
            </Button>
            <Button
              onClick={() => {
                setEditing("new");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.catalog.new}
            </Button>
          </div>
        )}
      </div>
      {!wastes.isPending && (wastes.data ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={Recycle} title={t.catalog.empty}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.tabs.catalog}
            columns={columns}
            data={wastes.data ?? []}
            getRowId={(row) => row.id}
            loading={wastes.isPending}
          />
        </Card>
      )}
      {editing !== null && (
        <WasteDialog
          waste={editing === "new" ? undefined : editing}
          contractors={active.contractors.data ?? contractors.data ?? []}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function WasteDialog({
  waste,
  contractors,
  onClose,
}: {
  waste?: Waste | undefined;
  contractors: Contractor[];
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const invalidate = useInvalidate();
  const f = t.catalog.form;
  const sandachSource = useStaticSource(
    "environment-sandach",
    SANDACH.map((id) => ({ id, label: e.sandach[id] })),
  );
  const managers = useStaticSource(
    "environment-waste-managers",
    contractors.filter((item) => item.isManager).map((item) => ({ id: item.id, label: item.name })),
  );
  const carriers = useStaticSource(
    "environment-waste-carriers",
    contractors.filter((item) => item.isCarrier).map((item) => ({ id: item.id, label: item.name })),
  );
  const [state, setState] = useState({
    name: waste?.name ?? "",
    ler: waste?.ler ?? "",
    sandach: waste?.sandach ?? null,
    operation: waste?.operation ?? "",
    managerId: waste?.manager?.id ?? null,
    carrierId: waste?.carrier?.id ?? null,
    contractRef: waste?.contractRef ?? "",
    maxStorageMonths: waste === undefined ? "" : String(waste.maxStorageMonths),
    storageSince: waste?.storageSince ?? "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const months =
    state.maxStorageMonths.trim() === "" ? null : Number.parseInt(state.maxStorageMonths, 10);
  const save = useMutation({
    mutationFn: (archived?: boolean) => {
      const body = {
        name: state.name.trim(),
        ler: state.ler.trim(),
        sandach: state.sandach,
        operation: state.operation.trim(),
        managerId: state.managerId,
        carrierId: state.carrierId,
        contractRef: state.contractRef.trim(),
        maxStorageMonths: months,
        storageSince: orNull(state.storageSince),
      };
      return waste === undefined
        ? environmentApi.createWaste(workspaceSlug, body)
        : environmentApi.updateWaste(workspaceSlug, waste.id, {
            ...body,
            ...(archived === undefined ? {} : { archived }),
          });
    },
    onSuccess: async () => {
      toast.success(waste === undefined ? c.created : c.saved);
      await invalidate();
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready =
    state.name.trim() !== "" &&
    /^\d{6}\*?$/u.test(state.ler.replace(/[\s.]/gu, "")) &&
    (months === null || (Number.isInteger(months) && months >= 1 && months <= 36));
  const text = (
    label: string,
    key: "name" | "ler" | "operation" | "contractRef",
    max: number,
    hint?: string,
  ) => (
    <FormField label={label} {...(hint === undefined ? {} : { hint })}>
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={waste === undefined ? t.catalog.new : t.catalog.edit}
        footer={
          <Footer
            busy={save.isPending}
            ready={ready}
            onSave={() => {
              save.mutate(undefined);
            }}
            extra={
              waste === undefined ? undefined : (
                <Button
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    save.mutate(!waste.archived);
                  }}
                >
                  {waste.archived ? c.restore : c.archive}
                </Button>
              )
            }
          />
        }
      >
        <div className="grid gap-4">
          {text(f.name, "name", 160)}
          <div className="grid gap-4 sm:grid-cols-3">
            {text(f.ler, "ler", 12, f.lerHint)}
            <FormField label={f.sandach}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  searchable={false}
                  label={f.sandach}
                  placeholder={f.sandachPlaceholder}
                  source={sandachSource}
                  value={state.sandach}
                  onChange={(option) => {
                    set({ sandach: SANDACH.find((id) => id === option?.id) ?? null });
                  }}
                />
              )}
            </FormField>
            {text(f.operation, "operation", 10, f.operationHint)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.manager}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  searchable={false}
                  label={f.manager}
                  placeholder={f.manager}
                  source={managers}
                  value={state.managerId}
                  onChange={(option) => {
                    set({ managerId: option?.id ?? null });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.carrier}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  searchable={false}
                  label={f.carrier}
                  placeholder={f.carrier}
                  source={carriers}
                  value={state.carrierId}
                  onChange={(option) => {
                    set({ carrierId: option?.id ?? null });
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {text(f.contractRef, "contractRef", 120)}
            <FormField label={f.maxStorage} hint={f.maxStorageHint}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  max={36}
                  value={state.maxStorageMonths}
                  onChange={(event) => {
                    set({ maxStorageMonths: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.storageSince} hint={f.storageSinceHint}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={state.storageSince}
                  onChange={(event) => {
                    set({ storageSince: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Contractors ────────────────────────────────────────────────────────────────────────────

function Contractors({ manage }: { manage: boolean }) {
  const [archived, setArchived] = useState(false);
  const { contractors } = useCatalog(archived);
  const [editing, setEditing] = useState<Contractor | "new" | null>(null);
  const k = t.contractors;
  const columns = useMemo<ColumnDef<Contractor>[]>(
    () => [
      {
        id: "name",
        header: k.columns.name,
        cell: ({ row }) => (
          <div className="grid min-w-0 gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            {row.original.nif !== null && (
              <span className="text-xs text-muted-foreground">{row.original.nif}</span>
            )}
            <FolderLink folder={row.original.folder} />
          </div>
        ),
      },
      {
        id: "roles",
        header: k.columns.roles,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.isManager && <Badge>{k.manager}</Badge>}
            {row.original.isCarrier && <Badge>{k.carrier}</Badge>}
          </span>
        ),
      },
      {
        id: "nima",
        header: k.columns.nima,
        cell: ({ row }) => <span className="tabular-nums">{row.original.nima ?? c.none}</span>,
      },
      {
        id: "expires",
        header: k.columns.expires,
        cell: ({ row }) => <DueDate day={row.original.authorizationExpiresOn} />,
      },
      ...(manage
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }: { row: { original: Contractor } }) => (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`${c.edit}: ${row.original.name}`}
                  onClick={() => {
                    setEditing(row.original);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              ),
            } satisfies ColumnDef<Contractor>,
          ]
        : []),
    ],
    [manage, k],
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ArchivedSwitch archived={archived} onChange={setArchived} />
        {manage && !archived && (
          <Button
            onClick={() => {
              setEditing("new");
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {k.new}
          </Button>
        )}
      </div>
      {!contractors.isPending && (contractors.data ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={k.empty}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.tabs.contractors}
            columns={columns}
            data={contractors.data ?? []}
            getRowId={(row) => row.id}
            loading={contractors.isPending}
          />
        </Card>
      )}
      {editing !== null && (
        <ContractorDialog
          contractor={editing === "new" ? undefined : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ContractorDialog({
  contractor,
  onClose,
}: {
  contractor?: Contractor | undefined;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const invalidate = useInvalidate();
  const f = t.contractors.form;
  const [state, setState] = useState({
    name: contractor?.name ?? "",
    nif: contractor?.nif ?? "",
    nima: contractor?.nima ?? "",
    authorizations: contractor?.authorizations ?? "",
    isManager: contractor?.isManager ?? true,
    isCarrier: contractor?.isCarrier ?? false,
    authorizationExpiresOn: contractor?.authorizationExpiresOn ?? "",
    contact: contractor?.contact ?? "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const save = useMutation({
    mutationFn: (archived?: boolean) => {
      const body = {
        name: state.name.trim(),
        nif: orNull(state.nif),
        nima: orNull(state.nima),
        authorizations: state.authorizations.trim(),
        isManager: state.isManager,
        isCarrier: state.isCarrier,
        authorizationExpiresOn: orNull(state.authorizationExpiresOn),
        contact: state.contact.trim(),
      };
      return contractor === undefined
        ? environmentApi.createContractor(workspaceSlug, body)
        : environmentApi.updateContractor(workspaceSlug, contractor.id, {
            ...body,
            ...(archived === undefined ? {} : { archived }),
          });
    },
    onSuccess: async () => {
      toast.success(contractor === undefined ? c.created : c.saved);
      await invalidate();
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = state.name.trim() !== "" && (state.isManager || state.isCarrier);
  const text = (label: string, key: "name" | "nif" | "nima" | "contact", max: number) => (
    <FormField label={label}>
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={contractor === undefined ? t.contractors.new : t.contractors.edit}
        footer={
          <Footer
            busy={save.isPending}
            ready={ready}
            onSave={() => {
              save.mutate(undefined);
            }}
            extra={
              contractor === undefined ? undefined : (
                <Button
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    save.mutate(!contractor.archived);
                  }}
                >
                  {contractor.archived ? c.restore : c.archive}
                </Button>
              )
            }
          />
        }
      >
        <div className="grid gap-4">
          {text(f.name, "name", 160)}
          <div className="grid gap-4 sm:grid-cols-2">
            {text(f.nif, "nif", 120)}
            {text(f.nima, "nima", 120)}
          </div>
          <div className="flex flex-wrap gap-4">
            <Checkbox
              label={f.isManager}
              checked={state.isManager}
              onChange={(event) => {
                set({ isManager: event.target.checked });
              }}
            />
            <Checkbox
              label={f.isCarrier}
              checked={state.isCarrier}
              onChange={(event) => {
                set({ isCarrier: event.target.checked });
              }}
            />
          </div>
          <FormField label={f.authorizations} hint={f.authorizationsHint}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={4000}
                value={state.authorizations}
                onChange={(event) => {
                  set({ authorizations: event.target.value });
                }}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.expiresOn}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={state.authorizationExpiresOn}
                  onChange={(event) => {
                    set({ authorizationExpiresOn: event.target.value });
                  }}
                />
              )}
            </FormField>
            {text(f.contact, "contact", 120)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
