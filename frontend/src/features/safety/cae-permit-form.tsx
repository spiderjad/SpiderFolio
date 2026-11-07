// A new or draft work permit (docs/spec/cae.md, «Permisos de trabajo»): type, the contractor (or none,
// for own staff), place, work, dates, people and the precautions checklist, proposed by type with the
// company's terms and editable.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  COMBO_PAGE_SIZE,
  useStaticSource,
  type ComboboxSource,
} from "@/components/ui/combobox";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import {
  CAE_PERMIT_TYPES,
  caeApi,
  caeKeys,
  type CaePermit,
  type CaePermitType,
  type CaePrecaution,
} from "./cae-api";
import { useCae } from "./cae-common";
import { usePeopleSource } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.cae.permits;
const f = t.form;

/** «YYYY-MM-DDTHH:mm» in the browser's time, as a datetime-local input wants it. */
export function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Active companies, for the permit's contractor. */
function useCompanySource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: [...caeKeys.all(workspaceSlug), "permit-companies"],
      search: async (q, cursor, signal) => {
        const page = await caeApi.companies(workspaceSlug, { q }, cursor, signal, COMBO_PAGE_SIZE);
        return {
          items: page.items.map((company) => ({ id: company.id, label: company.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: async (ids) =>
        (await caeApi.companies(workspaceSlug, { ids }, undefined)).items.map((company) => ({
          id: company.id,
          label: company.name,
        })),
    }),
    [workspaceSlug],
  );
}

/** The company's authorized workers. */
function useWorkerSource(companyId: string | null): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: [...caeKeys.all(workspaceSlug), "permit-workers", companyId ?? ""],
      search: async (q, cursor, signal) => {
        if (companyId === null) return { items: [], nextCursor: null };
        const page = await caeApi.workers(
          workspaceSlug,
          companyId,
          { q, status: "authorized" },
          cursor,
          signal,
        );
        return {
          items: page.items.map((worker) => ({
            id: worker.id,
            label: worker.name,
            ...(worker.task === null ? {} : { description: worker.task }),
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug, companyId],
  );
}

export function PermitForm({
  permit,
  onClose,
  onSaved,
}: {
  permit: CaePermit | null;
  onClose: () => void;
  onSaved?: (permit: CaePermit) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const cae = useCae();
  const defaults = (type: CaePermitType): CaePrecaution[] =>
    cae.terms.precautions[type].map((label: string) => ({ label, done: false }));
  const types = useStaticSource(
    "cae-permit-types",
    CAE_PERMIT_TYPES.map((id) => ({ id, label: t.types[id] })),
  );
  const companies = useCompanySource();
  const people = usePeopleSource();
  const [type, setType] = useState<CaePermitType>(permit?.type ?? "HOT_WORK");
  const [customName, setCustomName] = useState(permit?.customName ?? "");
  const [company, setCompany] = useState<{ id: string; name: string } | null>(
    permit?.company ?? null,
  );
  const workerSource = useWorkerSource(company?.id ?? null);
  const [location, setLocation] = useState(permit?.location ?? "");
  const [description, setDescription] = useState(permit?.description ?? "");
  const [validFrom, setValidFrom] = useState(
    localInput(permit === null ? new Date() : new Date(permit.validFrom)),
  );
  const [validTo, setValidTo] = useState(
    localInput(permit === null ? new Date(Date.now() + 8 * 3_600_000) : new Date(permit.validTo)),
  );
  const [workers, setWorkers] = useState<Map<string, string>>(
    new Map((permit?.workers ?? []).map((worker) => [worker.id, worker.name])),
  );
  const [members, setMembers] = useState<Map<string, string>>(
    new Map((permit?.members ?? []).map((member) => [member.id, member.name])),
  );
  const [precautions, setPrecautions] = useState<CaePrecaution[]>(
    permit?.precautions ?? defaults("HOT_WORK"),
  );
  const [newPrecaution, setNewPrecaution] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        type,
        customName: type === "OTHER" ? customName.trim() : null,
        companyId: company?.id ?? null,
        location: location.trim(),
        description: description.trim(),
        validFrom: new Date(validFrom).toISOString(),
        validTo: new Date(validTo).toISOString(),
        workerIds: company === null ? [] : [...workers.keys()],
        membershipIds: [...members.keys()],
        precautions,
      };
      const result =
        permit === null
          ? await caeApi.createPermit(workspaceSlug, body)
          : await caeApi.updatePermit(workspaceSlug, permit.id, body);
      return result.permit;
    },
    onSuccess: async (saved) => {
      toast.success(permit === null ? t.detail.createdToast : t.detail.saved);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
      onClose();
      onSaved?.(saved);
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  const ready =
    location.trim() !== "" &&
    validFrom !== "" &&
    validTo !== "" &&
    (type !== "OTHER" || customName.trim() !== "") &&
    workers.size + members.size > 0 &&
    !save.isPending;

  return (
    <DialogContent
      size="xl"
      title={permit === null ? f.createTitle : f.editTitle}
      description={t.shared}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={!ready}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending
              ? texts.admin.common.saving
              : permit === null
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        {error !== null && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.type}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.type}
                placeholder={f.type}
                source={types}
                value={type}
                onChange={(option) => {
                  const next = CAE_PERMIT_TYPES.find((id) => id === option?.id);
                  if (next === undefined || next === type) return;
                  // Untouched defaults follow the type; edited ones stay.
                  const untouched =
                    precautions.length === 0 ||
                    JSON.stringify(precautions) === JSON.stringify(defaults(type));
                  setType(next);
                  if (untouched) setPrecautions(defaults(next));
                }}
              />
            )}
          </FormField>
          {type === "OTHER" && (
            <FormField label={f.customName}>
              {(control) => (
                <Input
                  {...control}
                  value={customName}
                  maxLength={80}
                  onChange={(event) => {
                    setCustomName(event.target.value);
                  }}
                />
              )}
            </FormField>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.company} hint={f.companyHint}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={f.company}
                placeholder={f.companyPlaceholder}
                source={companies}
                value={company?.id ?? null}
                valueLabel={company?.name}
                onChange={(option) => {
                  setCompany(option === null ? null : { id: option.id, name: option.label });
                  setWorkers(new Map());
                }}
              />
            )}
          </FormField>
          <FormField label={f.location}>
            {(control) => (
              <Input
                {...control}
                value={location}
                maxLength={200}
                onChange={(event) => {
                  setLocation(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.description}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={2000}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.validFrom} hint={f.validityHint}>
            {(control) => (
              <Input
                {...control}
                type="datetime-local"
                value={validFrom}
                onChange={(event) => {
                  setValidFrom(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.validTo}>
            {(control) => (
              <Input
                {...control}
                type="datetime-local"
                value={validTo}
                min={validFrom}
                onChange={(event) => {
                  setValidTo(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        {company !== null && (
          <FormField label={f.workers} hint={f.workersHint}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                multiple
                label={f.workers}
                placeholder={f.workersPlaceholder}
                source={workerSource}
                values={[...workers.keys()]}
                valueLabels={workers}
                onChange={(ids, labels) => {
                  setWorkers(
                    new Map(ids.map((id) => [id, labels.get(id) ?? workers.get(id) ?? ""])),
                  );
                }}
              />
            )}
          </FormField>
        )}
        <FormField label={f.members}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              multiple
              label={f.members}
              placeholder={f.membersPlaceholder}
              source={people}
              values={[...members.keys()]}
              valueLabels={members}
              onChange={(ids, labels) => {
                setMembers(new Map(ids.map((id) => [id, labels.get(id) ?? members.get(id) ?? ""])));
              }}
            />
          )}
        </FormField>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{f.precautions}</legend>
          <p className="text-xs text-muted-foreground">{f.precautionsHint}</p>
          <PrecautionsList precautions={precautions} onChange={setPrecautions} removable />
          {
            <div className="flex gap-2">
              <Input
                aria-label={f.newPrecaution}
                placeholder={f.newPrecaution}
                value={newPrecaution}
                maxLength={200}
                onChange={(event) => {
                  setNewPrecaution(event.target.value);
                }}
              />
              <Button
                variant="outline"
                disabled={newPrecaution.trim() === ""}
                onClick={() => {
                  setPrecautions([...precautions, { label: newPrecaution.trim(), done: false }]);
                  setNewPrecaution("");
                }}
              >
                <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
                {f.addPrecaution}
              </Button>
            </div>
          }
        </fieldset>
      </FormGrid>
    </DialogContent>
  );
}

/** The checklist: tick each precaution as it's checked (and remove it while editing). */
export function PrecautionsList({
  precautions,
  onChange,
  removable = false,
}: {
  precautions: CaePrecaution[];
  onChange: (next: CaePrecaution[]) => void;
  removable?: boolean;
}) {
  return (
    <ul className="grid gap-1.5">
      {precautions.map((item, index) => (
        <li
          key={`${String(index)}-${item.label}`}
          className="flex items-start justify-between gap-2"
        >
          <Checkbox
            label={item.label}
            checked={item.done}
            onChange={(event) => {
              onChange(
                precautions.map((other, at) =>
                  at === index ? { ...other, done: event.target.checked } : other,
                ),
              );
            }}
          />
          {removable && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={f.removePrecaution(item.label)}
              onClick={() => {
                onChange(precautions.filter((_other, at) => at !== index));
              }}
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
