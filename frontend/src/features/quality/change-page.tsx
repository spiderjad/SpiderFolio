// /app/:slug/calidad/cambios/:changeId — one change (docs/spec/calidad.md, «Fase 6c»): what it is, its
// review (HACCP, allergens, label, training, validation), the decision and its implementation. quality.manage
// reviews and decides; its owner marks it implemented; whoever proposed it follows it without changing it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import { ChangeDialog, ChangeStatusBadge } from "./changes-page";
import {
  REVIEW_POINTS,
  REVIEW_STATES,
  changeKeys,
  changesApi,
  type ChangeDetail,
  type ChangeReview,
} from "./culture-api";
import { qualityKeys } from "./quality-api";
import { todayDay } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.changes;
const d = t.detail;

function useRefresh() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: changeKeys.all(workspaceSlug) }),
      queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) }),
    ]);
  };
}

const onError = (error: unknown) => {
  toast.error(adminErrorText(error));
};

function ReviewCard({ change }: { change: ChangeDetail }) {
  const { workspaceSlug = "" } = useParams();
  const refresh = useRefresh();
  const [review, setReview] = useState<ChangeReview>(change.review);
  const editable = change.can.edit;
  const dirty = JSON.stringify(review) !== JSON.stringify(change.review);
  const save = useMutation({
    mutationFn: () => changesApi.update(workspaceSlug, change.id, { review }),
    onSuccess: async () => {
      toast.success(d.reviewSaved);
      await refresh();
    },
    onError,
  });
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>{d.review}</CardTitle>
        <span className="text-xs text-muted-foreground">{t.pendingPoints(change.pending)}</span>
      </div>
      {editable && <p className="text-xs text-muted-foreground">{d.reviewHint}</p>}
      <ul className="grid gap-3">
        {REVIEW_POINTS.map((point) => {
          const entry = review[point];
          const labelId = `review-${point}`;
          return (
            <li key={point} className="grid gap-2 border-b border-border pb-3 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span id={labelId} className="font-medium">
                  {d.points[point]}
                </span>
                {editable ? (
                  <div role="radiogroup" aria-labelledby={labelId} className="flex gap-1">
                    {REVIEW_STATES.map((value) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        role="radio"
                        aria-checked={entry.state === value}
                        variant={entry.state === value ? "primary" : "outline"}
                        onClick={() => {
                          setReview({ ...review, [point]: { ...entry, state: value } });
                        }}
                      >
                        {d.states[value]}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Badge
                    tone={
                      entry.state === "done"
                        ? "success"
                        : entry.state === "pending"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {d.states[entry.state]}
                  </Badge>
                )}
              </div>
              {editable ? (
                <Input
                  aria-label={d.note(d.points[point])}
                  placeholder={d.note(d.points[point])}
                  maxLength={1000}
                  value={entry.note}
                  onChange={(event) => {
                    setReview({ ...review, [point]: { ...entry, note: event.target.value } });
                  }}
                />
              ) : (
                entry.note !== "" && (
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {entry.note}
                  </p>
                )
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <Button
          className="justify-self-start"
          variant="outline"
          disabled={!dirty || save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {save.isPending ? texts.admin.common.saving : d.saveReview}
        </Button>
      )}
    </Card>
  );
}

function DecisionCard({ change }: { change: ChangeDetail }) {
  const { workspaceSlug = "" } = useParams();
  const refresh = useRefresh();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") =>
      changesApi.decide(workspaceSlug, change.id, {
        decision,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: async (_data, decision) => {
      toast.success(decision === "APPROVE" ? d.approved : d.rejected);
      await refresh();
    },
    onError,
  });
  const haccpPending = change.review.haccp.state === "pending";
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <CardTitle>{d.decision}</CardTitle>
      <FormField label={d.decisionNote} hint={d.decisionNoteHint}>
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            className="min-h-16"
            maxLength={1000}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        )}
      </FormField>
      {haccpPending && <p className="text-xs text-warning">{d.haccpPending}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={haccpPending || decide.isPending}
          onClick={() => {
            decide.mutate("APPROVE");
          }}
        >
          <Check className="size-4" aria-hidden="true" />
          {d.approve}
        </Button>
        <Button
          variant="outline"
          disabled={note.trim() === "" || decide.isPending}
          onClick={() => {
            decide.mutate("REJECT");
          }}
        >
          <X className="size-4" aria-hidden="true" />
          {d.reject}
        </Button>
      </div>
    </Card>
  );
}

function ImplementDialog({ change, onClose }: { change: ChangeDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const refresh = useRefresh();
  const [day, setDay] = useState(todayDay());
  const save = useMutation({
    mutationFn: () => changesApi.implemented(workspaceSlug, change.id, day),
    onSuccess: async () => {
      toast.success(d.implemented);
      await refresh();
      onClose();
    },
    onError,
  });
  return (
    <DialogContent
      title={d.implementTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={day === "" || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : d.implement}
          </Button>
        </>
      }
    >
      <p className="text-sm font-medium">
        {change.code} · {change.title}
      </p>
      <FormField label={d.implementedOn}>
        {(control) => (
          <Input
            {...control}
            type="date"
            max={todayDay()}
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
            }}
          />
        )}
      </FormField>
    </DialogContent>
  );
}

export function ChangePage() {
  const { workspaceSlug = "", changeId = "" } = useParams();
  const refresh = useRefresh();
  const [dialog, setDialog] = useState<"edit" | "implement" | "cancel" | null>(null);
  const query = useQuery({
    queryKey: changeKeys.one(workspaceSlug, changeId),
    queryFn: () => changesApi.get(workspaceSlug, changeId),
    select: (data) => data.change,
  });
  const cancel = useMutation({
    mutationFn: () => changesApi.cancel(workspaceSlug, changeId),
    onSuccess: async () => {
      toast.success(d.cancelled);
      setDialog(null);
      await refresh();
    },
    onError,
  });
  const backLink = (
    <Link
      to={`/app/${workspaceSlug}/calidad/cambios`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {d.back}
    </Link>
  );
  if (query.isError) {
    return (
      <div className="grid gap-4">
        {backLink}
        <Card className="p-5 text-sm">{d.notFound}</Card>
      </div>
    );
  }
  const change = query.data;
  if (change === undefined) return <Skeleton className="h-80" />;
  const close = () => {
    setDialog(null);
  };
  const facts: { label: string; value: string }[] = [
    { label: d.planned, value: change.plannedOn === null ? "—" : formatUtcDate(change.plannedOn) },
    { label: d.owner, value: change.owner?.name ?? t.noOwner },
    { label: d.impact, value: change.impact === null ? "—" : t.impacts[change.impact] },
    ...(change.product === null ? [] : [{ label: d.product, value: change.product.name }]),
  ];
  const readOnly = !change.can.edit && !change.can.decide && !change.can.implement;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-2">
        {backLink}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs tabular-nums text-muted-foreground">
              {change.code} · {t.kinds[change.kind]}
            </p>
            <h1 className="break-words text-2xl font-semibold tracking-tight">{change.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ChangeStatusBadge status={change.status} />
              {change.overdue && <Badge tone="danger">{t.overdue}</Badge>}
              <span className="text-xs text-muted-foreground">
                {d.proposedBy(change.proposedBy.name, formatUtcDate(change.createdAt.slice(0, 10)))}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {change.can.implement && (
              <Button
                size="sm"
                disabled={change.pending > 0}
                title={change.pending > 0 ? d.implementBlocked : undefined}
                onClick={() => {
                  setDialog("implement");
                }}
              >
                <Check className="size-4" aria-hidden="true" />
                {d.implement}
              </Button>
            )}
            {change.can.edit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDialog("edit");
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
                {d.edit}
              </Button>
            )}
            {change.can.cancel && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDialog("cancel");
                }}
              >
                <Ban className="size-4" aria-hidden="true" />
                {d.cancel}
              </Button>
            )}
          </div>
        </div>
        {change.can.implement && change.pending > 0 && (
          <p className="text-xs text-muted-foreground">{d.implementBlocked}</p>
        )}
      </div>
      {readOnly && change.status === "PROPOSED" && (
        <p className="rounded-xl bg-muted p-3 text-sm">{d.readOnly}</p>
      )}
      <Card className="grid gap-3 p-4 sm:p-5">
        <CardTitle>{d.description}</CardTitle>
        <p className="whitespace-pre-wrap break-words text-sm">
          {change.description === "" ? d.noDescription : change.description}
        </p>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-xs text-muted-foreground">{fact.label}</dt>
              <dd className="break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <ReviewCard key={JSON.stringify(change.review)} change={change} />
      {change.can.decide && <DecisionCard change={change} />}
      {change.decidedBy !== null && change.decidedAt !== null && (
        <Card className="grid gap-1 p-4 text-sm sm:p-5">
          <CardTitle>{d.decision}</CardTitle>
          <p className="text-muted-foreground">
            {d.decidedBy(change.decidedBy.name, formatUtcDate(change.decidedAt.slice(0, 10)))}
          </p>
          {change.decisionNote !== null && (
            <p className="whitespace-pre-wrap break-words">{change.decisionNote}</p>
          )}
          {change.implementedOn !== null && (
            <p className="font-medium">{d.implementedAt(formatUtcDate(change.implementedOn))}</p>
          )}
        </Card>
      )}
      <Dialog
        open={dialog === "edit" || dialog === "implement"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {dialog === "edit" && <ChangeDialog change={change} onClose={close} />}
        {dialog === "implement" && <ImplementDialog change={change} onClose={close} />}
      </Dialog>
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        icon={Ban}
        tone="warning"
        title={d.cancelTitle}
        description={d.cancelText}
        confirmLabel={d.cancel}
        pendingLabel={texts.admin.common.saving}
        onConfirm={async () => {
          await cancel.mutateAsync();
        }}
      />
    </div>
  );
}
