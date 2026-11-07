// /app/:slug/calidad/no-conformidades/:ncId — one nonconformity (docs/spec/calidad.md): its steps as a
// timeline, what happened, the root cause (5 whys or Ishikawa), its actions, the effectiveness check,
// the evidence folder and the history. Its owner and quality.manage handle it; closing is quality.manage's.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  FolderOpen,
  PackageX,
  Pencil,
  Plus,
  RotateCcw,
  ServerCrash,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { cn, formatDateTime, formatUtcDate } from "@/lib/utils";
import { QualityActionDialog } from "./action-dialog";
import { DecisionDialog, HoldDialog } from "./hold-dialogs";
import { HoldStatusBadge } from "./holds-page";
import { NcFields, formReady, useNcForm } from "./nc-form";
import {
  ISHIKAWA_BRANCHES,
  qualityApi,
  qualityKeys,
  type CauseMethod,
  type IshikawaBranch,
  type NcDetail,
  type NcStatus,
  type Hold,
  type QualityAction,
} from "./quality-api";
import { NcStatusBadge, SeverityBadge } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.detail;
const STEPS: NcStatus[] = ["OPEN", "ANALYSIS", "ACTIONS", "VERIFICATION", "CLOSED"];
const METHODS: CauseMethod[] = ["FIVE_WHYS", "ISHIKAWA", "OTHER"];

