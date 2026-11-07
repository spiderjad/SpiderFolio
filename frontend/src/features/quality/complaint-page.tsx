// /app/:slug/calidad/reclamaciones/:complaintId — one complaint (docs/spec/calidad.md, «Fase 5»): who
// complains about what, its deadline, the answer (justified or not), its nonconformity and closing it.
// Its owner and quality.manage answer it; a consumer's contact is only shown to them.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, MessageSquareReply, Plus, ServerCrash } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { cn, formatUtcDate } from "@/lib/utils";
import { ComplaintStatusBadge } from "./complaints-page";
import {
  SEVERITIES,
  complaintKeys,
  complaintsApi,
  qualityKeys,
  type Complaint,
  type Severity,
} from "./quality-api";
import { NcStatusBadge, todayDay, usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.complaints;
const d = t.detail;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{children}</dd>
    </div>
  );
}

function AnswerDialog({ complaint, onClose }: { complaint: Complaint; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const f = d.answerForm;
  const [response, setResponse] = useState("");
  const [respondedOn, setRespondedOn] = useState(todayDay());
  const [justified, setJustified] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      complaintsApi.answer(workspaceSlug, complaint.id, {
        response: response.trim(),
        justified,
        respondedOn,
      }),
    onSuccess: async () => {
      toast.success(f.done);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={f.title}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={response.trim() === "" || respondedOn === "" || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : d.answer}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={f.response}>
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              maxLength={4000}
              value={response}
              onChange={(event) => {
                setResponse(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.respondedOn}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={respondedOn}
              onChange={(event) => {
                setRespondedOn(event.target.value);
              }}
            />
          )}
        </FormField>
        <Checkbox
          label={f.justified}
          checked={justified}
          onChange={(event) => {
            setJustified(event.target.checked);
          }}
        />
      </FormGrid>
    </DialogContent>
  );
}

function NcDialog({ complaint, onClose }: { complaint: Complaint; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const people = usePeopleSource();
  const f = d.ncForm;
  const severities = useStaticSource(
    "quality-complaint-nc-severities",
    SEVERITIES.map((id) => ({ id, label: texts.quality.severities[id] })),
  );
  const [severity, setSeverity] = useState<Severity>("MAJOR");
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      complaintsApi.nc(workspaceSlug, complaint.id, { severity, ownerId: owner?.id ?? null }),
    onSuccess: async () => {
      toast.success(f.done);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={f.title}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : d.openNc}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={f.severity}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              searchable={false}
              label={f.severity}
              placeholder={f.severity}
              source={severities}
              value={severity}
              onChange={(option) => {
                const next = SEVERITIES.find((id) => id === option?.id);
                if (next !== undefined) setSeverity(next);
              }}
            />
          )}
        </FormField>
        <FormField label={f.owner}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={f.owner}
              placeholder={f.ownerPlaceholder}
              source={people}
              value={owner?.id ?? null}
              valueLabel={owner?.name}
              onChange={(option) => {
                setOwner(option === null ? null : { id: option.id, name: option.label });
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

export function ComplaintPage() {
  const { workspaceSlug = "", complaintId = "" } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: complaintKeys.one(workspaceSlug, complaintId),
    queryFn: () => complaintsApi.get(workspaceSlug, complaintId),
    select: (data) => data.complaint,
  });
  const [dialog, setDialog] = useState<"answer" | "nc" | null>(null);
  const close = useMutation({
    mutationFn: () => complaintsApi.close(workspaceSlug, complaintId),
    onSuccess: async () => {
      toast.success(d.closed);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const back = (
    <Link
      to={`/app/${workspaceSlug}/calidad/reclamaciones`}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {d.back}
    </Link>
  );
  if (query.isError) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        {back}
        <Card>
          <EmptyState icon={ServerCrash}>{adminErrorText(query.error)}</EmptyState>
        </Card>
      </div>
    );
  }
  const complaint = query.data;
  if (complaint === undefined) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        {back}
        <Skeleton className="h-40" />
      </div>
    );
  }
  const editable = complaint.access !== "read" && complaint.status !== "CLOSED";
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-4">
      <div className="grid gap-2">
        {back}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">
              {t.sources[complaint.source]} · {t.categories[complaint.category]}
            </p>
            <h1 className="break-words text-xl font-semibold tracking-tight">{complaint.from}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ComplaintStatusBadge status={complaint.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && complaint.status === "OPEN" && (
              <Button
                size="sm"
                onClick={() => {
                  setDialog("answer");
                }}
              >
                <MessageSquareReply className="size-4" aria-hidden="true" />
                {d.answer}
              </Button>
            )}
            {editable && complaint.nc === null && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDialog("nc");
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {d.openNc}
              </Button>
            )}
            {editable && (
              <Button
                size="sm"
                variant="outline"
                disabled={close.isPending}
                onClick={() => {
                  close.mutate();
                }}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {d.close}
              </Button>
            )}
          </div>
        </div>
      </div>
      {complaint.access === "read" && complaint.status !== "CLOSED" && (
        <Banner tone="info">{d.readOnly}</Banner>
      )}
      <Card className="grid gap-3 p-4 sm:p-5">
        <dl className="grid gap-3">
          <Row label={d.product}>
            {complaint.product}
            {complaint.lot !== null && ` · ${complaint.lot}`}
          </Row>
          <Row label={d.description}>{complaint.description}</Row>
          {complaint.contact !== null && <Row label={d.contact}>{complaint.contact}</Row>}
          <Row label={d.received}>{formatUtcDate(complaint.receivedOn)}</Row>
          <Row label={d.respondBy}>
            <span className={cn(complaint.overdue && "text-danger")}>
              {formatUtcDate(complaint.respondBy)}
              {complaint.overdue && ` · ${t.overdue}`}
            </span>
          </Row>
          <Row label={d.owner}>{complaint.owner.name}</Row>
          {complaint.nc !== null && (
            <Row label={d.nc}>
              <span className="inline-flex flex-wrap items-center gap-2">
                <Link
                  to={`/app/${workspaceSlug}/calidad/no-conformidades/${complaint.nc.id}`}
                  className="tabular-nums underline-offset-4 hover:underline"
                >
                  {complaint.nc.code}
                </Link>
                <NcStatusBadge status={complaint.nc.status} />
              </span>
            </Row>
          )}
          {complaint.response !== null && (
            <>
              <Row label={d.response}>{complaint.response}</Row>
              <Row label={d.respondedOn}>
                {complaint.respondedOn === null ? d.none : formatUtcDate(complaint.respondedOn)}
              </Row>
              <Row label={d.justified}>
                {complaint.justified === null ? d.none : complaint.justified ? d.yes : d.no}
              </Row>
            </>
          )}
        </dl>
      </Card>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        {dialog === "answer" && (
          <AnswerDialog
            complaint={complaint}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
        {dialog === "nc" && (
          <NcDialog
            complaint={complaint}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
