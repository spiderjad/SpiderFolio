// «Agregar a una sala de auditoría» (docs/spec/salas-de-auditoria.md), from the explorer's and the spaces'
// menus: an open room and what of the item goes in (the document, a controlled document's reading
// compliance or approvals history, a form's records between two dates, a folder or a space).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Banner } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { documentsApi, documentsKeys } from "@/features/documents/documents-api";
import { roomsApi, roomsKeys, type RoomItemInput } from "./audit-rooms-api";
import { texts } from "@/i18n";

const t = texts.auditRooms.add;

export interface RoomTarget {
  id: string;
  name: string;
  /** PAGE, FILE, FORM, FOLDER, or SPACE for a whole space. */
  type: string;
}

type Choice = "node" | "space" | "readings" | "approvals" | "form-records";

export function AddToRoomDialog({
  target,
  onClose,
}: {
  target: RoomTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target !== null && <AddToRoomBody key={target.id} target={target} onClose={onClose} />}
    </Dialog>
  );
}

function AddToRoomBody({ target, onClose }: { target: RoomTarget; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const rooms = useQuery({
    queryKey: [...roomsKeys.list(workspaceSlug), "open"],
    queryFn: ({ signal }) => roomsApi.list(workspaceSlug, undefined, signal),
    select: (page) => page.items.filter((room) => room.state === "open"),
  });
  const document = target.type === "PAGE" || target.type === "FILE";
  const controlled = useQuery({
    queryKey: documentsKeys.node(workspaceSlug, target.id),
    queryFn: () => documentsApi.controlled(workspaceSlug, target.id),
    enabled: document,
  });
  const choices: Choice[] =
    target.type === "SPACE"
      ? ["space"]
      : target.type === "FORM"
        ? ["form-records"]
        : target.type === "FOLDER"
          ? ["node"]
          : controlled.data?.controlled?.publishedVersion != null
            ? ["node", "readings", "approvals"]
            : ["node"];
  const label: Record<Choice, string> = {
    node: target.type === "FOLDER" ? t.folder : t.document,
    space: t.space,
    readings: t.readings,
    approvals: t.approvals,
    "form-records": t.records,
  };
  const [roomId, setRoomId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const chosen = choice ?? choices[0] ?? null;
  const roomSource = useStaticSource(
    `audit-rooms-open-${String(rooms.dataUpdatedAt)}`,
    (rooms.data ?? []).map((room) => ({
      id: room.id,
      label: room.name,
      description: room.auditorEmail,
    })),
  );
  const choiceSource = useStaticSource(
    `audit-room-choice-${target.id}-${choices.join(",")}`,
    choices.map((id) => ({ id, label: label[id] })),
  );
  const add = useMutation({
    mutationFn: () => {
      const body: RoomItemInput =
        chosen === "space"
          ? { kind: "space", spaceId: target.id }
          : chosen === "form-records"
            ? { kind: "form-records", formId: target.id, from, to }
            : chosen === "readings" || chosen === "approvals"
              ? { kind: chosen, nodeId: target.id }
              : { kind: "node", nodeId: target.id };
      return roomsApi.add(workspaceSlug, roomId ?? "", body);
    },
    onSuccess: async () => {
      toast.success(t.added);
      await queryClient.invalidateQueries({ queryKey: roomsKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const needsDates = chosen === "form-records";
  const ready =
    roomId !== null && chosen !== null && (!needsDates || (from !== "" && to !== "" && from <= to));
  const none = rooms.data !== undefined && rooms.data.length === 0;
  return (
    <DialogContent
      title={t.title(target.name)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline">{texts.common.cancel}</Button>
          </DialogClose>
          <Button
            disabled={!ready || add.isPending}
            onClick={() => {
              add.mutate();
            }}
          >
            {t.save}
          </Button>
        </>
      }
    >
      {none ? (
        <Banner tone="info">{t.noRooms}</Banner>
      ) : (
        <div className="grid gap-4">
          <FormField label={t.room}>
            {(field) => (
              <Combobox
                {...field}
                label={t.room}
                placeholder={t.roomPlaceholder}
                source={roomSource}
                value={roomId}
                onChange={(option) => {
                  setRoomId(option?.id ?? null);
                }}
              />
            )}
          </FormField>
          {choices.length > 1 && (
            <FormField label={t.what}>
              {(field) => (
                <Combobox
                  {...field}
                  searchable={false}
                  label={t.what}
                  placeholder={t.what}
                  source={choiceSource}
                  value={chosen}
                  onChange={(option) => {
                    setChoice((option?.id as Choice | undefined) ?? null);
                  }}
                />
              )}
            </FormField>
          )}
          {needsDates && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={texts.auditRooms.report.from}>
                {(field) => (
                  <Input
                    {...field}
                    type="date"
                    value={from}
                    onChange={(event) => {
                      setFrom(event.target.value);
                    }}
                  />
                )}
              </FormField>
              <FormField label={texts.auditRooms.report.to}>
                {(field) => (
                  <Input
                    {...field}
                    type="date"
                    value={to}
                    onChange={(event) => {
                      setTo(event.target.value);
                    }}
                  />
                )}
              </FormField>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  );
}
