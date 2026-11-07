// A nonconformity's fields (docs/spec/calidad.md): what anyone writes when reporting one and, for whoever
// manages quality, also its origin, severity, owner and department. Used to create, report and edit.
import { useState } from "react";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import {
  NC_ORIGINS,
  SEVERITIES,
  type CreateInput,
  type NcDetail,
  type NcOrigin,
  type Severity,
} from "./quality-api";
import { todayDay, useDepartmentSource, usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.form;

export interface NcFormState {
  title: string;
  description: string;
  detectedOn: string;
  location: string;
  productAffected: boolean;
  productNote: string;
  correction: string;
  origin: NcOrigin;
  severity: Severity;
  owner: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
}

export function useNcForm(
  nc?: NcDetail,
  ownerDefault?: { id: string; name: string },
  originDefault: NcOrigin = "INTERNAL",
) {
  const [state, setState] = useState<NcFormState>(() => ({
    title: nc?.title ?? "",
    description: nc?.description ?? "",
    detectedOn: nc?.detectedOn ?? todayDay(),
    location: nc?.location ?? "",
    productAffected: nc?.productAffected ?? false,
    productNote: nc?.productNote ?? "",
    correction: nc?.correction ?? "",
    origin: nc?.origin ?? originDefault,
    severity: nc?.severity ?? "MAJOR",
    owner: nc?.owner ?? ownerDefault ?? null,
    department: nc?.department ?? null,
  }));
  const set = (patch: Partial<NcFormState>) => {
    setState((current) => ({ ...current, ...patch }));
  };
  return { state, set };
}

const blank = (text: string) => (text.trim() === "" ? null : text.trim());

/** The body to create one (quality.manage). */
export function createBody(state: NcFormState): CreateInput {
  return {
    title: state.title.trim(),
    description: state.description.trim(),
    detectedOn: state.detectedOn,
    location: blank(state.location),
    productAffected: state.productAffected,
    productNote: state.productAffected ? blank(state.productNote) : null,
    correction: blank(state.correction),
    origin: state.origin,
    severity: state.severity,
    ownerId: state.owner?.id ?? "",
    departmentId: state.department?.id ?? null,
  };
}

export const formReady = (state: NcFormState, full: boolean) =>
  state.title.trim() !== "" &&
  state.description.trim() !== "" &&
  state.detectedOn !== "" &&
  (!full || state.owner !== null);

export function NcFields({
  state,
  set,
  full,
  ownerEditable = true,
}: {
  state: NcFormState;
  set: (patch: Partial<NcFormState>) => void;
  /** Origin, severity, owner and department too (quality.manage). */
  full: boolean;
  ownerEditable?: boolean;
}) {
  const people = usePeopleSource();
  const departments = useDepartmentSource();
  const origins = useStaticSource(
    "quality-origins",
    NC_ORIGINS.map((id) => ({ id, label: texts.quality.origins[id] })),
  );
  const severities = useStaticSource(
    "quality-severities",
    SEVERITIES.map((id) => ({ id, label: texts.quality.severities[id] })),
  );
  return (
    <FormGrid>
      <FormField label={t.title}>
        {(control) => (
          <Input
            {...control}
            maxLength={160}
            placeholder={t.titlePlaceholder}
            value={state.title}
            onChange={(event) => {
              set({ title: event.target.value });
            }}
          />
        )}
      </FormField>
      <FormField label={t.description}>
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            maxLength={4000}
            placeholder={t.descriptionPlaceholder}
            value={state.description}
            onChange={(event) => {
              set({ description: event.target.value });
            }}
          />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t.detectedOn}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={state.detectedOn}
              onChange={(event) => {
                set({ detectedOn: event.target.value });
              }}
            />
          )}
        </FormField>
        <FormField label={t.location}>
          {(control) => (
            <Input
              {...control}
              maxLength={120}
              placeholder={t.locationPlaceholder}
              value={state.location}
              onChange={(event) => {
                set({ location: event.target.value });
              }}
            />
          )}
        </FormField>
      </div>
      {full && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t.origin}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={t.origin}
                placeholder={t.origin}
                source={origins}
                value={state.origin}
                onChange={(option) => {
                  const next = NC_ORIGINS.find((id) => id === option?.id);
                  if (next !== undefined) set({ origin: next });
                }}
              />
            )}
          </FormField>
          <FormField label={t.severity}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={t.severity}
                placeholder={t.severity}
                source={severities}
                value={state.severity}
                onChange={(option) => {
                  const next = SEVERITIES.find((id) => id === option?.id);
                  if (next !== undefined) set({ severity: next });
                }}
              />
            )}
          </FormField>
          {ownerEditable && (
            <FormField label={t.owner}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  label={t.owner}
                  placeholder={t.ownerPlaceholder}
                  source={people}
                  value={state.owner?.id ?? null}
                  valueLabel={state.owner?.name}
                  onChange={(option) => {
                    set({ owner: option === null ? null : { id: option.id, name: option.label } });
                  }}
                />
              )}
            </FormField>
          )}
          <FormField label={t.department}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={t.department}
                placeholder={t.departmentPlaceholder}
                source={departments}
                value={state.department?.id ?? null}
                valueLabel={state.department?.name}
                onChange={(option) => {
                  set({
                    department: option === null ? null : { id: option.id, name: option.label },
                  });
                }}
              />
            )}
          </FormField>
        </div>
      )}
      <Checkbox
        label={t.productAffected}
        checked={state.productAffected}
        onChange={(event) => {
          set({ productAffected: event.target.checked });
        }}
      />
      {state.productAffected && (
        <FormField label={t.productNote}>
          {(control) => (
            <Input
              {...control}
              maxLength={2000}
              placeholder={t.productNotePlaceholder}
              value={state.productNote}
              onChange={(event) => {
                set({ productNote: event.target.value });
              }}
            />
          )}
        </FormField>
      )}
      <FormField label={t.correction}>
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            maxLength={2000}
            placeholder={t.correctionPlaceholder}
            value={state.correction}
            onChange={(event) => {
              set({ correction: event.target.value });
            }}
          />
        )}
      </FormField>
    </FormGrid>
  );
}
