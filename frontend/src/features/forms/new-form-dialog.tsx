// «New › Form» in the explorer: asks for its name, creates it here (version 1, no fields) and opens its
// editor. The server checks where the person can create.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { filesKeys } from "@/features/files/api";
import { formsApi } from "./forms-api";
import { texts } from "@/i18n";

export function NewFormDialog({
  open,
  spaceId,
  parentId,
  onClose,
}: {
  open: boolean;
  spaceId: string;
  parentId: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open && <NewForm spaceId={spaceId} parentId={parentId} onClose={onClose} />}
    </Dialog>
  );
}

function NewForm({
  spaceId,
  parentId,
  onClose,
}: {
  spaceId: string;
  parentId: string | null;
  onClose: () => void;
}) {
  const t = texts.forms.newDialog;
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => formsApi.create(workspaceSlug, spaceId, { parentId, name: name.trim() }),
    onSuccess: async ({ form }) => {
      toast.success(t.created);
      await queryClient.invalidateQueries({ queryKey: filesKeys.nodes(workspaceSlug, spaceId) });
      onClose();
      void navigate(`/app/${workspaceSlug}/files/${spaceId}/form/${form.node.id}`);
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  const submit = () => {
    setError(null);
    create.mutate();
  };
  return (
    <DialogContent
      title={t.title}
      description={texts.forms.editor.intro}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={create.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button disabled={create.isPending || name.trim() === ""} onClick={submit}>
            {create.isPending ? t.creating : t.create}
          </Button>
        </>
      }
    >
      <FormField label={t.name} error={error ?? undefined}>
        {(control) => (
          <Input
            {...control}
            autoFocus
            value={name}
            maxLength={255}
            placeholder={t.namePlaceholder}
            onChange={(event) => {
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim() !== "" && !create.isPending) submit();
            }}
          />
        )}
      </FormField>
    </DialogContent>
  );
}
