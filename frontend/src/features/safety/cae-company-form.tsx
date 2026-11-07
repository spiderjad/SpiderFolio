// The new or edited external company (docs/spec/cae.md, «Modelo»): name, type (and the contractor a
// subcontractor works for), what it does, the internal responsible person, contact and dates.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { CAE_KINDS, caeApi, caeKeys, type CaeCompany, type CaeKind } from "./cae-api";
import { useCae, useContractorSource } from "./cae-common";
import { usePeopleSource } from "./safety-common";
import { texts } from "@/i18n";

const f = texts.cae.form;
const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export function CompanyForm({
  company,
  onClose,
  onSaved,
}: {
  company: CaeCompany | null;
  onClose: () => void;
  onSaved?: (company: CaeCompany) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const cae = useCae();
  const people = usePeopleSource();
  const contractors = useContractorSource(company?.id);
  const kinds = useStaticSource(
    `cae-form-kinds-${cae.terms.companies}`,
    CAE_KINDS.map((id) => ({ id, label: cae.terms.kinds[id] })),
  );
  const [name, setName] = useState(company?.name ?? "");
  const [taxId, setTaxId] = useState(company?.taxId ?? "");
  const [kind, setKind] = useState<CaeKind>(company?.kind ?? "CONTRACTOR");
  const [parent, setParent] = useState<{ id: string; name: string } | null>(
    company?.parent ?? null,
  );
  const [activity, setActivity] = useState(company?.activity ?? "");
  const [responsible, setResponsible] = useState<{ id: string; name: string } | null>(
    company?.responsible ?? null,
  );
  const [contactName, setContactName] = useState(company?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(company?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(company?.contactPhone ?? "");
  const [startsOn, setStartsOn] = useState(company?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(company?.endsOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        taxId: orNull(taxId),
        kind,
        parentId: kind === "SUBCONTRACTOR" ? (parent?.id ?? null) : null,
        activity: activity.trim(),
        contactName: orNull(contactName),
        contactEmail: orNull(contactEmail),
        contactPhone: orNull(contactPhone),
        responsibleId: responsible?.id ?? "",
        startsOn: orNull(startsOn),
        endsOn: orNull(endsOn),
      };
      const result =
        company === null
          ? await caeApi.createCompany(workspaceSlug, body)
          : await caeApi.updateCompany(workspaceSlug, company.id, body);
      return result.company;
    },
    onSuccess: async (saved) => {
      toast.success(company === null ? texts.cae.toasts.created : texts.cae.toasts.updated);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
      onClose();
      onSaved?.(saved);
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  const ready =
    name.trim() !== "" &&
    responsible !== null &&
    (kind !== "SUBCONTRACTOR" || parent !== null) &&
    !save.isPending;

  return (
    <DialogContent
      size="lg"
      title={company === null ? f.createTitle : f.editTitle}
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
              : company === null
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
        <FormField label={f.name}>
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.kind} hint={f.kindHint}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.kind}
                placeholder={f.kind}
                source={kinds}
                value={kind}
                onChange={(option) => {
                  const next = CAE_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) setKind(next);
                }}
              />
            )}
          </FormField>
          <FormField label={f.taxId}>
            {(control) => (
              <Input
                {...control}
                value={taxId}
                maxLength={20}
                onChange={(event) => {
                  setTaxId(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        {kind === "SUBCONTRACTOR" && (
          <FormField label={f.parent}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                label={f.parent}
                placeholder={f.parentPlaceholder}
                source={contractors}
                value={parent?.id ?? null}
                valueLabel={parent?.name}
                onChange={(option) => {
                  setParent(option === null ? null : { id: option.id, name: option.label });
                }}
              />
            )}
          </FormField>
        )}
        <FormField label={f.activity}>
          {(control) => (
            <Textarea
              {...control}
              value={activity}
              rows={2}
              maxLength={500}
              placeholder={f.activityPlaceholder}
              onChange={(event) => {
                setActivity(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.responsible} hint={f.responsibleHint}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              label={f.responsible}
              placeholder={f.responsiblePlaceholder}
              source={people}
              value={responsible?.id ?? null}
              valueLabel={responsible?.name}
              onChange={(option) => {
                setResponsible(option === null ? null : { id: option.id, name: option.label });
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={f.contactName}>
            {(control) => (
              <Input
                {...control}
                value={contactName}
                maxLength={120}
                onChange={(event) => {
                  setContactName(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.contactEmail}>
            {(control) => (
              <Input
                {...control}
                type="email"
                value={contactEmail}
                maxLength={254}
                onChange={(event) => {
                  setContactEmail(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.contactPhone}>
            {(control) => (
              <Input
                {...control}
                type="tel"
                value={contactPhone}
                maxLength={40}
                onChange={(event) => {
                  setContactPhone(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.startsOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={startsOn}
                onChange={(event) => {
                  setStartsOn(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.endsOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={endsOn}
                min={startsOn === "" ? undefined : startsOn}
                onChange={(event) => {
                  setEndsOn(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        <p className="text-xs text-muted-foreground">{f.datesHint}</p>
      </FormGrid>
    </DialogContent>
  );
}