function Steps({ status }: { status: NcStatus }) {
  const current = STEPS.indexOf(status);
  return (
    <ol aria-label={t.steps} className="grid grid-cols-5 gap-1">
      {STEPS.map((step, index) => {
        const done = status !== "CANCELLED" && index < current;
        const active = step === status;
        return (
          <li key={step} className="grid gap-1.5" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "h-1.5 rounded-full",
                active ? "bg-primary" : done ? "bg-primary/40" : "bg-muted",
              )}
            />
            <span
              className={cn(
                "flex items-center gap-1 text-xs",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {done && <Check className="size-3" aria-hidden="true" />}
              {texts.quality.statuses[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{children}</dd>
    </div>
  );
}

function readWhys(analysis: unknown): string[] {
  const whys = (analysis as { whys?: unknown } | null)?.whys;
  return Array.isArray(whys) ? whys.filter((why): why is string => typeof why === "string") : [];
}

function readBranches(analysis: unknown): Record<IshikawaBranch, string> {
  const raw = (analysis as { branches?: Record<string, unknown> } | null)?.branches ?? {};
  return Object.fromEntries(
    ISHIKAWA_BRANCHES.map((branch) => [branch, typeof raw[branch] === "string" ? raw[branch] : ""]),
  ) as Record<IshikawaBranch, string>;
}

function readOther(analysis: unknown): string {
  const text = (analysis as { text?: unknown } | null)?.text;
  return typeof text === "string" ? text : "";
}

/** The root cause: 5 whys, Ishikawa's 6M or free text, and its conclusion. */
function CauseCard({ nc, editable }: { nc: NcDetail; editable: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const c = t.cause;
  const [method, setMethod] = useState<CauseMethod>(nc.causeMethod ?? "FIVE_WHYS");
  const [whys, setWhys] = useState<string[]>(() => {
    const saved = readWhys(nc.causeAnalysis);
    return saved.length > 0 ? saved : [""];
  });
  const [branches, setBranches] = useState(() => readBranches(nc.causeAnalysis));
  const [other, setOther] = useState(() => readOther(nc.causeAnalysis));
  const [rootCause, setRootCause] = useState(nc.rootCause ?? "");
  const methods = useStaticSource(
    "quality-cause-methods",
    METHODS.map((id) => ({ id, label: c.methods[id] })),
  );
  const save = useMutation({
    mutationFn: () =>
      qualityApi.update(workspaceSlug, nc.id, {
        causeMethod: method,
        causeAnalysis:
          method === "FIVE_WHYS"
            ? { whys: whys.map((why) => why.trim()).filter((why) => why !== "") }
            : method === "ISHIKAWA"
              ? { branches }
              : { text: other.trim() },
        rootCause: rootCause.trim() === "" ? null : rootCause.trim(),
      }),
    onSuccess: async () => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (!editable) {
    return (
      <Card className="grid gap-3 p-4 sm:p-5">
        <CardTitle>{c.title}</CardTitle>
        {nc.causeMethod === null && nc.rootCause === null ? (
          <p className="text-sm text-muted-foreground">{c.empty}</p>
        ) : (
          <dl className="grid gap-3">
            {nc.causeMethod !== null && <Row label={c.method}>{c.methods[nc.causeMethod]}</Row>}
            {nc.causeMethod === "FIVE_WHYS" &&
              readWhys(nc.causeAnalysis).map((why, index) => (
                <Row key={index} label={c.why(index + 1)}>
                  {why}
                </Row>
              ))}
            {nc.causeMethod === "ISHIKAWA" &&
              ISHIKAWA_BRANCHES.map((branch) => {
                const text = readBranches(nc.causeAnalysis)[branch];
                return text === "" ? null : (
                  <Row key={branch} label={c.branches[branch]}>
                    {text}
                  </Row>
                );
              })}
            {nc.causeMethod === "OTHER" && (
              <Row label={c.analysis}>{readOther(nc.causeAnalysis)}</Row>
            )}
            <Row label={c.conclusion}>{nc.rootCause ?? t.none}</Row>
          </dl>
        )}
      </Card>
    );
  }
  return (
    <Card className="grid gap-4 p-4 sm:p-5">
      <div>
        <CardTitle>{c.title}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
      </div>
      <FormField label={c.method}>
        {(control) => (
          <Combobox
            id={control.id}
            aria-describedby={control["aria-describedby"]}
            searchable={false}
            label={c.method}
            placeholder={c.method}
            source={methods}
            value={method}
            onChange={(option) => {
              const next = METHODS.find((id) => id === option?.id);
              if (next !== undefined) setMethod(next);
            }}
          />
        )}
      </FormField>
      {method === "FIVE_WHYS" && (
        <div className="grid gap-3">
          {whys.map((why, index) => (
            <FormField key={index} label={c.why(index + 1)}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={2000}
                  value={why}
                  onChange={(event) => {
                    const next = [...whys];
                    next[index] = event.target.value;
                    setWhys(next);
                  }}
                />
              )}
            </FormField>
          ))}
          {whys.length < 7 && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                setWhys([...whys, ""]);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {c.addWhy}
            </Button>
          )}
        </div>
      )}
      {method === "ISHIKAWA" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {ISHIKAWA_BRANCHES.map((branch) => (
            <FormField key={branch} label={c.branches[branch]}>
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  className="min-h-16"
                  maxLength={2000}
                  value={branches[branch]}
                  onChange={(event) => {
                    setBranches({ ...branches, [branch]: event.target.value });
                  }}
                />
              )}
            </FormField>
          ))}
        </div>
      )}
      {method === "OTHER" && (
        <FormField label={c.analysis}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={2000}
              value={other}
              onChange={(event) => {
                setOther(event.target.value);
              }}
            />
          )}
        </FormField>
      )}
      <FormField label={c.conclusion}>
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            className="min-h-16"
            maxLength={2000}
            placeholder={c.conclusionPlaceholder}
            value={rootCause}
            onChange={(event) => {
              setRootCause(event.target.value);
            }}
          />
        )}
      </FormField>
      <Button
        className="justify-self-start"
        disabled={save.isPending}
        onClick={() => {
          save.mutate();
        }}
      >
        {save.isPending ? texts.admin.common.saving : c.save}
      </Button>
    </Card>
  );
}

