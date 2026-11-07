// A preventive measure, new or edited (docs/spec/seguridad-salud.md, «Planificación»): what to do, who,
// by when, its priority and its estimated cost. New ones come from the planning (origin «Otra»), from an
// EVR document or from a non-conforming inspection record; the server checks the reference.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import {
  ACTION_PRIORITIES,
  incidentsKeys,
  planningApi,
  type ActionPriority,
  type SafetyAction,
} from "./safety-api";
import { usePeopleSource } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.planning;

/** Where a new measure comes from. */
export type ActionOriginInput =
  | { origin: "RISK_ASSESSMENT"; nodeId: string; label: string }
  | { origin: "INSPECTION"; recordId: string; label: string }
  | { origin: "DRILL"; drillId: string; label: string }
  | { origin: "OTHER" };

function inDays(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** «12,50» → 1250 cents; empty → null. */
function centsOf(text: string): number | null {
  const value = Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}

export function ActionDialog({
  from,
  action,
  onClose,
}: {
  /** A new measure and where it comes from; or `action` to edit one. */
  from?: ActionOriginInput;
  action?: SafetyAction;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const people = usePeopleSource();
  const priorities = useStaticSource(
    "safety-action-priorities",
    ACTION_PRIORITIES.map((id) => ({ id, label: t.priorities[id] })),
  );
  const [description, setDescription] = useState(action?.description ?? "");
  const [responsible, setResponsible] = useState<{ id: string; name: string } | null>(
    action?.responsible ?? null,
  );
  const [dueOn, setDueOn] = useState(action?.dueOn ?? inDays(30));
  const [priority, setPriority] = useState<ActionPriority>(action?.priority ?? "MEDIUM");
  const [cost, setCost] = useState(
    action?.estimatedCost == null ? "" : (action.estimatedCost / 100).toFixed(2),
  );
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        description: description.trim(),
        responsibleId: responsible?.id ?? "",
        dueOn,
        priority,
        estimatedCost: centsOf(cost),
      };
      if (action !== undefined)
        return (await planningApi.update(workspaceSlug, action.id, body)).action;
      const origin = from ?? { origin: "OTHER" as const };
      const created =
        origin.origin === "RISK_ASSESSMENT"
          ? await planningApi.create(workspaceSlug, {
              ...body,
              origin: "RISK_ASSESSMENT",
              nodeId: origin.nodeId,
            })
          : origin.origin === "INSPECTION"
            ? await planningApi.create(workspaceSlug, {
                ...body,
                origin: "INSPECTION",
                recordId: origin.recordId,
              })
            : origin.origin === "DRILL"
              ? await planningApi.create(workspaceSlug, {
                  ...body,
                  origin: "DRILL",
                  drillId: origin.drillId,
                })
              : await planningApi.create(workspaceSlug, { ...body, origin: "OTHER" });
      return created.action;
    },
    onSuccess: async () => {
      toast.success(action === undefined ? t.created : t.updated);
      await queryClient.invalidateQueries({ queryKey: incidentsKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = description.trim().length >= 3 && responsible !== null && dueOn !== "";
  return (
    <DialogContent
      title={action === undefined ? t.form.createTitle : t.form.editTitle}
      {...(from !== undefined && from.origin !== "OTHER"
        ? { description: t.form.from(from.label) }
        : {})}
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
              : action === undefined
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.form.description}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={500}
              placeholder={t.form.descriptionPlaceholder}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={t.form.responsible}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              label={t.form.responsible}
              placeholder={t.form.responsiblePlaceholder}
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
          <FormField label={t.form.dueOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={dueOn}
                onChange={(event) => {
                  setDueOn(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.form.priority}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={t.form.priority}
                placeholder={t.form.priority}
                source={priorities}
                value={priority}
                onChange={(option) => {
                  const next = ACTION_PRIORITIES.find((id) => id === option?.id);
                  if (next !== undefined) setPriority(next);
                }}
              />
            )}
          </FormField>
          <FormField label={t.form.cost} hint={t.form.costHint}>
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={cost}
                onChange={(event) => {
                  setCost(event.target.value.replace(/[^\d.,]/gu, ""));
                }}
              />
            )}
          </FormField>
        </div>
      </FormGrid>
    </DialogContent>
  );
}
