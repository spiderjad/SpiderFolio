// /app/:slug/calidad/productos — the products the company makes (docs/spec/calidad.md, «Fase 6b»):
// family, allergens, shelf life and the state of its label, with the search in the address.
// quality.manage creates them; quality.view reads them.
import type { ColumnDef } from "@tanstack/react-table";
import { Package, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { DataTable } from "@/components/ui/data-table";
import { Badge, Card, EmptyState } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useListParams, useSearchParam } from "@/features/admin/list-params";
import {
  ALLERGENS,
  NUTRITION_FIELDS,
  productKeys,
  productsApi,
  qualityKeys,
  type Allergen,
  type LabelState,
  type NutritionField,
  type Product,
  type ProductDetail,
  type ProductFilters,
} from "./quality-api";
import { useQuality } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.products;
const labelTone = {
  approved: "success",
  outdated: "danger",
  in_review: "warning",
  none: "neutral",
} as const;

export function LabelStateBadge({ state }: { state: LabelState }) {
  return <Badge tone={labelTone[state]}>{t.labelStates[state]}</Badge>;
}

/** The files (and pages) of the product's folder, to choose a report or a label's artwork. */
export function useProductFiles(productId: string, pages = false): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  const files = useQuery({
    queryKey: productKeys.files(workspaceSlug, productId),
    queryFn: () => productsApi.files(workspaceSlug, productId),
    select: (data) => data.items,
  });
  return {
    key: [...productKeys.files(workspaceSlug, productId), String(files.dataUpdatedAt), pages],
    search: (q) =>
      Promise.resolve({
        items: (files.data ?? [])
          .filter((file) => pages || file.type === "FILE")
          .filter((file) => file.name.toLowerCase().includes(q.trim().toLowerCase()))
          .map((file) => ({ id: file.id, label: file.name })),
        nextCursor: null,
      }),
    byIds: () => Promise.resolve([]),
  };
}

export function allergenList(list: readonly Allergen[]): string {
  return list.map((allergen) => t.allergens[allergen]).join(", ");
}

