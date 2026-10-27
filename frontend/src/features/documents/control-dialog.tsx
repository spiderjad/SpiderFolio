// «Control de documento»: convertir una página o un archivo en documento controlado y llevarlo por su
// flujo: enviar a revisión (con aprobadores sugeridos y editables), aprobar o rechazar, retirar y
// publicar. Muestra el estado, la versión vigente y el historial con las decisiones.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileDown, GitCompare, Send, Undo2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile, limitReachedOf } from "@/features/admin/admin-utils";
import { LimitReachedDialog } from "@/features/admin/limit-dialog";
import { useDepartmentSource } from "@/features/admin/sources";
import { sharingApi } from "@/features/sharing/api";
import { useAuth } from "@/auth/auth-context";
import { formatShortDate } from "@/lib/utils";
import { CompareDialog, ComparisonLoader } from "./compare-view";
import { ReadingsSection } from "./readings-section";
import {
  documentsApi,
  documentsKeys,
  type ApprovalView,
  type ApproverOption,
  type ControlledView,
  type Decision,
  type DocStatus,
} from "./documents-api";
import { texts } from "@/i18n";

export const STATUS_TONE: Record<
  DocStatus,
  "neutral" | "warning" | "primary" | "success" | "danger"
> = {
  DRAFT: "neutral",
  IN_REVIEW: "warning",
  APPROVED: "primary",
  PUBLISHED: "success",
  OBSOLETE: "neutral",
  REJECTED: "danger",
};

export function StatusBadge({ status }: { status: DocStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{texts.documents.status[status]}</Badge>;
}

export interface ControlTarget {
  id: string;
  name: string;
}

export function ControlDialog({
  target,
  onClose,
}: {
  target: ControlTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target !== null && <ControlBody key={target.id} target={target} />}
    </Dialog>
  );
}

function ControlBody({ target }: { target: ControlTarget }) {
  const t = texts.documents;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: documentsKeys.node(workspaceSlug, target.id),
    queryFn: () => documentsApi.controlled(workspaceSlug, target.id),
  });
  const [docType, setDocType] = useState("PRC");
  const [department, setDepartment] = useState<{ id: string; label: string } | null>(null);
  const departments = useDepartmentSource(workspaceSlug);
  const [limit, setLimit] = useState<ReturnType<typeof limitReachedOf>>(null);
  // Todo lo que cambia un documento invalida lo del workspace (páginas, archivos, bandeja).
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["w", workspaceSlug] });
  const convert = useMutation({
    mutationFn: () =>
      documentsApi.convert(workspaceSlug, target.id, {
        docType,
        ...(department === null ? {} : { ownerDepartmentId: department.id }),
      }),
    onSuccess: async () => {
      toast.success(t.converted);
      await refresh();
    },
    onError: (error) => {
      const reached = limitReachedOf(error);
      if (reached === null) toast.error(adminErrorText(error));
      else setLimit(reached);
    },
  });
  const data = info.data;
  const typeOptions = useMemo(
    () =>
      (data?.types ?? []).map((type) => ({
        id: type.code,
        label: type.name,
        description: t.dialog.typeDescriptions[type.code],
      })),
    [data?.types, t.dialog.typeDescriptions],
  );
  const typeSource = useStaticSource(`document-types-${target.id}`, typeOptions);
  const selectedType = data?.types.find((type) => type.code === docType);
  const controlled = data?.controlled ?? null;
  return (
    <DialogContent
      title={t.dialog.title(target.name)}
      description={controlled === null ? t.dialog.convertText : t.dialog.controlledText}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline">{t.dialog.close}</Button>
          </DialogClose>
          {controlled === null && data?.canConvert === true && (
            <Button
              disabled={convert.isPending}
              onClick={() => {
                convert.mutate();
              }}
            >
              {convert.isPending ? t.dialog.converting : t.dialog.convert}
            </Button>
          )}
        </>
      }
    >
      {info.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : info.isError || data === undefined ? (
        <p role="alert" className="text-sm text-danger">
          {t.dialog.loadError}
        </p>
      ) : controlled === null ? (
        data.canConvert ? (
          <div className="grid gap-4">
            <Combobox
              label={t.dialog.type}
              placeholder={t.dialog.typePlaceholder}
              source={typeSource}
              searchable={false}
              value={docType}
              valueLabel={selectedType?.name}
              onChange={(option) => {
                if (option !== null) setDocType(option.id);
              }}
            />
            <Combobox
              label={t.dialog.department}
              placeholder={t.dialog.departmentPlaceholder}
              source={departments}
              value={department?.id ?? null}
              valueLabel={department?.label}
              onChange={(option) => {
                setDepartment(option === null ? null : { id: option.id, label: option.label });
              }}
            />
            <p className="text-xs text-muted-foreground">{t.dialog.departmentHint}</p>
            {selectedType !== undefined && (
              <p className="text-sm font-medium" aria-live="polite">
                {t.dialog.codePreview(
                  `${selectedType.prefix}-${String(selectedType.nextNumber).padStart(selectedType.padding, "0")}`,
                )}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t.dialog.draftNote}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t.dialog.notControlled}</p>
        )
      ) : (
        <ControlledPanel nodeId={target.id} controlled={controlled} onChanged={refresh} />
      )}
      <LimitReachedDialog
        limit={limit}
        onClose={() => {
          setLimit(null);
        }}
      />
    </DialogContent>
  );
}

