// Diálogos del explorador: nueva carpeta, renombrar y mover. Todos invalidan los listados del
// espacio al terminar; el servidor valida permisos, nombres repetidos y ciclos.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { filesApi, filesKeys, type NodeView } from "./api";
import { texts } from "@/i18n";

function useRefreshFiles(spaceId: string) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: filesKeys.nodes(workspaceSlug, spaceId) });
}

// ─── Nueva carpeta ───────────────────────────────────────────────────────────────────────

export function NewFolderDialog({
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
      {open && <NewFolderForm spaceId={spaceId} parentId={parentId} onClose={onClose} />}
    </Dialog>
  );
}

function NewFolderForm({
  spaceId,
  parentId,
  onClose,
}: {
  spaceId: string;
  parentId: string | null;
  onClose: () => void;
}) {
  const t = texts.files.explorer.newFolderDialog;
  const { workspaceSlug = "" } = useParams();
  const refresh = useRefreshFiles(spaceId);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      filesApi.createFolder(workspaceSlug, spaceId, { parentId, name: name.trim() }),
    onSuccess: async () => {
      toast.success(texts.files.explorer.toasts.folderCreated);
      await refresh();
      onClose();
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

// ─── Renombrar ───────────────────────────────────────────────────────────────────────────

export function RenameDialog({ node, onClose }: { node: NodeView | null; onClose: () => void }) {
  return (
    <Dialog
      open={node !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {node !== null && <RenameForm key={node.id} node={node} onClose={onClose} />}
    </Dialog>
  );
}

function RenameForm({ node, onClose }: { node: NodeView; onClose: () => void }) {
  const t = texts.files.explorer.renameDialog;
  const { workspaceSlug = "" } = useParams();
  const refresh = useRefreshFiles(node.spaceId);
  const queryClient = useQueryClient();
  const [name, setName] = useState(node.name);
  const [error, setError] = useState<string | null>(null);
  const rename = useMutation({
    mutationFn: () => filesApi.updateNode(workspaceSlug, node.id, { name: name.trim() }),
    onSuccess: async () => {
      toast.success(texts.files.explorer.toasts.renamed);
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: filesKeys.node(workspaceSlug, node.id) }),
      ]);
      onClose();
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  const submit = () => {
    setError(null);
    rename.mutate();
  };
  const unchanged = name.trim() === node.name;
  return (
    <DialogContent
      title={t.title(node.name)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={rename.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button disabled={rename.isPending || name.trim() === "" || unchanged} onClick={submit}>
            {rename.isPending ? t.saving : t.save}
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
            onChange={(event) => {
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !unchanged && name.trim() !== "" && !rename.isPending) {
                submit();
              }
            }}
          />
        )}
      </FormField>
    </DialogContent>
  );
}
