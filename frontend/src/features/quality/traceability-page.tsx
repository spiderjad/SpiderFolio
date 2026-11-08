// /app/:slug/calidad/trazabilidad — the lots (docs/spec/calidad.md, «Fase 7»): raw materials, intermediates
// and finished products, searched by code, with the filters in the address. quality.manage loads them by
// hand or imports them from CSV; quality.view reads and traces.
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Route, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource, type ComboboxSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { FormField, FormGrid, Input } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import { formatNumber, formatUtcDate } from "@/lib/utils";
import {
  IMPORT_KINDS,
  LOT_KINDS,
  lotKeys,
  lotsApi,
  type ImportKind,
  type ImportResult,
  type Lot,
  type LotDetail,
  type LotFilters,
} from "./lots-api";
import { qualityKeys, suppliersApi } from "./quality-api";
import { useQuality } from "./quality-common";
import { useProductSource } from "./sampling-page";
import { texts } from "@/i18n";

const t = texts.quality.trace;

const kindTone = { RAW: "neutral", INTERMEDIATE: "warningSoft", FINISHED: "primary" } as const;

export function LotKindBadge({ kind }: { kind: Lot["kind"] }) {
  return <Badge tone={kindTone[kind]}>{t.kinds[kind]}</Badge>;
}

export const lotWhat = (lot: Lot) => lot.product?.name ?? lot.material ?? "—";

export const quantityText = (quantity: number | null, unit: string | null) =>
  quantity === null ? "—" : `${formatNumber(quantity)}${unit === null ? "" : ` ${unit}`}`;

function useSupplierSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "quality", "supplier-options"],
      search: async (q, cursor, signal) => {
        const page = await suppliersApi.list(
          workspaceSlug,
          { q },
          cursor,
          signal ?? new AbortController().signal,
        );
        return {
          items: page.items.map((supplier) => ({ id: supplier.id, label: supplier.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
}

const decimal = (value: string): number | null | undefined => {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

/** A lot by hand (quality.manage): new, or editing one that wasn't loaded by an external system. */
export function LotDialog({
  lot,
  onClose,
}: {
  lot?: LotDetail | undefined;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const f = t.form;
  const products = useProductSource();
  const suppliers = useSupplierSource();
  const kinds = useStaticSource(
    "quality-lot-kinds",
    LOT_KINDS.map((id) => ({ id, label: t.kinds[id] })),
  );
  const [state, setState] = useState({
    kind: lot?.kind ?? "RAW",
    code: lot?.code ?? "",
    product: lot?.product ?? null,
    material: lot?.material ?? "",
    supplier: lot?.supplier ?? null,
    supplierLot: lot?.supplierLot ?? "",
    origin: lot?.origin ?? "",
    quantity: lot?.quantity === null || lot?.quantity === undefined ? "" : String(lot.quantity),
    unit: lot?.unit ?? "kg",
    date: lot?.date ?? "",
    expiresOn: lot?.expiresOn ?? "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  const quantity = decimal(state.quantity);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: state.code.trim(),
        productId: state.product?.id ?? null,
        material: text(state.material),
        supplierId: state.supplier?.id ?? null,
        supplierLot: text(state.supplierLot),
        origin: text(state.origin),
        quantity: quantity ?? null,
        unit: text(state.unit),
        date: state.date,
        expiresOn: state.expiresOn === "" ? null : state.expiresOn,
      };
      return lot === undefined
        ? lotsApi.create(workspaceSlug, { ...body, kind: state.kind })
        : lotsApi.update(workspaceSlug, lot.id, body);
    },
    onSuccess: async ({ lot: saved }) => {
      toast.success(lot === undefined ? f.created : f.saved);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
      if (lot === undefined) await navigate(`/app/${workspaceSlug}/calidad/trazabilidad/${saved.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = state.code.trim() !== "" && state.date !== "" && quantity !== undefined;
  const input = (
    label: string,
    key: "code" | "material" | "supplierLot" | "origin" | "unit",
    max: number,
    extra: { hint?: string; placeholder?: string } = {},
  ) => (
    <FormField label={label} {...(extra.hint === undefined ? {} : { hint: extra.hint })}>
      {(control) => (
        <Input
          {...control}
          maxLength={max}
          placeholder={extra.placeholder}
          value={state[key]}
          onChange={(event) => {
            set({ [key]: event.target.value });
          }}
        />
      )}
    </FormField>
  );
  return (
    <DialogContent
      size="lg"
      title={lot === undefined ? f.title : f.editTitle}
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
              : lot === undefined
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <FormField label={f.kind}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                disabled={lot !== undefined}
                label={f.kind}
                placeholder={f.kind}
                source={kinds}
                value={state.kind}
                onChange={(option) => {
                  const next = LOT_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) set({ kind: next });
                }}
              />
            )}
          </FormField>
          {input(f.code, "code", 80, { hint: f.codeHint })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
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
                  set({ product: option === null ? null : { id: option.id, name: option.label } });
                }}
              />
            )}
          </FormField>
          {input(f.material, "material", 160, { hint: f.materialHint })}
        </div>
        {state.kind === "RAW" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={f.supplier}>
                {(control) => (
                  <Combobox
                    id={control.id}
                    aria-describedby={control["aria-describedby"]}
                    clearable
                    label={f.supplier}
                    placeholder={f.supplierPlaceholder}
                    source={suppliers}
                    value={state.supplier?.id ?? null}
                    valueLabel={state.supplier?.name}
                    onChange={(option) => {
                      set({
                        supplier: option === null ? null : { id: option.id, name: option.label },
                      });
                    }}
                  />
                )}
              </FormField>
              {input(f.supplierLot, "supplierLot", 80)}
            </div>
            {input(f.origin, "origin", 200, { placeholder: f.originPlaceholder })}
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-4">
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
          {input(f.unit, "unit", 20)}
          <FormField label={f.date} hint={f.dateHint}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={state.date}
                onChange={(event) => {
                  set({ date: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.expiresOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={state.expiresOn}
                onChange={(event) => {
                  set({ expiresOn: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
      </FormGrid>
    </DialogContent>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const d = t.importDialog;
  const kinds = useStaticSource(
    "quality-import-kinds",
    IMPORT_KINDS.map((id) => ({ id, label: d.kinds[id] })),
  );
  const [kind, setKind] = useState<ImportKind>("lots");
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      lotsApi.import(workspaceSlug, { kind, csv: csv ?? "", dryRun }),
    onSuccess: async (data) => {
      setResult(data);
      if (!data.dryRun) {
        toast.success(d.done(data.created, data.updated));
        await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
        onClose();
      }
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const template = useMutation({
    mutationFn: () => lotsApi.template(workspaceSlug, kind),
    onSuccess: (blob) => {
      downloadBlobFile(`${d.kinds[kind]}.csv`, blob);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const checked = result !== null && result.dryRun && result.kind === kind;
  const writable = checked && result.created + result.updated > 0;
  return (
    <DialogContent
      size="lg"
      title={d.title}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={run.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          {checked ? (
            <Button
              disabled={!writable || run.isPending}
              onClick={() => {
                run.mutate(false);
              }}
            >
              {run.isPending ? d.importing : d.confirm}
            </Button>
          ) : (
            <Button
              disabled={csv === null || run.isPending}
              onClick={() => {
                run.mutate(true);
              }}
            >
              {run.isPending ? d.checking : d.check}
            </Button>
          )}
        </>
      }
    >
      <FormGrid>
        <p className="text-sm text-muted-foreground">{d.intro}</p>
        <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto]">
          <FormField label={d.kind}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={d.kind}
                placeholder={d.kind}
                source={kinds}
                value={kind}
                onChange={(option) => {
                  const next = IMPORT_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) {
                    setKind(next);
                    setResult(null);
                  }
                }}
              />
            )}
          </FormField>
          <Button
            variant="outline"
            disabled={template.isPending}
            onClick={() => {
              template.mutate();
            }}
          >
            <Download className="size-4" aria-hidden="true" />
            {d.template}
          </Button>
        </div>
        <FormField label={d.file}>
          {(control) => (
            <Input
              {...control}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                setResult(null);
                if (file === undefined) {
                  setCsv(null);
                  return;
                }
                if (file.size > 900_000) {
                  toast.error(d.tooBig);
                  setCsv(null);
                  return;
                }
                setFileName(file.name);
                void file.text().then(setCsv);
              }}
            />
          )}
        </FormField>
        {result !== null && (
          <div className="grid gap-2 rounded-xl border border-border p-3 text-sm" role="status">
            <p className="font-medium">
              {fileName !== "" && <span className="text-muted-foreground">{fileName} · </span>}
              {d.summary(result.total, result.created, result.updated, result.errorCount)}
            </p>
            {result.errors.length > 0 && (
              <ul className="grid max-h-48 gap-1 overflow-y-auto text-xs">
                {result.errors.map((error) => (
                  <li key={`${String(error.line)}-${error.message}`} className="text-danger">
                    <span className="tabular-nums">{d.line(error.line)}</span>: {error.message}
                  </li>
                ))}
                {result.errorCount > result.errors.length && (
                  <li className="text-muted-foreground">
                    {d.moreErrors(result.errorCount - result.errors.length)}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </FormGrid>
    </DialogContent>
  );
}

export function TraceabilityPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage } = useQuality();
  const { params, patch } = useListParams();
  const filters = useMemo<LotFilters>(
    () => ({
      q: params.get("q") ?? undefined,
      kind: LOT_KINDS.find((kind) => kind === params.get("tipo")),
    }),
    [params],
  );
  const [search, setSearch] = useSearchParam("q", filters.q ?? "", patch);
  const [dialog, setDialog] = useState<"new" | "import" | null>(null);
  const kinds = useStaticSource(
    "quality-lot-kinds",
    LOT_KINDS.map((id) => ({ id, label: t.kinds[id] })),
  );
  const list = useInfiniteList<Lot>({
    queryKey: lotKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => lotsApi.list(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<Lot>[]>(
    () => [
      {
        id: "lot",
        header: t.columns.lot,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/app/${workspaceSlug}/calidad/trazabilidad/${row.original.id}`}
              className="font-medium tabular-nums underline-offset-4 hover:underline"
            >
              {row.original.code}
            </Link>
            {row.original.source !== "MANUAL" && (
              <p className="text-xs text-muted-foreground">{t.sources[row.original.source]}</p>
            )}
          </div>
        ),
      },
      {
        id: "kind",
        header: t.columns.kind,
        cell: ({ row }) => <LotKindBadge kind={row.original.kind} />,
      },
      { id: "what", header: t.columns.what, cell: ({ row }) => lotWhat(row.original) },
      {
        id: "supplier",
        header: t.columns.supplier,
        cell: ({ row }) =>
          row.original.supplier === null ? (
            "—"
          ) : (
            <div className="min-w-0">
              <p className="truncate">{row.original.supplier.name}</p>
              {row.original.supplierLot !== null && (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {row.original.supplierLot}
                </p>
              )}
            </div>
          ),
      },
      {
        id: "quantity",
        header: t.columns.quantity,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {quantityText(row.original.quantity, row.original.unit)}
          </span>
        ),
      },
      {
        id: "date",
        header: t.columns.date,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">{formatUtcDate(row.original.date)}</span>
        ),
      },
    ],
    [workspaceSlug],
  );
  const filtered = filters.q !== undefined || filters.kind !== undefined;
  const close = () => {
    setDialog(null);
  };
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDialog("import");
              }}
            >
              <Upload className="size-4" aria-hidden="true" />
              {t.import}
            </Button>
            <Button
              onClick={() => {
                setDialog("new");
              }}
            >
              <Plus strokeWidth={1.75} aria-hidden="true" />
              {t.create}
            </Button>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
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
          <EmptyState icon={Route} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(lot) => lot.id}
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
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {dialog === "new" && <LotDialog onClose={close} />}
        {dialog === "import" && <ImportDialog onClose={close} />}
      </Dialog>
    </div>
  );
}
