// /app/:slug/calidad/auditorias/:auditId — one audit (docs/spec/calidad.md, «Fase 3»): its details, the
// audit room for the external auditor, its findings by clause with their nonconformity, closing it and
// cancelling it. quality.manage and whoever leads it record findings and close it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, FileSearch, Pencil, Plus, ServerCrash } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useMembership } from "@/features/home/workspace-layout";
import { formatUtcDate } from "@/lib/utils";
import { AuditDialog } from "./audit-dialog";
import { AuditStatusBadge } from "./audits-page";
import {
  SEVERITIES,
  auditKeys,
  auditsApi,
  qualityKeys,
  type AuditDetail,
  type Severity,
} from "./quality-api";
import { NcStatusBadge, SeverityBadge, todayDay, usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.audits;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{children}</dd>
    </div>
  );
}

function FindingDialog({ audit, onClose }: { audit: AuditDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const people = usePeopleSource();
  const severities = useStaticSource(
    "quality-finding-severities",
    SEVERITIES.map((id) => ({ id, label: texts.quality.severities[id] })),
  );
  const f = t.findingsCard.form;
  const [clause, setClause] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("MINOR");
  const [openNc, setOpenNc] = useState(true);
  const [owner, setOwner] = useState(audit.lead);
  const save = useMutation({
    mutationFn: () =>
      auditsApi.addFinding(workspaceSlug, audit.id, {
        clause: clause.trim(),
        description: description.trim(),
        severity,
        openNc,
        ownerId: owner?.id ?? null,
      }),
    onSuccess: async () => {
      toast.success(f.created);
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
            disabled={clause.trim() === "" || description.trim() === "" || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : texts.admin.common.create}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <FormField label={f.clause}>
            {(control) => (
              <Input
                {...control}
                maxLength={40}
                placeholder={f.clausePlaceholder}
                value={clause}
                onChange={(event) => {
                  setClause(event.target.value);
                }}
              />
            )}
          </FormField>
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
        </div>
        <FormField label={f.description}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          )}
        </FormField>
        <Checkbox
          label={f.openNc}
          checked={openNc}
          onChange={(event) => {
            setOpenNc(event.target.checked);
          }}
        />
        {openNc && (
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
        )}
      </FormGrid>
    </DialogContent>
  );
}

function CloseDialog({ audit, onClose }: { audit: AuditDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const d = t.detail;
  const [doneOn, setDoneOn] = useState(
    audit.plannedOn <= todayDay() ? audit.plannedOn : todayDay(),
  );
  const [result, setResult] = useState("");
  const save = useMutation({
    mutationFn: () =>
      auditsApi.close(workspaceSlug, audit.id, {
        doneOn,
        result: result.trim() === "" ? null : result.trim(),
      }),
    onSuccess: async () => {
      toast.success(d.closed);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={d.closeTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={doneOn === "" || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : d.close}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={d.doneOnLabel}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={doneOn}
              onChange={(event) => {
                setDoneOn(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={d.resultLabel}>
          {(control) => (
            <Input
              {...control}
              maxLength={300}
              placeholder={d.resultPlaceholder}
              value={result}
              onChange={(event) => {
                setResult(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

export function AuditPage() {
  const { workspaceSlug = "", auditId = "" } = useParams();
  const queryClient = useQueryClient();
  const membership = useMembership();
  const query = useQuery({
    queryKey: auditKeys.one(workspaceSlug, auditId),
    queryFn: () => auditsApi.get(workspaceSlug, auditId),
    select: (data) => data.audit,
  });
  const [dialog, setDialog] = useState<"edit" | "finding" | "close" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const openNc = useMutation({
    mutationFn: (findingId: string) => auditsApi.findingNc(workspaceSlug, findingId),
    onSuccess: async () => {
      toast.success(t.findingsCard.opened);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const d = t.detail;
  const back = (
    <Link
      to={`/app/${workspaceSlug}/calidad/auditorias`}
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
  const audit = query.data;
  if (audit === undefined) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        {back}
        <Skeleton className="h-40" />
      </div>
    );
  }
  const planned = audit.status === "PLANNED";
  const canWork = audit.access !== "read" && audit.status !== "CANCELLED";
  const chapterLabel = (key: string) => {
    const [standard, number] = key.split(":");
    if (standard !== "IFS8" && standard !== "BRCGS9") return key;
    const index = Number(number) - 1;
    return `${t.standards[standard]} ${String(index + 1)}. ${t.chapterNames[standard][index] ?? ""}`;
  };
  const roomHref = membership.capabilities.includes("audit.share")
    ? `/app/${workspaceSlug}/admin/audit-rooms/${audit.room?.id ?? ""}`
    : null;
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-4">
      <div className="grid gap-2">
        {back}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{t.schemes[audit.scheme]}</p>
            <h1 className="break-words text-xl font-semibold tracking-tight">{audit.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AuditStatusBadge status={audit.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {planned && audit.access === "manage" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialog("edit");
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
                {d.edit}
              </Button>
            )}
            {planned && audit.access !== "read" && (
              <Button
                size="sm"
                onClick={() => {
                  setDialog("close");
                }}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {d.close}
              </Button>
            )}
            {planned && audit.access === "manage" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialog("cancel");
                }}
              >
                <Ban className="size-4" aria-hidden="true" />
                {d.cancel.action}
              </Button>
            )}
          </div>
        </div>
      </div>
      {audit.status === "CANCELLED" && audit.cancelReason !== null && (
        <Banner tone="warning">{d.cancel.banner(audit.cancelReason)}</Banner>
      )}
      <Card className="grid gap-3 p-4 sm:p-5">
        <dl className="grid gap-3">
          <Row label={d.plannedOn}>{formatUtcDate(audit.plannedOn)}</Row>
          {audit.doneOn !== null && <Row label={d.doneOn}>{formatUtcDate(audit.doneOn)}</Row>}
          {audit.result !== null && <Row label={d.result}>{audit.result}</Row>}
          <Row label={d.auditor}>{audit.auditor ?? d.none}</Row>
          <Row label={d.lead}>{audit.lead?.name ?? d.none}</Row>
          {audit.scope !== null && <Row label={d.scope}>{audit.scope}</Row>}
          {audit.chapters.length > 0 && (
            <Row label={d.chapters}>
              <ul className="grid gap-0.5">
                {audit.chapters.map((chapter) => (
                  <li key={chapter}>{chapterLabel(chapter)}</li>
                ))}
              </ul>
            </Row>
          )}
          {audit.room !== null && (
            <Row label={d.room}>
              {roomHref === null ? (
                audit.room.name
              ) : (
                <Link
                  to={roomHref}
                  className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                >
                  <FileSearch className="size-4" aria-hidden="true" />
                  {audit.room.name}
                </Link>
              )}
            </Row>
          )}
        </dl>
      </Card>
      <Card className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t.findingsCard.title}</CardTitle>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t.findingsCard.hint}</p>
          </div>
          {canWork && (
            <Button
              size="sm"
              onClick={() => {
                setDialog("finding");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.findingsCard.add}
            </Button>
          )}
        </div>
        {audit.findingItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.findingsCard.empty}</p>
        ) : (
          <ul className="-my-2 divide-y divide-border">
            {audit.findingItems.map((finding) => (
              <li key={finding.id} className="flex flex-wrap items-start gap-3 py-3">
                <span className="w-16 shrink-0 text-sm font-medium tabular-nums">
                  {finding.clause}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-sm">{finding.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    {finding.nc !== null && (
                      <>
                        <Link
                          to={`/app/${workspaceSlug}/calidad/no-conformidades/${finding.nc.id}`}
                          className="text-xs tabular-nums underline-offset-4 hover:underline"
                        >
                          {finding.nc.code}
                        </Link>
                        <NcStatusBadge status={finding.nc.status} />
                      </>
                    )}
                  </div>
                </div>
                {finding.nc === null && canWork && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={openNc.isPending}
                    onClick={() => {
                      openNc.mutate(finding.id);
                    }}
                  >
                    {t.findingsCard.openNc}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        open={dialog === "edit" || dialog === "finding" || dialog === "close"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        {dialog === "edit" && (
          <AuditDialog
            audit={audit}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
        {dialog === "finding" && (
          <FindingDialog
            audit={audit}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
        {dialog === "close" && (
          <CloseDialog
            audit={audit}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setReason("");
          }
        }}
        icon={Ban}
        tone="warning"
        title={d.cancel.title}
        description={
          <span className="grid gap-3">
            <span>{d.cancel.description}</span>
            <label className="grid gap-1.5 text-foreground">
              <span className="text-sm font-medium">{d.cancel.reason}</span>
              <Textarea
                maxLength={500}
                className="min-h-20"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            </label>
          </span>
        }
        confirmLabel={d.cancel.confirm}
        pendingLabel={d.cancel.pending}
        onConfirm={async () => {
          if (reason.trim() === "") throw new Error(d.cancel.reason);
          await auditsApi.cancel(workspaceSlug, audit.id, reason.trim());
          toast.success(d.cancel.done);
          setReason("");
          await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
        }}
      />
    </div>
  );
}