// ─── Documento controlado: estado, acciones e historial ──────────────────────────────────

function ControlledPanel({
  nodeId,
  controlled,
  onChanged,
}: {
  nodeId: string;
  controlled: ControlledView;
  onChanged: () => Promise<unknown>;
}) {
  const t = texts.documents;
  const { workspaceSlug = "" } = useParams();
  const controlledPdf = useAuth().account?.instance.controlledPdf ?? true;
  const [submitting, setSubmitting] = useState(false);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const { actions } = controlled;
  const downloadPdf = async (version: number) => {
    try {
      downloadBlobFile(
        `${controlled.code} v${String(version)}.pdf`,
        await documentsApi.pdf(workspaceSlug, nodeId, version),
      );
    } catch (error) {
      toast.error(adminErrorText(error));
    }
  };
  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
    } catch (error) {
      toast.error(adminErrorText(error));
      throw error;
    }
    toast.success(done);
    await onChanged();
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="solid">{controlled.code}</Badge>
        <StatusBadge status={controlled.status} />
        <span className="text-xs text-muted-foreground">{controlled.typeName}</span>
      </div>
      <dl className="grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t.dialog.current}</dt>
          <dd className="font-medium">
            {controlled.publishedVersion === null
              ? t.dialog.noCurrent
              : t.dialog.version(controlled.publishedVersion)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">{t.dialog.responsible}</dt>
          <dd className="font-medium">
            {controlled.ownerDepartment?.name ?? t.dialog.noResponsible}
          </dd>
        </div>
        {controlled.reviewDueAt !== null && (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">{t.dialog.nextReview}</dt>
            <dd className="font-medium">{formatShortDate(controlled.reviewDueAt)}</dd>
          </div>
        )}
      </dl>

      {(actions.canSubmit || actions.canDecide || actions.canPublish || actions.canWithdraw) && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t.actions.label}>
          {actions.canSubmit && (
            <Button
              onClick={() => {
                setSubmitting(true);
              }}
            >
              <Send strokeWidth={1.75} aria-hidden="true" />
              {t.actions.submit}
            </Button>
          )}
          {actions.canDecide && (
            <>
              <Button
                onClick={() => {
                  setDeciding("APPROVED");
                }}
              >
                <CheckCircle2 strokeWidth={1.75} aria-hidden="true" />
                {t.actions.approve}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDeciding("CHANGES_REQUESTED");
                }}
              >
                <Undo2 strokeWidth={1.75} aria-hidden="true" />
                {t.actions.requestChanges}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setDeciding("REJECTED");
                }}
              >
                <XCircle strokeWidth={1.75} aria-hidden="true" />
                {t.actions.reject}
              </Button>
            </>
          )}
          {actions.canPublish && (
            <Button
              onClick={() => {
                setPublishing(true);
              }}
            >
              {t.actions.publish}
            </Button>
          )}
          {actions.canWithdraw && (
            <Button
              variant="outline"
              onClick={() => {
                setWithdrawing(true);
              }}
            >
              <Undo2 strokeWidth={1.75} aria-hidden="true" />
              {t.actions.withdraw}
            </Button>
          )}
        </div>
      )}

      <ReadingsSection nodeId={nodeId} controlled={controlled} onChanged={onChanged} />

      {controlled.versions.length > 1 && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => {
            setComparing(true);
          }}
        >
          <GitCompare strokeWidth={1.75} aria-hidden="true" />
          {t.compare.button}
        </Button>
      )}
      <CompareDialog
        open={comparing}
        nodeId={nodeId}
        versions={controlled.versions}
        onClose={() => {
          setComparing(false);
        }}
      />

      <section className="grid gap-1.5" aria-label={t.dialog.history}>
        <h3 className="text-sm font-semibold">{t.dialog.history}</h3>
        {!controlledPdf && <p className="text-xs text-muted-foreground">{t.pdf.unavailable}</p>}
        <ul className="m-0 list-none divide-y divide-border p-0">
          {controlled.versions.map((version) => (
            <li key={version.id} className="grid gap-1 py-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="w-10 shrink-0 font-medium">{`v${String(version.version)}`}</span>
                <StatusBadge status={version.status} />
                {version.minorChange && (
                  <Badge tone="neutral" title={t.history.minorChangeHint}>
                    {t.history.minorChange}
                  </Badge>
                )}
                <span className="min-w-0 flex-1 text-muted-foreground">
                  <span className="block">
                    {formatShortDate(
                      version.publishedAt ?? version.submittedAt ?? version.createdAt,
                    )}
                  </span>
                  {version.submittedBy !== null && (
                    <span className="block break-words">
                      {t.history.sentBy(version.submittedBy)}
                    </span>
                  )}
                </span>
                {(version.status === "PUBLISHED" || version.status === "OBSOLETE") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t.pdf.download(version.version)}
                    onClick={() => {
                      void downloadPdf(version.version);
                    }}
                  >
                    <FileDown strokeWidth={1.75} aria-hidden="true" />
                    PDF
                  </Button>
                )}
              </div>
              {version.changeReason !== null && version.changeReason !== "" && (
                <p className="pl-[3.25rem] text-xs text-muted-foreground">
                  {t.history.reason(version.changeReason)}
                </p>
              )}
              {version.changeNote !== null && version.changeNote !== "" && (
                <p className="pl-[3.25rem] text-xs text-muted-foreground">{version.changeNote}</p>
              )}
              {version.approvals.length > 0 && <Rounds approvals={version.approvals} />}
            </li>
          ))}
        </ul>
      </section>

      <SubmitDialog
        open={submitting}
        nodeId={nodeId}
        onClose={() => {
          setSubmitting(false);
        }}
        onDone={async () => {
          setSubmitting(false);
          await onChanged();
        }}
      />
      <DecisionDialog
        nodeId={nodeId}
        decision={deciding}
        review={controlled.review}
        onClose={() => {
          setDeciding(null);
        }}
        onConfirm={async (comment) => {
          if (deciding === null) return;
          await run(
            () =>
              documentsApi.decide(workspaceSlug, nodeId, {
                decision: deciding,
                ...(comment === "" ? {} : { comment }),
              }),
            deciding === "APPROVED"
              ? t.approved
              : deciding === "CHANGES_REQUESTED"
                ? t.changesRequested
                : t.rejected,
          );
          setDeciding(null);
        }}
      />
      <ConfirmDialog
        open={withdrawing}
        onOpenChange={setWithdrawing}
        icon={Undo2}
        tone="warning"
        title={t.withdraw.title}
        description={t.withdraw.text}
        confirmLabel={t.withdraw.action}
        pendingLabel={t.withdraw.pending}
        onConfirm={async () => {
          await run(() => documentsApi.withdraw(workspaceSlug, nodeId), t.withdrawn);
        }}
      />
      {publishing && (
        <PublishDialog
          hasPrevious={controlled.publishedVersion !== null}
          onClose={() => {
            setPublishing(false);
          }}
          onConfirm={async (body) => {
            await run(() => documentsApi.publish(workspaceSlug, nodeId, body), t.published);
            setPublishing(false);
          }}
        />
      )}
    </div>
  );
}