function AllergenPicker({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: Allergen[];
  onChange: (next: Allergen[]) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {ALLERGENS.map((allergen) => (
          <Checkbox
            key={allergen}
            label={t.allergens[allergen]}
            checked={value.includes(allergen)}
            onChange={(event) => {
              onChange(
                event.target.checked
                  ? [...value, allergen]
                  : value.filter((item) => item !== allergen),
              );
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

const decimal = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export function ProductDialog({
  product,
  onClose,
}: {
  product?: ProductDetail;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const f = t.form;
  const [state, setState] = useState({
    code: product?.code ?? "",
    name: product?.name ?? "",
    family: product?.family ?? "",
    ingredients: product?.ingredients ?? "",
    allergens: product?.allergens ?? [],
    mayContain: product?.mayContain ?? [],
    shelfLifeDays:
      product?.shelfLifeDays === null || product?.shelfLifeDays === undefined
        ? ""
        : String(product.shelfLifeDays),
    storage: product?.storage ?? "",
    readyToEat: product?.readyToEat ?? false,
    notes: product?.notes ?? "",
    spec: (product?.spec ?? null) as { id: string; name: string } | null,
    nutrition: Object.fromEntries(
      NUTRITION_FIELDS.map((field) => {
        const value = product?.nutrition?.[field];
        return [field, value === undefined ? "" : String(value)];
      }),
    ) as Record<NutritionField, string>,
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  const filled = NUTRITION_FIELDS.filter((field) => state.nutrition[field].trim() !== "");
  const nutritionValid =
    filled.length === 0 ||
    (filled.length === NUTRITION_FIELDS.length &&
      NUTRITION_FIELDS.every((field) => decimal(state.nutrition[field]) !== null));
  const days = state.shelfLifeDays.trim() === "" ? null : Number(state.shelfLifeDays);
  const daysValid = days === null || (Number.isInteger(days) && days >= 1 && days <= 3650);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: text(state.code),
        name: state.name.trim(),
        family: text(state.family),
        ingredients: state.ingredients.trim(),
        allergens: state.allergens,
        mayContain: state.mayContain,
        nutrition:
          filled.length === 0
            ? null
            : (Object.fromEntries(
                NUTRITION_FIELDS.map((field) => [field, decimal(state.nutrition[field]) ?? 0]),
              ) as Record<NutritionField, number>),
        shelfLifeDays: days,
        storage: text(state.storage),
        readyToEat: state.readyToEat,
        notes: text(state.notes),
        ...(product === undefined ? {} : { specNodeId: state.spec?.id ?? null }),
      };
      return product === undefined
        ? productsApi.create(workspaceSlug, body)
        : productsApi.update(workspaceSlug, product.id, body);
    },
    onSuccess: async ({ product: saved }) => {
      toast.success(product === undefined ? f.created : f.saved);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
      if (product === undefined) {
        await navigate(`/app/${workspaceSlug}/calidad/productos/${saved.id}`);
      }
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = state.name.trim() !== "" && nutritionValid && daysValid;
  const input = (
    label: string,
    key: "code" | "name" | "family" | "storage",
    max: number,
    placeholder?: string,
  ) => (
    <FormField label={label}>
      {(control) => (
        <Input
          {...control}
          maxLength={max}
          placeholder={placeholder}
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
      title={product === undefined ? f.title : f.editTitle}
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
              : product === undefined
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        {product !== undefined && <p className="text-xs text-muted-foreground">{f.versionHint}</p>}
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr_12rem]">
          {input(f.code, "code", 40)}
          {input(f.name, "name", 160, f.namePlaceholder)}
          {input(f.family, "family", 80, f.familyPlaceholder)}
        </div>
        <FormField label={f.ingredients} hint={f.ingredientsHint}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={4000}
              value={state.ingredients}
              onChange={(event) => {
                set({ ingredients: event.target.value });
              }}
            />
          )}
        </FormField>
        <AllergenPicker
          legend={f.allergens}
          value={state.allergens}
          onChange={(next) => {
            set({ allergens: next });
          }}
        />
        <AllergenPicker
          legend={f.mayContain}
          value={state.mayContain}
          onChange={(next) => {
            set({ mayContain: next });
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.shelfLifeDays}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                max={3650}
                aria-invalid={!daysValid}
                value={state.shelfLifeDays}
                onChange={(event) => {
                  set({ shelfLifeDays: event.target.value });
                }}
              />
            )}
          </FormField>
          {input(f.storage, "storage", 200, f.storagePlaceholder)}
        </div>
        <Checkbox
          label={f.readyToEat}
          checked={state.readyToEat}
          onChange={(event) => {
            set({ readyToEat: event.target.checked });
          }}
        />
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{f.nutrition}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {NUTRITION_FIELDS.map((field) => (
              <FormField key={field} label={t.nutrition[field]}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    aria-invalid={!nutritionValid && state.nutrition[field].trim() === ""}
                    value={state.nutrition[field]}
                    onChange={(event) => {
                      set({ nutrition: { ...state.nutrition, [field]: event.target.value } });
                    }}
                  />
                )}
              </FormField>
            ))}
          </div>
        </fieldset>
        {product !== undefined && <SpecField productId={product.id} state={state} set={set} />}
        <FormField label={f.notes}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="min-h-16"
              maxLength={1000}
              value={state.notes}
              onChange={(event) => {
                set({ notes: event.target.value });
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

function SpecField({
  productId,
  state,
  set,
}: {
  productId: string;
  state: { spec: { id: string; name: string } | null };
  set: (patch: { spec: { id: string; name: string } | null }) => void;
}) {
  const files = useProductFiles(productId, true);
  return (
    <FormField label={t.form.spec}>
      {(control) => (
        <Combobox
          id={control.id}
          aria-describedby={control["aria-describedby"]}
          clearable
          label={t.form.spec}
          placeholder={t.form.specPlaceholder}
          source={files}
          value={state.spec?.id ?? null}
          valueLabel={state.spec?.name}
          onChange={(option) => {
            set({ spec: option === null ? null : { id: option.id, name: option.label } });
          }}
        />
      )}
    </FormField>
  );
}

export function ProductsPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage } = useQuality();
  const { params, patch } = useListParams();
  const filters = useMemo<ProductFilters>(
    () => ({
      q: params.get("q") ?? undefined,
      archived: params.get("archivados") === "1" ? "1" : undefined,
    }),
    [params],
  );
  const [search, setSearch] = useSearchParam("q", filters.q ?? "", patch);
  const [creating, setCreating] = useState(false);
  const list = useInfiniteList<Product>({
    queryKey: productKeys.list(workspaceSlug, filters),
    fetchPage: (cursor, signal) => productsApi.list(workspaceSlug, filters, cursor, signal),
  });
  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      {
        id: "name",
        header: t.columns.name,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/app/${workspaceSlug}/calidad/productos/${row.original.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.code !== null && (
              <p className="truncate text-xs tabular-nums text-muted-foreground">
                {row.original.code}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "family",
        header: t.columns.family,
        cell: ({ row }) => row.original.family ?? "—",
      },
      {
        id: "allergens",
        header: t.columns.allergens,
        cell: ({ row }) =>
          row.original.allergens.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t.noAllergens}</span>
          ) : (
            <span className="text-xs">{allergenList(row.original.allergens)}</span>
          ),
      },
      {
        id: "shelfLife",
        header: t.columns.shelfLife,
        cell: ({ row }) => (
          <div className="grid gap-1">
            <span className="tabular-nums">
              {row.original.shelfLifeDays === null ? "—" : t.days(row.original.shelfLifeDays)}
            </span>
            {row.original.needsStudy && <span className="text-xs text-danger">{t.needsStudy}</span>}
          </div>
        ),
      },
      {
        id: "label",
        header: t.columns.label,
        cell: ({ row }) => <LabelStateBadge state={row.original.labelState} />,
      },
    ],
    [workspaceSlug],
  );
  const filtered = filters.q !== undefined;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              patch({ archivados: filters.archived === "1" ? undefined : "1" });
            }}
          >
            {filters.archived === "1" ? t.hideArchived : t.showArchived}
          </Button>
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
      </div>
      {!list.query.isPending && list.items.length === 0 ? (
        <Card>
          <EmptyState icon={Package} title={filtered ? t.emptyFiltered : t.empty.title}>
            {filtered ? null : t.empty.text}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <DataTable
            label={t.title}
            columns={columns}
            data={list.items}
            getRowId={(product) => product.id}
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
          <ProductDialog
            onClose={() => {
              setCreating(false);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
