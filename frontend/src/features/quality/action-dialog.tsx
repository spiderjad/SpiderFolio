// A nonconformity's action, new or edited (docs/spec/calidad.md, «CAPA»): its type, what to do, who and
// by when. Whoever has to do it is told before its day and sees it in their actions.
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
  ACTION_KINDS,
  qualityApi,
  qualityKeys,
  type ActionKind,
  type QualityAction,
} from "./quality-api";
import { inDays, usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.action;

export function QualityActionDialog({
  ncId,
  action,
  onClose,
}: {
  /** A new action of this NC; or `action` to edit one. */
  ncId: string;
  action?: QualityAction;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const people = usePeopleSource();
  const kinds = useStaticSource(
    "quality-action-kinds",
    ACTION_KINDS.map((id) => ({ id, label: texts.quality.kinds[id] })),
  );
  const [kind, setKind] = useState<ActionKind>(action?.kind ?? "CORRECTIVE");
  const [description, setDescription] = useState(action?.description ?? "");
  const [responsible, setResponsible] = useState<{ id: string; name: string } | null>(
    action?.responsible ?? null,
  );
  const [dueOn, setDueOn] = useState(action?.dueOn ?? inDays(30));
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        kind,
        description: description.trim(),
        responsibleId: responsible?.id ?? "",
        dueOn,
      };
      return action === undefined
        ? await qualityApi.addAction(workspaceSlug, ncId, body)
        : await qualityApi.updateAction(workspaceSlug, action.id, body);
    },
    onSuccess: async () => {
      toast.success(action === undefined ? t.created : t.updated);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const ready = description.trim() !== "" && responsible !== null && dueOn !== "";
  return (
    <DialogContent
      title={action === undefined ? t.createTitle : t.editTitle}
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
        <FormField label={t.kind} hint={texts.quality.detail.actions.hint}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              searchable={false}
              label={t.kind}
              placeholder={t.kind}
              source={kinds}
              value={kind}
              onChange={(option) => {
                const next = ACTION_KINDS.find((id) => id === option?.id);
                if (next !== undefined) setKind(next);
              }}
            />
          )}
        </FormField>
        <FormField label={t.description}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={1000}
              placeholder={t.descriptionPlaceholder}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t.responsible}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                label={t.responsible}
                placeholder={t.responsiblePlaceholder}
                source={people}
                value={responsible?.id ?? null}
                valueLabel={responsible?.name}
                onChange={(option) => {
                  setResponsible(option === null ? null : { id: option.id, name: option.label });
                }}
              />
            )}
          </FormField>
          <FormField label={t.dueOn}>
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
        </div>
      </FormGrid>
    </DialogContent>
  );
}