function PublishDialog({
  hasPrevious,
  onClose,
  onConfirm,
}: {
  hasPrevious: boolean;
  onClose: () => void;
  onConfirm: (body: { requestReading: boolean; reason?: string }) => Promise<void>;
}) {
  const t = texts.documents.publish;
  const [request, setRequest] = useState(true);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        description={hasPrevious ? t.text : t.textFirst}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {texts.admin.common.cancel}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setPending(true);
                const trimmed = reason.trim();
                void onConfirm({
                  requestReading: request,
                  ...(trimmed === "" ? {} : { reason: trimmed }),
                }).catch(() => {
                  setPending(false);
                });
              }}
            >
              {pending ? t.pending : t.action}
            </Button>
          </>
        }
      >
        {hasPrevious && (
          <FormGrid>
            <Checkbox
              checked={request}
              label={t.requestReading}
              onChange={(event) => {
                setRequest(event.target.checked);
              }}
            />
            {!request && <p className="text-xs text-muted-foreground">{t.requestReadingHint}</p>}
            <FormField label={t.reason}>
              {(control) => (
                <Textarea
                  {...control}
                  value={reason}
                  maxLength={500}
                  rows={3}
                  placeholder={t.reasonPlaceholder}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              )}
            </FormField>
          </FormGrid>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Cada envío a revisión es una ronda: quién envió o reenvió y qué decidió cada revisor. */
function Rounds({ approvals }: { approvals: ApprovalView[] }) {
  const t = texts.documents.history;
  const rounds: { key: string; items: ApprovalView[] }[] = [];
  for (const approval of approvals) {
    const found = rounds.find((round) => round.key === approval.round);
    if (found === undefined) rounds.push({ key: approval.round, items: [approval] });
    else found.items.push(approval);
  }
  return (
    <ol className="m-0 grid list-none gap-1.5 p-0 pl-[3.25rem]">
      {rounds.map((round, index) => {
        const first = round.items[0];
        const sender = first?.submittedBy ?? null;
        return (
          <li key={round.key} className="grid gap-0.5">
            <p className="m-0 text-xs font-medium">
              {sender === null
                ? formatShortDate(round.key)
                : `${index === 0 ? t.roundSent(sender) : t.roundResent(sender)} · ${formatShortDate(round.key)}`}
            </p>
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {round.items.map((approval, position) => (
                <ApprovalLine key={position} approval={approval} />
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

function ApprovalLine({ approval }: { approval: ApprovalView }) {
  const t = texts.documents.history;
  const state =
    approval.decision === null
      ? t.pending
      : approval.decision === "APPROVED"
        ? approval.selfApproved
          ? t.approvedBySelf
          : t.approved
        : approval.decision === "CHANGES_REQUESTED"
          ? t.changesRequested
          : t.rejected;
  return (
    <li className={approval.current ? "text-xs" : "text-xs text-muted-foreground/70"}>
      <span className="font-medium">{approval.approver.name}</span>
      {` ${state}`}
      {approval.commentCount > 0 && ` · ${t.comments(approval.commentCount)}`}
      {approval.decidedAt !== null && ` · ${formatShortDate(approval.decidedAt)}`}
      {approval.comment !== null && approval.comment !== "" && ` — «${approval.comment}»`}
    </li>
  );
}

// ─── Enviar a revisión ───────────────────────────────────────────────────────────────────

function SubmitDialog({
  open,
  nodeId,
  onClose,
  onDone,
}: {
  open: boolean;
  nodeId: string;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open && <SubmitBody nodeId={nodeId} onClose={onClose} onDone={onDone} />}
    </Dialog>
  );
}

function SubmitBody({
  nodeId,
  onClose,
  onDone,
}: {
  nodeId: string;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const t = texts.documents.submit;
  const { workspaceSlug = "" } = useParams();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [note, setNote] = useState("");
  const options = useQuery({
    queryKey: [...documentsKeys.node(workspaceSlug, nodeId), "approvers", search],
    queryFn: () => documentsApi.approvers(workspaceSlug, nodeId, search),
  });
  // Al abrir, los sugeridos por la regla del tipo vienen elegidos.
  const selected =
    picked ??
    new Set(
      (options.data?.suggested ?? [])
        .filter((approver) => approver.canView)
        .map((approver) => approver.id),
    );
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const submit = useMutation({
    mutationFn: () =>
      documentsApi.submit(workspaceSlug, nodeId, {
        approverIds: [...selected],
        ...(note.trim() === "" ? {} : { changeNote: note.trim() }),
      }),
    onSuccess: async () => {
      toast.success(texts.documents.submitted);
      await onDone();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const rows = [...(options.data?.suggested ?? []), ...(options.data?.others ?? [])];
  const departments = useDepartmentSource(workspaceSlug);
  const [editingDepartment, setEditingDepartment] = useState(false);
  const [granting, setGranting] = useState<ApproverOption | null>(null);
  const changeDepartment = useMutation({
    mutationFn: (departmentId: string | null) =>
      documentsApi.setDepartment(workspaceSlug, nodeId, departmentId),
    onSuccess: async () => {
      toast.success(t.departmentSaved);
      setEditingDepartment(false);
      setPicked(null);
      await options.refetch();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={t.title}
      description={t.text}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submit.isPending}>
            {texts.admin.common.cancel}
          </Button>
          <Button
            disabled={selected.size === 0 || submit.isPending}
            onClick={() => {
              submit.mutate();
            }}
          >
            {submit.isPending ? t.sending : t.send}
          </Button>
        </>
      }
    >
      <ConfirmDialog
        open={granting !== null}
        onOpenChange={(next) => {
          if (!next) setGranting(null);
        }}
        icon={Send}
        title={granting === null ? "" : t.grantTitle(granting.name)}
        description={t.grantText}
        confirmLabel={t.grantConfirm}
        pendingLabel={t.grantPending}
        onConfirm={async () => {
          if (granting === null) return;
          await sharingApi.set(
            workspaceSlug,
            { type: "node", id: nodeId },
            { membershipId: granting.id, level: "VIEW" },
          );
          toast.success(t.granted);
          setGranting(null);
          await options.refetch();
        }}
      />
      <FormGrid>
        {options.data !== undefined && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t.department}</p>
            {editingDepartment ? (
              <Combobox
                label={t.department}
                placeholder={t.departmentPlaceholder}
                source={departments}
                value={options.data.department?.id ?? null}
                valueLabel={options.data.department?.name}
                disabled={changeDepartment.isPending}
                onChange={(option) => {
                  changeDepartment.mutate(option === null ? null : option.id);
                }}
              />
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span>{options.data.department?.name ?? t.noDepartment}</span>
                {options.data.canChangeDepartment && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingDepartment(true);
                    }}
                  >
                    {t.changeDepartment}
                  </Button>
                )}
              </p>
            )}
            {options.data.department === null && (
              <p className="text-xs text-muted-foreground">{t.noDepartmentHint}</p>
            )}
          </div>
        )}
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t.approvers}</p>
          <Input
            type="search"
            value={search}
            aria-label={t.search}
            placeholder={t.search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          {options.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.none}</p>
          ) : (
            <ul className="m-0 grid max-h-56 list-none gap-1 overflow-y-auto p-0">
              {rows.map((approver) => (
                <li key={approver.id}>
                  <Checkbox
                    checked={approver.canView && selected.has(approver.id)}
                    disabled={!approver.canView}
                    label={`${approver.name} · ${t.via[approver.via](approver.department)}`}
                    onChange={() => {
                      toggle(approver.id);
                    }}
                  />
                  {!approver.canView && (
                    <p className="ml-7 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{t.noAccess}</span>
                      {options.data?.canGrantAccess === true && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setGranting(approver);
                          }}
                        >
                          {t.grantAccess}
                        </Button>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t.all}</p>
        </div>
        <FormField label={t.note}>
          {(control) => (
            <Textarea
              {...control}
              value={note}
              maxLength={500}
              rows={3}
              placeholder={t.notePlaceholder}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

// ─── Aprobar o rechazar ──────────────────────────────────────────────────────────────────

function DecisionDialog({
  nodeId,
  decision,
  review,
  onClose,
  onConfirm,
}: {
  nodeId: string;
  decision: Decision | null;
  review: ControlledView["review"];
  onClose: () => void;
  onConfirm: (comment: string) => Promise<void>;
}) {
  const t = texts.documents.decision;
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  // Pedir cambios y rechazar piden explicar por qué.
  const rejecting = decision === "REJECTED";
  const mustExplain = decision === "REJECTED" || decision === "CHANGES_REQUESTED";
  return (
    <Dialog
      open={decision !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {decision !== null && (
        <DialogContent
          title={
            rejecting
              ? t.rejectTitle
              : decision === "CHANGES_REQUESTED"
                ? t.changesTitle
                : t.approveTitle
          }
          description={
            rejecting
              ? t.rejectText
              : decision === "CHANGES_REQUESTED"
                ? t.changesText
                : t.approveText
          }
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={onClose} disabled={pending}>
                {texts.admin.common.cancel}
              </Button>
              <Button
                variant={rejecting ? "destructive" : "primary"}
                disabled={pending || (mustExplain && comment.trim().length < 3)}
                onClick={() => {
                  setPending(true);
                  void onConfirm(comment.trim())
                    .catch(() => undefined)
                    .finally(() => {
                      setPending(false);
                    });
                }}
              >
                {rejecting ? t.reject : decision === "CHANGES_REQUESTED" ? t.changes : t.approve}
              </Button>
            </>
          }
        >
          <FormGrid>
            {review !== null && (
              <div className="grid gap-1 rounded-lg border border-border p-3 text-sm">
                <p className="m-0 font-medium">
                  {t.comments(review.openComments, review.resolvedComments)}
                </p>
                <p className="m-0 text-xs text-muted-foreground">{t.commentsHint}</p>
              </div>
            )}
            {review?.hasPreviousReview === true && (
              <section className="grid gap-2" aria-label={t.sinceReview}>
                <h3 className="text-sm font-semibold">{t.sinceReview}</h3>
                <ComparisonLoader nodeId={nodeId} since="review" />
              </section>
            )}
            <section className="grid gap-2" aria-label={texts.documents.compare.review}>
              <h3 className="text-sm font-semibold">{texts.documents.compare.review}</h3>
              <ComparisonLoader nodeId={nodeId} />
            </section>
            <FormField label={mustExplain ? t.reasonRequired : t.reasonOptional}>
              {(control) => (
                <Textarea
                  {...control}
                  value={comment}
                  maxLength={1000}
                  rows={4}
                  onChange={(event) => {
                    setComment(event.target.value);
                  }}
                />
              )}
            </FormField>
          </FormGrid>
        </DialogContent>
      )}
    </Dialog>
  );
}
