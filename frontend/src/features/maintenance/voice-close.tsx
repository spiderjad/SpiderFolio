// "Close by talking" and the work order's voice notes (docs/spec/mantenimiento.md, section 3). The
// technician tells what they found and did; the AI proposes cause, solution, time and spare parts; the
// technician checks it and confirms: the time and the parts are added and the work order is marked done,
// with the usual actions. The notes stay on the work order (the audio, 30 days).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic, Play, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatDateTime } from "@/lib/utils";
import {
  maintenanceApi,
  maintenanceKeys,
  type CloseProposal,
  type VoiceNote,
  type WorkAction,
  type WorkOrderDetail,
} from "./maintenance-api";
import { todayDay } from "./maintenance-common";
import { VoiceCapture } from "./voice-capture";
import { texts } from "@/i18n";

const t = texts.maintenance.detail;
const tv = texts.maintenance.voice;

type Part = CloseProposal["parts"][number];

export function VoiceCloseDialog({
  data,
  serverTranscription,
  onClose,
}: {
  data: WorkOrderDetail;
  serverTranscription: boolean;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const d = t.dialogs;
  const [heard, setHeard] = useState<{ transcript: string; proposed: boolean } | null>(null);
  const [solution, setSolution] = useState("");
  const [cause, setCause] = useState("");
  const [downtime, setDowntime] = useState("");
  const [minutes, setMinutes] = useState("0");
  const [parts, setParts] = useState<Part[]>([]);

  const listen = useMutation({
    mutationFn: (note: VoiceNote) => maintenanceApi.voiceClose(workspaceSlug, data.id, note),
    onSuccess: async (result) => {
      setHeard({ transcript: result.transcript, proposed: result.proposal !== null });
      const proposal = result.proposal;
      setSolution(proposal?.solution ?? result.transcript);
      setCause(proposal?.cause ?? "");
      setDowntime(proposal?.downtimeMinutes == null ? "" : String(proposal.downtimeMinutes));
      setMinutes(String(proposal?.minutes ?? 0));
      setParts(proposal?.parts ?? []);
      // The note is already on the work order.
      await queryClient.invalidateQueries({
        queryKey: maintenanceKeys.workOrder(workspaceSlug, data.id),
      });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  const downtimeValue = downtime.trim() === "" ? null : Number.parseInt(downtime, 10);
  const minutesValue = minutes.trim() === "" ? 0 : Number.parseInt(minutes, 10);
  const ready =
    heard !== null &&
    solution.trim() !== "" &&
    (downtimeValue === null || (Number.isInteger(downtimeValue) && downtimeValue >= 0)) &&
    Number.isInteger(minutesValue) &&
    minutesValue >= 0 &&
    minutesValue <= 24 * 60;

  const confirm = useMutation({
    mutationFn: async () => {
      // One by one, with the usual actions: if one fails, what's done stays and the rest is retried.
      const steps: WorkAction[] = [
        ...(minutesValue > 0
          ? [{ action: "labor" as const, minutes: minutesValue, note: "", day: todayDay() }]
          : []),
        ...parts.map((part) => ({ action: "part" as const, ...part })),
        {
          action: "done",
          cause: cause.trim(),
          solution: solution.trim(),
          downtimeMinutes: downtimeValue,
        },
      ];
      let last = null;
      for (const step of steps) last = await maintenanceApi.act(workspaceSlug, data.id, step);
      return last;
    },
    onSuccess: async (result) => {
      if (result !== null) {
        queryClient.setQueryData(maintenanceKeys.workOrder(workspaceSlug, data.id), result);
      }
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
      toast.success(t.done);
      onClose();
    },
    onError: async (error) => {
      toast.error(adminErrorText(error));
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !confirm.isPending) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={tv.closeTitle}
        description={`${data.code} · ${data.title}`}
        footer={
          heard === null ? undefined : (
            <>
              <DialogClose asChild>
                <Button variant="outline" disabled={confirm.isPending}>
                  {texts.admin.common.cancel}
                </Button>
              </DialogClose>
              <Button
                disabled={!ready || confirm.isPending}
                onClick={() => {
                  confirm.mutate();
                }}
              >
                {confirm.isPending ? tv.closing : tv.closeConfirm}
              </Button>
            </>
          )
        }
      >
        <div className="grid gap-4">
          <VoiceCapture
            serverTranscription={serverTranscription}
            busy={listen.isPending}
            hint={tv.closeHint}
            onNote={(note) => {
              listen.mutate(note);
            }}
          />
          {heard !== null && (
            <>
              <Banner tone="info" icon={Sparkles}>
                {heard.proposed ? tv.proposalReady : tv.noProposal}
              </Banner>
              <details className="rounded-lg border border-border px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">{tv.heard}</summary>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{heard.transcript}</p>
              </details>
              <FormField label={d.solution}>
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    maxLength={4000}
                    value={solution}
                    onChange={(event) => {
                      setSolution(event.target.value);
                    }}
                  />
                )}
              </FormField>
              <FormField label={d.cause} hint={d.causeHint}>
                {(control) => (
                  <Textarea
                    {...control}
                    rows={2}
                    maxLength={4000}
                    value={cause}
                    onChange={(event) => {
                      setCause(event.target.value);
                    }}
                  />
                )}
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={tv.closeMinutes} hint={tv.closeMinutesHint}>
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={1440}
                      value={minutes}
                      onChange={(event) => {
                        setMinutes(event.target.value);
                      }}
                    />
                  )}
                </FormField>
                <FormField label={d.downtime} hint={d.downtimeHint}>
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={downtime}
                      onChange={(event) => {
                        setDowntime(event.target.value);
                      }}
                    />
                  )}
                </FormField>
              </div>
              {parts.length > 0 && (
                <div className="grid gap-2">
                  <p className="v-label">{tv.closeParts}</p>
                  <ul className="grid gap-2">
                    {parts.map((part, index) => (
                      <li
                        // The list only shrinks: the index is stable enough.
                        key={`${String(index)}-${part.description}`}
                        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">
                            {part.quantity} {part.unit}
                          </span>{" "}
                          {part.description}
                          {part.partCode !== "" && (
                            <span className="text-muted-foreground"> · {part.partCode}</span>
                          )}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={texts.admin.common.remove}
                          onClick={() => {
                            setParts((current) => current.filter((_, at) => at !== index));
                          }}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The work order's voice notes: what was said, and the audio while it's kept. */
export function VoiceNotes({ data }: { data: WorkOrderDetail }) {
  if (data.recordings.length === 0) return null;
  return (
    <ul className="grid gap-3 text-sm">
      {data.recordings.map((note) => (
        <li key={note.id} className="grid gap-1.5">
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <Mic className="size-3.5" aria-hidden="true" />
            <span className="font-medium text-foreground">{tv.purposes[note.purpose]}</span>
            <span>
              {note.who} · {formatDateTime(note.createdAt)}
            </span>
          </span>
          <p className="whitespace-pre-wrap">{note.transcript}</p>
          {note.hasAudio ? <ListenButton recordingId={note.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

function ListenButton({ recordingId }: { recordingId: string }) {
  const { workspaceSlug = "" } = useParams();
  const [url, setUrl] = useState<string | null>(null);
  const load = useMutation({
    mutationFn: () => maintenanceApi.recordingAudio(workspaceSlug, recordingId),
    onSuccess: (blob) => {
      setUrl(URL.createObjectURL(blob));
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  useEffect(
    () => () => {
      if (url !== null) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (url !== null) {
    return <audio controls autoPlay src={url} className="h-10 w-full max-w-sm" />;
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="justify-self-start"
      disabled={load.isPending}
      onClick={() => {
        load.mutate();
      }}
    >
      <Play className="size-4" aria-hidden="true" />
      {tv.listen}
    </Button>
  );
}