function ActionsCard({ nc, editable }: { nc: NcDetail; editable: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const a = t.actions;
  const [editing, setEditing] = useState<QualityAction | "new" | null>(null);
  const done = useMutation({
    mutationFn: (id: string) => qualityApi.doneAction(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(texts.quality.action.doneToast);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>{a.title}</CardTitle>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{a.hint}</p>
        </div>
        {editable && (
          <Button
            size="sm"
            onClick={() => {
              setEditing("new");
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {a.add}
          </Button>
        )}
      </div>
      {nc.actionItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">{a.empty}</p>
      ) : (
        <ul className="-my-2 divide-y divide-border">
          {nc.actionItems.map((action) => (
            <li key={action.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="primary">{texts.quality.kinds[action.kind]}</Badge>
                  {action.done !== null && <Badge tone="success">{a.done}</Badge>}
                  {action.overdue && <Badge tone="danger">{a.overdue}</Badge>}
                </div>
                <p
                  className={cn(
                    "mt-1.5 whitespace-pre-wrap break-words text-sm",
                    action.done !== null && "text-muted-foreground line-through",
                  )}
                >
                  {action.description}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {action.done === null
                    ? `${action.responsible.name} · ${formatUtcDate(action.dueOn)}`
                    : a.doneBy(action.done.by?.name ?? "", formatDateTime(action.done.at))}
                </p>
              </div>
              <div className="flex gap-1">
                {action.canComplete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={a.markDone}
                    disabled={done.isPending}
                    onClick={() => {
                      done.mutate(action.id);
                    }}
                  >
                    <CheckCircle2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                )}
                {action.canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={a.edit(action.description)}
                    onClick={() => {
                      setEditing(action);
                    }}
                  >
                    <Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && (
          <QualityActionDialog
            ncId={nc.id}
            {...(editing === "new" ? {} : { action: editing })}
            onClose={() => {
              setEditing(null);
            }}
          />
        )}
      </Dialog>
    </Card>
  );
}

function VerificationCard({ nc }: { nc: NcDetail }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const v = t.verification;
  const [date, setDate] = useState(nc.verifyOn ?? "");
  const [note, setNote] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
  const reschedule = useMutation({
    mutationFn: () => qualityApi.setVerifyOn(workspaceSlug, nc.id, date),
    onSuccess: async () => {
      toast.success(t.saved);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const verify = useMutation({
    mutationFn: (effective: boolean) =>
      qualityApi.verify(workspaceSlug, nc.id, { effective, note: note.trim() }),
    onSuccess: async (_result, effective) => {
      toast.success(effective ? v.closed : v.reopenedToActions);
      setNote("");
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const inVerification = nc.status === "VERIFICATION";
  const canSchedule = inVerification && nc.access !== "read";
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div>
        <CardTitle>{v.title}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{v.hint}</p>
      </div>
      {!inVerification && nc.status !== "CLOSED" && (
        <p className="text-sm text-muted-foreground">{v.pending}</p>
      )}
      {inVerification && nc.verifyOn !== null && (
        <p className="text-sm font-medium">{v.on(formatUtcDate(nc.verifyOn))}</p>
      )}
      {canSchedule && (
        <div className="flex flex-wrap items-end gap-2">
          <FormField label={v.change}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                }}
              />
            )}
          </FormField>
          <Button
            variant="outline"
            disabled={date === "" || date === nc.verifyOn || reschedule.isPending}
            onClick={() => {
              reschedule.mutate();
            }}
          >
            {texts.admin.common.save}
          </Button>
        </div>
      )}
      {inVerification && nc.access === "manage" && (
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <FormField label={v.note}>
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                className="min-h-16"
                maxLength={2000}
                placeholder={v.notePlaceholder}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={note.trim() === "" || verify.isPending}
              onClick={() => {
                verify.mutate(true);
              }}
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {v.effective}
            </Button>
            <Button
              variant="outline"
              disabled={note.trim() === "" || verify.isPending}
              onClick={() => {
                verify.mutate(false);
              }}
            >
              {v.notEffective}
            </Button>
          </div>
        </div>
      )}
      {inVerification && nc.access === "edit" && (
        <p className="text-xs text-muted-foreground">{v.onlyManager}</p>
      )}
      {nc.verifications.length > 0 && (
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">{v.history}</p>
          <ul className="grid gap-2">
            {nc.verifications.map((check) => (
              <li key={check.id} className="rounded-lg bg-muted/50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={check.effective ? "success" : "danger"}>
                    {check.effective ? v.wasEffective : v.wasNotEffective}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {check.by.name} · {formatDateTime(check.at)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words">{check.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function HoldsCard({ nc, editable }: { nc: NcDetail; editable: boolean }) {
  const h = texts.quality.holds;
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<Hold | null>(null);
  if (nc.holds.length === 0 && !editable) return null;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardTitle>{h.inNc}</CardTitle>
        {editable && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreating(true);
            }}
          >
            <PackageX className="size-4" aria-hidden="true" />
            {h.create}
          </Button>
        )}
      </div>
      {nc.holds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{h.inNcEmpty}</p>
      ) : (
        <ul className="-my-2 divide-y divide-border">
          {nc.holds.map((hold) => (
            <li key={hold.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{hold.product}</span>
                  <HoldStatusBadge status={hold.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[hold.lot, hold.quantity, hold.location].filter(Boolean).join(" · ")}
                </p>
                {hold.decision !== null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {h.decision.by(hold.decision.by.name, formatDateTime(hold.decision.at))}
                    {hold.decision.note !== null && ` · ${hold.decision.note}`}
                  </p>
                )}
              </div>
              {hold.canDecide && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDeciding(hold);
                  }}
                >
                  {h.decide}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <HoldDialog
            ncId={nc.id}
            onClose={() => {
              setCreating(false);
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={deciding !== null}
        onOpenChange={(open) => {
          if (!open) setDeciding(null);
        }}
      >
        {deciding !== null && (
          <DecisionDialog
            hold={deciding}
            onClose={() => {
              setDeciding(null);
            }}
          />
        )}
      </Dialog>
    </Card>
  );
}

function HistoryCard({ nc }: { nc: NcDetail }) {
  const { workspaceSlug = "" } = useParams();
  const events = useQuery({
    queryKey: qualityKeys.events(workspaceSlug, nc.id),
    queryFn: () => qualityApi.events(workspaceSlug, nc.id),
    select: (data) => data.items,
  });
  const kinds: Record<string, string> = t.history.kinds;
  const statusOf = (value: unknown) =>
    typeof value === "string" && value in texts.quality.statuses
      ? texts.quality.statuses[value as NcStatus]
      : null;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <CardTitle>{t.history.title}</CardTitle>
      {events.isPending ? (
        <Skeleton className="h-16" />
      ) : (
        <ol className="grid gap-2 border-l border-border pl-4">
          {(events.data ?? []).map((event) => {
            const to = statusOf(event.data.to);
            return (
              <li key={event.id} className="text-sm">
                <span className="font-medium">{kinds[event.kind] ?? event.kind}</span>
                {to !== null && <span className="text-muted-foreground"> {t.history.to(to)}</span>}
                <p className="text-xs text-muted-foreground">
                  {[event.actor?.name, formatDateTime(event.at)].filter(Boolean).join(" · ")}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function EditDialog({ nc, onClose }: { nc: NcDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { state, set } = useNcForm(nc);
  const manage = nc.access === "manage";
  const save = useMutation({
    mutationFn: () =>
      qualityApi.update(workspaceSlug, nc.id, {
        title: state.title.trim(),
        description: state.description.trim(),
        detectedOn: state.detectedOn,
        location: state.location.trim() === "" ? null : state.location.trim(),
        productAffected: state.productAffected,
        productNote:
          state.productAffected && state.productNote.trim() !== ""
            ? state.productNote.trim()
            : null,
        correction: state.correction.trim() === "" ? null : state.correction.trim(),
        origin: state.origin,
        severity: state.severity,
        departmentId: state.department?.id ?? null,
        ...(manage && state.owner !== null && state.owner.id !== nc.owner.id
          ? { ownerId: state.owner.id }
          : {}),
      }),
    onSuccess: async () => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      size="lg"
      title={t.editTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={!formReady(state, true) || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : texts.admin.common.save}
          </Button>
        </>
      }
    >
      <NcFields state={state} set={set} full ownerEditable={manage} />
    </DialogContent>
  );
}

function ReasonDialog({
  open,
  onOpenChange,
  kind,
  ncId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "cancel" | "reopen";
  ncId: string;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const c = kind === "cancel" ? t.cancel : t.reopen;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
      icon={kind === "cancel" ? Ban : RotateCcw}
      tone="warning"
      title={c.title}
      description={
        <span className="grid gap-3">
          <span>{c.description}</span>
          <label className="grid gap-1.5 text-foreground">
            <span className="text-sm font-medium">{c.reason}</span>
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
      confirmLabel={c.confirm}
      pendingLabel={c.pending}
      onConfirm={async () => {
        if (reason.trim() === "") throw new Error(c.reason);
        if (kind === "cancel") await qualityApi.cancel(workspaceSlug, ncId, reason.trim());
        else await qualityApi.reopen(workspaceSlug, ncId, reason.trim());
        toast.success(c.done);
        setReason("");
        await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      }}
    />
  );
}

export function NcPage() {
  const { workspaceSlug = "", ncId = "" } = useParams();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: qualityKeys.one(workspaceSlug, ncId),
    queryFn: () => qualityApi.get(workspaceSlug, ncId),
    select: (data) => data.nc,
  });
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<"cancel" | "reopen" | null>(null);
  const folder = useMutation({
    mutationFn: () => qualityApi.folder(workspaceSlug, ncId),
    onSuccess: async ({ folder: target }) => {
      await navigate(`/app/${workspaceSlug}/files/${target.spaceId}/f/${target.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const back = (
    <Link
      to={`/app/${workspaceSlug}/calidad/no-conformidades`}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {t.back}
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
  const nc = query.data;
  if (nc === undefined) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        {back}
        <Skeleton className="h-40" />
      </div>
    );
  }
  const open = nc.status !== "CLOSED" && nc.status !== "CANCELLED";
  const editable = open && nc.access !== "read";
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-4">
      <div className="grid gap-2">
        {back}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground tabular-nums">{nc.code}</p>
            <h1 className="break-words text-xl font-semibold tracking-tight">{nc.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SeverityBadge severity={nc.severity} />
              <NcStatusBadge status={nc.status} />
              <span className="text-xs text-muted-foreground">
                {t.reportedBy(nc.reportedBy.name, formatDateTime(nc.createdAt))}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(true);
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
                {t.edit}
              </Button>
            )}
            {open && nc.access === "manage" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReason("cancel");
                }}
              >
                <Ban className="size-4" aria-hidden="true" />
                {t.cancel.action}
              </Button>
            )}
            {nc.status === "CLOSED" && nc.access === "manage" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReason("reopen");
                }}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                {t.reopen.action}
              </Button>
            )}
          </div>
        </div>
      </div>
      {nc.status === "CANCELLED" && nc.cancelReason !== null ? (
        <Banner tone="warning">{t.cancel.banner(nc.cancelReason)}</Banner>
      ) : (
        <Card className="p-4 sm:p-5">
          <Steps status={nc.status} />
        </Card>
      )}
      {nc.access === "read" && open && <Banner tone="info">{t.readOnly}</Banner>}
      <Card className="grid gap-3 p-4 sm:p-5">
        <CardTitle>{t.description}</CardTitle>
        <dl className="grid gap-3">
          <Row label={t.description}>{nc.description}</Row>
          <Row label={t.origin}>{texts.quality.origins[nc.origin]}</Row>
          <Row label={t.detectedOn}>{formatUtcDate(nc.detectedOn)}</Row>
          <Row label={t.location}>{nc.location ?? t.none}</Row>
          <Row label={t.owner}>{nc.owner.name}</Row>
          <Row label={t.department}>{nc.department?.name ?? t.none}</Row>
          {nc.audit !== null && (
            <Row label={t.audit}>
              <Link
                to={`/app/${workspaceSlug}/calidad/auditorias/${nc.audit.id}`}
                className="underline-offset-4 hover:underline"
              >
                {texts.quality.audits.fromAudit(nc.audit.title, nc.audit.clause)}
              </Link>
            </Row>
          )}
          {nc.record !== null && (
            <Row label={t.record}>
              <Link
                to={`/app/${workspaceSlug}/files/${nc.record.spaceId}/form/${nc.record.formId}/r/${nc.record.id}`}
                className="underline-offset-4 hover:underline"
              >
                {nc.record.label}
              </Link>
              {nc.fieldIds.length > 0 && (
                <span className="text-muted-foreground"> · {t.fields(nc.fieldIds.length)}</span>
              )}
            </Row>
          )}
          <Row label={t.product}>
            {nc.productAffected ? (nc.productNote ?? t.none) : t.productNone}
          </Row>
          <Row label={t.correction}>{nc.correction ?? t.none}</Row>
        </dl>
      </Card>
      <CauseCard key={`${nc.id}-${nc.causeMethod ?? ""}`} nc={nc} editable={editable} />
      <ActionsCard nc={nc} editable={editable} />
      <HoldsCard nc={nc} editable={editable} />
      <VerificationCard key={nc.verifyOn ?? "none"} nc={nc} />
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <CardTitle>{t.evidence.title}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t.evidence.hint}</p>
        </div>
        {(nc.folder !== null || editable) && (
          <Button
            variant="outline"
            size="sm"
            disabled={folder.isPending}
            onClick={() => {
              if (nc.folder !== null) {
                void navigate(`/app/${workspaceSlug}/files/${nc.folder.spaceId}/f/${nc.folder.id}`);
              } else folder.mutate();
            }}
          >
            <FolderOpen className="size-4" aria-hidden="true" />
            {t.evidence.open}
          </Button>
        )}
      </Card>
      <HistoryCard nc={nc} />
      <Dialog open={editing} onOpenChange={setEditing}>
        {editing && (
          <EditDialog
            nc={nc}
            onClose={() => {
              setEditing(false);
            }}
          />
        )}
      </Dialog>
      {reason !== null && (
        <ReasonDialog
          open
          kind={reason}
          ncId={nc.id}
          onOpenChange={(next) => {
            if (!next) setReason(null);
          }}
        />
      )}
    </div>
  );
}
