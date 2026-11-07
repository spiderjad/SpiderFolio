// A contractor's new or edited worker (docs/spec/cae.md, «Datos personales»): name, identity document
// (optional) and job; never health data.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, FormGrid, Input } from "@/components/ui/form";
import { DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { caeApi, caeKeys, type CaeWorker } from "./cae-api";
import { texts } from "@/i18n";

const f = texts.cae.workerForm;
const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export function WorkerForm({
  companyId,
  worker,
  onClose,
}: {
  companyId: string;
  worker: CaeWorker | null;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [name, setName] = useState(worker?.name ?? "");
  const [idNumber, setIdNumber] = useState(worker?.idNumber ?? "");
  const [task, setTask] = useState(worker?.task ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), idNumber: orNull(idNumber), task: orNull(task) };
      return worker === null
        ? caeApi.createWorker(workspaceSlug, companyId, body)
        : caeApi.updateWorker(workspaceSlug, worker.id, body);
    },
    onSuccess: async () => {
      toast.success(worker === null ? texts.cae.toasts.workerCreated : texts.cae.toasts.updated);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  return (
    <DialogContent
      title={worker === null ? f.createTitle : f.editTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={save.isPending || name.trim() === ""}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending
              ? texts.admin.common.saving
              : worker === null
                ? texts.admin.common.create
                : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={f.name} error={error ?? undefined}>
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
        <FormField label={f.idNumber} hint={f.idNumberHint}>
          {(control) => (
            <Input
              {...control}
              value={idNumber}
              maxLength={20}
              autoComplete="off"
              onChange={(event) => {
                setIdNumber(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.task}>
          {(control) => (
            <Input
              {...control}
              value={task}
              maxLength={120}
              onChange={(event) => {
                setTask(event.target.value);
              }}
            />
          )}
        </FormField>
        <p className="text-xs text-muted-foreground">{f.privacy}</p>
      </FormGrid>
    </DialogContent>
  );
}
