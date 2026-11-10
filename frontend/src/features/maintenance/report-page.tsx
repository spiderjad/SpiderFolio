// /app/:slug/mantenimiento/avisar — report a breakdown (docs/spec/mantenimiento.md, sections 2 and 3):
// phone first, also from the equipment's QR (?equipo=<id>, the equipment already chosen). Anyone with a
// everyone but guests (also the plant's user + PIN tablets). With Bian on, it can be told by voice: the
// AI fills in the form and the person checks it and sends it (section 3).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Megaphone, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Banner, Card } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { cn } from "@/lib/utils";
import {
  maintenanceApi,
  maintenanceKeys,
  type Priority,
  type ReportProposal,
  type VoiceNote,
} from "./maintenance-api";
import { useAssetSource, useAssets } from "./maintenance-common";
import { useVoice, VoiceCapture } from "./voice-capture";
import { texts } from "@/i18n";

const t = texts.maintenance.report;
const tv = texts.maintenance.voice;
const CHOICES: Priority[] = ["URGENT", "HIGH", "NORMAL"];

export function ReportPage() {
  const { workspaceSlug = "" } = useParams();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const fromQr = params.get("equipo");
  const assets = useAssets();
  const source = useAssetSource("report", assets.data ?? []);
  const [assetId, setAssetId] = useState<string | null>(fromQr);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [sent, setSent] = useState<{ id: string; code: string } | null>(null);
  const qrAsset = (assets.data ?? []).find((asset) => asset.id === fromQr);
  const voice = useVoice();
  // The voice note the form came from, and what the AI proposed (null: it couldn't).
  const [note, setNote] = useState<{ recordingId: string; proposal: ReportProposal | null } | null>(
    null,
  );
  const listen = useMutation({
    mutationFn: (input: VoiceNote) => maintenanceApi.voiceReport(workspaceSlug, input, fromQr),
    onSuccess: (result) => {
      setNote({ recordingId: result.recordingId, proposal: result.proposal });
      const proposal = result.proposal;
      if (proposal === null) {
        setDescription(result.transcript);
        return;
      }
      setTitle(proposal.title);
      setDescription(proposal.description);
      if (proposal.assetId !== null) setAssetId(proposal.assetId);
      setPriority(proposal.priority === "LOW" ? "NORMAL" : proposal.priority);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const send = useMutation({
    mutationFn: () =>
      maintenanceApi.report(workspaceSlug, {
        title: title.trim(),
        description: description.trim(),
        assetId,
        priority,
        source: fromQr !== null && assetId === fromQr ? "QR" : "APP",
        recordingId: note?.recordingId ?? null,
      }),
    onSuccess: async ({ workOrder }) => {
      setSent({ id: workOrder.id, code: workOrder.code });
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (sent !== null) {
    return (
      <div className="mx-auto grid w-full max-w-xl gap-4">
        <Card className="grid justify-items-center gap-3 p-6 text-center">
          <CheckCircle2 className="size-10 text-success" strokeWidth={1.5} aria-hidden="true" />
          <p className="text-lg font-semibold">{t.sent(sent.code)}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSent(null);
                setTitle("");
                setDescription("");
                setPriority("NORMAL");
                setAssetId(fromQr);
                setNote(null);
              }}
            >
              {t.another}
            </Button>
            <Button asChild>
              <Link to={`/app/${workspaceSlug}/mantenimiento/ot/${sent.id}`}>{sent.code}</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto grid w-full max-w-xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
      </div>
      {voice.available && (
        <Card className="p-4 sm:p-5">
          <VoiceCapture
            serverTranscription={voice.serverTranscription}
            busy={listen.isPending}
            hint={`${tv.reportHint} ${tv.orType}`}
            onNote={(input) => {
              listen.mutate(input);
            }}
          />
        </Card>
      )}
      {note !== null && (
        <Banner tone="info" icon={Sparkles}>
          {note.proposal === null ? tv.noProposal : tv.proposalReady}
          {note.proposal !== null && note.proposal.priorityReason !== "" && (
            <span className="mt-1 block text-xs">{tv.reason(note.proposal.priorityReason)}</span>
          )}
        </Banner>
      )}
      <Card className="p-4 sm:p-5">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() !== "" && !send.isPending) send.mutate();
          }}
        >
          {qrAsset !== undefined && assetId === qrAsset.id ? (
            <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium">
              {t.fromQr(qrAsset.code, qrAsset.name)}
            </p>
          ) : (
            <FormField label={t.asset}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  label={t.asset}
                  placeholder={t.assetPlaceholder}
                  source={source}
                  value={assetId}
                  onChange={(option) => {
                    setAssetId(option?.id ?? null);
                  }}
                />
              )}
            </FormField>
          )}
          <FormField label={t.titleLabel}>
            {(control) => (
              <Input
                {...control}
                maxLength={160}
                placeholder={t.titlePlaceholder}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.description} hint={t.descriptionHint}>
            {(control) => (
              <Textarea
                {...control}
                rows={4}
                maxLength={4000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            )}
          </FormField>
          <fieldset className="grid gap-2">
            <legend className="v-label">{t.priority}</legend>
            <div className="grid grid-cols-3 gap-2">
              {CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={priority === choice}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    priority === choice
                      ? choice === "URGENT"
                        ? "border-danger bg-danger/10 text-danger"
                        : "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted",
                  )}
                  onClick={() => {
                    setPriority(choice);
                  }}
                >
                  {texts.maintenance.priorities[choice]}
                </button>
              ))}
            </div>
          </fieldset>
          <Button type="submit" size="lg" disabled={title.trim() === "" || send.isPending}>
            <Megaphone className="size-4" aria-hidden="true" />
            {send.isPending ? t.sending : t.send}
          </Button>
          <Link
            to={`/app/${workspaceSlug}/mantenimiento/ot`}
            className="justify-self-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t.mine}
          </Link>
        </form>
      </Card>
    </div>
  );
}
