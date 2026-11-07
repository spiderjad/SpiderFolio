// A supplier, new or edited (docs/spec/calidad.md, «Fase 4»): name, tax ID, category, what it supplies,
// its risk and fraud vulnerability, contact and who follows it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import {
  RISKS,
  SUPPLIER_CATEGORIES,
  qualityKeys,
  suppliersApi,
  type Supplier,
  type SupplierInput,
} from "./quality-api";
import { usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.suppliers;

export function SupplierDialog({
  supplier,
  onClose,
}: {
  supplier?: Supplier;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const people = usePeopleSource();
  const categories = useStaticSource(
    "quality-supplier-categories",
    SUPPLIER_CATEGORIES.map((id) => ({ id, label: t.categories[id] })),
  );
  const risks = useStaticSource(
    "quality-risks",
    RISKS.map((id) => ({ id, label: t.risks[id] })),
  );
  const f = t.form;
  const [state, setState] = useState({
    name: supplier?.name ?? "",
    taxId: supplier?.taxId ?? "",
    category: supplier?.category ?? "RAW_MATERIAL",
    supplies: supplier?.supplies ?? "",
    risk: supplier?.risk ?? "MEDIUM",
    fraudRisk: supplier?.fraudRisk ?? "LOW",
    fraudNote: supplier?.fraudNote ?? "",
    contact: supplier?.contact ?? "",
    owner: supplier?.owner ?? null,
  });
  const set = (patch: Partial<typeof state>) => {
    setState((current) => ({ ...current, ...patch }));
  };
  const blank = (text: string) => (text.trim() === "" ? null : text.trim());
  const save = useMutation({
    mutationFn: async () => {
      const body: SupplierInput = {
        name: state.name.trim(),
        taxId: blank(state.taxId),
        category: state.category,
        supplies: state.supplies.trim(),
        risk: state.risk,
        fraudRisk: state.fraudRisk,
        fraudNote: blank(state.fraudNote),
        contact: blank(state.contact),
        ownerId: state.owner?.id ?? null,
      };
      return supplier === undefined
        ? await suppliersApi.create(workspaceSlug, body)
        : await suppliersApi.update(workspaceSlug, supplier.id, body);
    },
    onSuccess: async (result) => {
      toast.success(supplier === undefined ? f.created : f.saved);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
      if (supplier === undefined) {
        await navigate(`/app/${workspaceSlug}/calidad/proveedores/${result.supplier.id}`);
      }
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = state.name.trim() !== "" && state.supplies.trim() !== "";
  const choice = (
    label: string,
    source: typeof risks,
    value: string,
    onPick: (id: string) => void,
  ) => (
    <FormField label={label}>
      {(control) => (
        <Combobox
          id={control.id}
          aria-describedby={control["aria-describedby"]}
          searchable={false}
          label={label}
          placeholder={label}
          source={source}
          value={value}
          onChange={(option) => {
            if (option !== null) onPick(option.id);
          }}
        />
      )}
    </FormField>
  );
  return (
    <DialogContent
      size="lg"
      title={supplier === undefined ? f.createTitle : f.editTitle}
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
              : supplier === undefined
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <FormField label={f.name}>
            {(control) => (
              <Input
                {...control}
                maxLength={160}
                value={state.name}
                onChange={(event) => {
                  set({ name: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.taxId}>
            {(control) => (
              <Input
                {...control}
                maxLength={20}
                value={state.taxId}
                onChange={(event) => {
                  set({ taxId: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {choice(f.category, categories, state.category, (id) => {
            const next = SUPPLIER_CATEGORIES.find((item) => item === id);
            if (next !== undefined) set({ category: next });
          })}
          {choice(f.risk, risks, state.risk, (id) => {
            const next = RISKS.find((item) => item === id);
            if (next !== undefined) set({ risk: next });
          })}
        </div>
        <FormField label={f.supplies}>
          {(control) => (
            <Input
              {...control}
              maxLength={500}
              placeholder={f.suppliesPlaceholder}
              value={state.supplies}
              onChange={(event) => {
                set({ supplies: event.target.value });
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          {choice(f.fraudRisk, risks, state.fraudRisk, (id) => {
            const next = RISKS.find((item) => item === id);
            if (next !== undefined) set({ fraudRisk: next });
          })}
          <FormField label={f.fraudNote}>
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                className="min-h-16"
                maxLength={1000}
                placeholder={f.fraudNotePlaceholder}
                value={state.fraudNote}
                onChange={(event) => {
                  set({ fraudNote: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.contact}>
            {(control) => (
              <Input
                {...control}
                maxLength={300}
                value={state.contact}
                onChange={(event) => {
                  set({ contact: event.target.value });
                }}
              />
            )}
          </FormField>
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
        </div>
      </FormGrid>
    </DialogContent>
  );
}
