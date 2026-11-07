// A critical control point, new or edited (docs/spec/calidad.md, «PCC»): its code, step, hazard, critical
// limit, the form that monitors it, how often, who, the corrective action and the verification.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource, type ComboboxSource } from "@/components/ui/combobox";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { HAZARD_TYPES, haccpApi, qualityKeys, type Ccp, type CcpInput } from "./quality-api";
import { usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.haccp;

export function useFormSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "quality", "ccp-forms"],
      search: async (q, _cursor, signal) => {
        const page = await haccpApi.formOptions(workspaceSlug, q, signal);
        return {
          items: page.items.map((form) => ({
            id: form.id,
            label: form.name,
            description: form.space,
          })),
          nextCursor: null,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
}

export function CcpDialog({ ccp, onClose }: { ccp?: Ccp; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const people = usePeopleSource();
  const forms = useFormSource();
  const hazardTypes = useStaticSource(
    "quality-hazard-types",
    HAZARD_TYPES.map((id) => ({ id, label: t.hazardTypes[id] })),
  );
  const f = t.form;
  const [state, setState] = useState({
    code: ccp?.code ?? "",
    name: ccp?.name ?? "",
    step: ccp?.step ?? "",
    hazard: ccp?.hazard ?? "",
    hazardType: ccp?.hazardType ?? "BIOLOGICAL",
    criticalLimit: ccp?.criticalLimit ?? "",
    form: ccp?.form === null || ccp === undefined ? null : { id: ccp.form.id, name: ccp.form.name },
    frequency: ccp?.frequency ?? "",
    responsible: ccp?.responsible ?? null,
    correctiveAction: ccp?.correctiveAction ?? "",
    verification: ccp?.verification ?? "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState((current) => ({ ...current, ...patch }));
  };
  const save = useMutation({
    mutationFn: async () => {
      const body: CcpInput = {
        code: state.code.trim(),
        name: state.name.trim(),
        step: state.step.trim(),
        hazard: state.hazard.trim(),
        hazardType: state.hazardType,
        criticalLimit: state.criticalLimit.trim(),
        formId: state.form?.id ?? null,
        frequency: state.frequency.trim(),
        responsibleId: state.responsible?.id ?? null,
        correctiveAction: state.correctiveAction.trim(),
        verification: state.verification.trim(),
      };
      return ccp === undefined
        ? await haccpApi.createCcp(workspaceSlug, body)
        : await haccpApi.updateCcp(workspaceSlug, ccp.id, body);
    },
    onSuccess: async () => {
      toast.success(ccp === undefined ? f.created : f.saved);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = [
    state.code,
    state.name,
    state.step,
    state.hazard,
    state.criticalLimit,
    state.frequency,
    state.correctiveAction,
    state.verification,
  ].every((value) => value.trim() !== "");
  const text = (key: keyof typeof state, label: string, max: number, placeholder?: string) => (
    <FormField label={label}>
      {(control) => (
        <Input
          {...control}
          maxLength={max}
          {...(placeholder === undefined ? {} : { placeholder })}
          value={state[key] as string}
          onChange={(event) => {
            set({ [key]: event.target.value });
          }}
        />
      )}
    </FormField>
  );
  const area = (key: keyof typeof state, label: string, max: number) => (
    <FormField label={label}>
      {(control) => (
        <Textarea
          {...control}
          rows={2}
          className="min-h-16"
          maxLength={max}
          value={state[key] as string}
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
      title={ccp === undefined ? f.createTitle : f.editTitle}
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
              : ccp === undefined
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          {text("code", f.code, 20)}
          {text("name", f.name, 120)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {text("step", f.step, 120)}
          <FormField label={f.hazardType}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.hazardType}
                placeholder={f.hazardType}
                source={hazardTypes}
                value={state.hazardType}
                onChange={(option) => {
                  const next = HAZARD_TYPES.find((id) => id === option?.id);
                  if (next !== undefined) set({ hazardType: next });
                }}
              />
            )}
          </FormField>
        </div>
        {area("hazard", f.hazard, 500)}
        {text("criticalLimit", f.limit, 300, f.limitPlaceholder)}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.monitoringForm}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={f.monitoringForm}
                placeholder={f.monitoringFormPlaceholder}
                source={forms}
                value={state.form?.id ?? null}
                valueLabel={state.form?.name}
                onChange={(option) => {
                  set({ form: option === null ? null : { id: option.id, name: option.label } });
                }}
              />
            )}
          </FormField>
          {text("frequency", f.frequency, 120)}
        </div>
        <FormField label={f.responsible}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={f.responsible}
              placeholder={f.responsiblePlaceholder}
              source={people}
              value={state.responsible?.id ?? null}
              valueLabel={state.responsible?.name}
              onChange={(option) => {
                set({
                  responsible: option === null ? null : { id: option.id, name: option.label },
                });
              }}
            />
          )}
        </FormField>
        {area("correctiveAction", f.corrective, 1000)}
        {area("verification", f.verification, 1000)}
      </FormGrid>
    </DialogContent>
  );
}
