// /app/:slug/mantenimiento/ot/:id — a work order (docs/spec/mantenimiento.md, section 2): its equipment and
// description, the actions its status allows (take, start, hold, done, hygiene release, close), time and
// spare parts, the resolution and its history. The server decides what each person can do (`can`).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock, Mic, Pencil, Plus, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatDateTime, formatUtcDate } from "@/lib/utils";
import {
  maintenanceApi,
  maintenanceKeys,
  type Part,
  type WorkAction,
  type WorkOrderDetail,
} from "./maintenance-api";
import { PriorityBadge, StatusBadge, todayDay } from "./maintenance-common";
import { lowAfter, PartPicker } from "./part-picker";
import { SuggestionCard } from "./suggestion-card";
import { useVoice } from "./voice-capture";
import { VoiceCloseDialog, VoiceNotes } from "./voice-close";
import { WorkOrderDialog } from "./work-orders-page";
import { locale, texts } from "@/i18n";

const t = texts.maintenance.detail;
const k = texts.maintenance;

type Asking =
  "hold" | "done" | "voice" | "cancel" | "labor" | "part" | "close" | "reopen" | "release" | "edit";

export function WorkOrderPage() {
  const { workspaceSlug = "", workOrderId = "" } = useParams();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: maintenanceKeys.workOrder(workspaceSlug, workOrderId),
    queryFn: () => maintenanceApi.workOrder(workspaceSlug, workOrderId),
    select: (data) => data.workOrder,
  });
  const [asking, setAsking] = useState<Asking | null>(null);
  const voice = useVoice();
  const act = useMutation({
    mutationFn: (body: WorkAction) => maintenanceApi.act(workspaceSlug, workOrderId, body),
    onSuccess: async (result, body) => {
      setAsking(null);
      queryClient.setQueryData(maintenanceKeys.workOrder(workspaceSlug, workOrderId), result);
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
      // Ticking a task shows itself: no toast for each one.
      if (body.action !== "check") toast.success(t.done);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const back = (
    <Link
      to={`/app/${workspaceSlug}/mantenimiento/ot`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {t.back}
    </Link>
  );
  if (detail.isError) {
    return (
      <div className="grid gap-4">
        {back}
        <Card>
          <EmptyState icon={Wrench} title={adminErrorText(detail.error)}>
            {null}
          </EmptyState>
        </Card>
      </div>
    );
  }
  const data = detail.data;
  if (data === undefined) return <Skeleton className="h-96 w-full" />;
  const busy = act.isPending;
  const open = ["REPORTED", "PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(data.status);
  const running = data.labor.some((entry) => entry.endedAt === null);
  const run = (body: WorkAction) => {
    act.mutate(body);
  };
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl grid-cols-1 gap-4">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="tabular-nums">{data.code}</span>
            <PriorityBadge priority={data.priority} />
            <StatusBadge status={data.status} />
            <span>{k.kinds[data.kind]}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.reportedBy(data.reportedBy.name, formatDateTime(data.reportedAt))}
          </p>
          {data.nc !== null && (
            <p className="mt-1 text-xs">
              {texts.maintenance.quality.fromNc}:{" "}
              <Link
                to={`/app/${workspaceSlug}/calidad/no-conformidades/${data.nc.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {data.nc.code}
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {data.can.work && open && data.assignedTo === null && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                run({ action: "take" });
              }}
            >
              {t.actions.take}
            </Button>
          )}
          {data.can.work && open && !running && data.status !== "ON_HOLD" && (
            <Button
              disabled={busy}
              onClick={() => {
                run({ action: "start" });
              }}
            >
              {t.actions.start}
            </Button>
          )}
          {data.can.work && running && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                run({ action: "stop", note: "" });
              }}
            >
              {t.actions.stop}
            </Button>
          )}
          {data.can.work && data.status === "ON_HOLD" && (
            <Button
              disabled={busy}
              onClick={() => {
                run({ action: "resume" });
              }}
            >
              {t.actions.resume}
            </Button>
          )}
          {data.can.work && open && data.status !== "ON_HOLD" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAsking("hold");
              }}
            >
              {t.actions.hold}
            </Button>
          )}
          {data.can.work && open && (
            <Button
              variant={data.status === "IN_PROGRESS" ? "primary" : "outline"}
              disabled={busy}
              onClick={() => {
                setAsking("done");
              }}
            >
              {t.actions.done}
            </Button>
          )}
          {data.can.work && open && voice.available && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAsking("voice");
              }}
            >
              <Mic className="size-4" aria-hidden="true" />
              {texts.maintenance.voice.closeByVoice}
            </Button>
          )}
          {data.can.releaseHygiene && (
            <Button
              disabled={busy}
              onClick={() => {
                setAsking("release");
              }}
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              {t.actions.release}
            </Button>
          )}
          {data.can.close && (
            <Button
              disabled={busy || (data.needsHygiene && data.hygieneReleasedAt === null)}
              onClick={() => {
                setAsking("close");
              }}
            >
              {t.actions.close}
            </Button>
          )}
          {data.can.close && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setAsking("reopen");
              }}
            >
              {t.actions.reopen}
            </Button>
          )}
          {data.can.edit && (
            <Button
              size="icon"
              variant="ghost"
              className="size-9"
              aria-label={t.actions.edit}
              onClick={() => {
                setAsking("edit");
              }}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {data.lockout && open && (
        <Banner tone="warning" icon={Lock}>
          {t.lockoutWarning}
        </Banner>
      )}
      {data.status === "ON_HOLD" && data.holdReason !== "" && (
        <Banner tone="info">{t.hold(data.holdReason)}</Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-4">
          <Section title={t.asset}>
            {data.asset === null ? (
              <p className="text-sm text-muted-foreground">{t.noAsset}</p>
            ) : (
              <p className="text-sm">
                <span className="font-medium tabular-nums">{data.asset.code}</span>{" "}
                {data.asset.name}
              </p>
            )}
            {data.description !== "" && (
              <p className="whitespace-pre-line text-sm">{data.description}</p>
            )}
            {data.plan !== null && (
              <p className="text-xs text-muted-foreground">
                {texts.maintenance.checklist.fromPlan}:{" "}
                <Link
                  to={`/app/${workspaceSlug}/mantenimiento/preventivo`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {data.plan.name}
                </Link>
              </p>
            )}
          </Section>

          {/* Breakdowns only: a preventive or a calibration follows its plan's tasks. */}
          {data.kind !== "PREVENTIVE" && data.kind !== "CALIBRATION" && (
            <SuggestionCard data={data} canAsk={voice.ai && data.can.work && open} />
          )}

          {data.checklist.length > 0 && (
            <Section
              title={texts.maintenance.checklist.title}
              action={
                <span className="text-xs text-muted-foreground tabular-nums">
                  {texts.maintenance.checklist.progress(
                    data.checklist.filter((step) => step.done).length,
                    data.checklist.length,
                  )}
                </span>
              }
            >
              <ul className="grid gap-2">
                {data.checklist.map((step, index) => (
                  // The steps are the plan's, in order: their position is their identity.
                  <li key={`${String(index)}-${step.text}`}>
                    <Checkbox
                      label={step.text}
                      checked={step.done}
                      disabled={!data.can.work || !open || busy}
                      onChange={(event) => {
                        run({ action: "check", index, done: event.target.checked });
                      }}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title={t.work}
            action={
              data.can.work ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAsking("labor");
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {t.addLabor}
                </Button>
              ) : undefined
            }
          >
            {data.labor.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noLabor}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.labor.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                  >
                    <span>
                      <span className="font-medium">{entry.person.name}</span>{" "}
                      <span className="text-muted-foreground">
                        {formatDateTime(entry.startedAt)}
                      </span>
                      {entry.note !== "" && (
                        <span className="text-muted-foreground"> · {entry.note}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="tabular-nums">
                        {entry.endedAt === null ? t.running : k.common.minutes(entry.minutes ?? 0)}
                      </span>
                      {data.can.work && entry.endedAt !== null && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={texts.admin.common.cancel}
                          disabled={busy}
                          onClick={() => {
                            run({ action: "remove_labor", laborId: entry.id });
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.totalMinutes > 0 && (
              <p className="text-xs text-muted-foreground">
                {t.totalTime(k.common.minutes(data.totalMinutes))}
              </p>
            )}
          </Section>

          <Section
            title={t.parts}
            action={
              data.can.work ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAsking("part");
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {t.addPart}
                </Button>
              ) : undefined
            }
          >
            {data.parts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noParts}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.parts.map((part) => (
                  <li key={part.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      {part.partCode !== "" && (
                        <span className="font-medium tabular-nums">{part.partCode} </span>
                      )}
                      {part.description}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="tabular-nums">
                        {part.quantity.toLocaleString(locale)} {part.unit}
                      </span>
                      {data.can.work && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={texts.admin.common.cancel}
                          disabled={busy}
                          onClick={() => {
                            run({ action: "remove_part", partId: part.id });
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {(data.solution !== "" || data.cause !== "") && (
            <Section title={t.resolution}>
              <dl className="grid gap-2 text-sm">
                {data.cause !== "" && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{t.cause}</dt>
                    <dd className="whitespace-pre-line">{data.cause}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">{t.solution}</dt>
                  <dd className="whitespace-pre-line">{data.solution}</dd>
                </div>
                {data.downtimeMinutes !== null && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{t.downtime}</dt>
                    <dd>{k.common.minutes(data.downtimeMinutes)}</dd>
                  </div>
                )}
              </dl>
            </Section>
          )}
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <Section title={k.form.assigned}>
            <p className="text-sm">{data.assignedTo?.name ?? k.form.assignedPlaceholder}</p>
            {data.dueOn !== null && (
              <p className="text-xs text-muted-foreground">
                {k.form.dueOn}: {formatUtcDate(data.dueOn)}
              </p>
            )}
          </Section>
          {data.needsHygiene && (
            <Section title={t.hygiene}>
              <p className="text-sm">
                {data.hygieneReleasedBy !== null && data.hygieneReleasedAt !== null
                  ? t.hygieneDone(
                      data.hygieneReleasedBy.name,
                      formatDateTime(data.hygieneReleasedAt),
                    )
                  : t.hygieneNeeded}
              </p>
            </Section>
          )}
          {data.recordings.length > 0 && (
            <Section title={texts.maintenance.voice.recordings}>
              <VoiceNotes data={data} />
            </Section>
          )}
          <Section title={t.timeline}>
            <ol className="grid gap-2 text-sm">
              {data.events.map((entry) => (
                <li key={entry.id} className="grid gap-0.5">
                  <span>
                    <span className="font-medium">{entry.who ?? ""}</span>{" "}
                    {(t.events as Record<string, string | undefined>)[entry.action] ?? entry.action}
                    {entry.detail !== "" && (
                      <span className="text-muted-foreground"> · {entry.detail}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </Section>
          {data.can.edit && (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                setAsking("cancel");
              }}
            >
              {t.actions.cancel}
            </Button>
          )}
        </div>
      </div>

      {asking === "edit" && (
        <WorkOrderDialog
          workOrder={data}
          onClose={() => {
            setAsking(null);
          }}
        />
      )}
      {asking === "hold" && (
        <TextDialog
          title={t.dialogs.holdTitle}
          label={t.dialogs.holdReason}
          hint={t.dialogs.holdHint}
          busy={busy}
          onClose={() => {
            setAsking(null);
          }}
          onConfirm={(reason) => {
            run({ action: "hold", reason });
          }}
        />
      )}
      {asking === "cancel" && (
        <TextDialog
          title={t.dialogs.cancelTitle}
          label={t.dialogs.cancelReason}
          busy={busy}
          onClose={() => {
            setAsking(null);
          }}
          onConfirm={(reason) => {
            run({ action: "cancel", reason });
          }}
        />
      )}
      {asking === "done" && (
        <DoneDialog
          data={data}
          busy={busy}
          onClose={() => {
            setAsking(null);
          }}
          onConfirm={(body) => {
            run(body);
          }}
        />
      )}
      {asking === "voice" && (
        <VoiceCloseDialog
          data={data}
          serverTranscription={voice.serverTranscription}
          onClose={() => {
            setAsking(null);
          }}
        />
      )}
      {asking === "labor" && (
        <LaborDialog
          busy={busy}
          onClose={() => {
            setAsking(null);
          }}
          onConfirm={run}
        />
      )}
      {asking === "part" && (
        <PartDialog
          busy={busy}
          onClose={() => {
            setAsking(null);
          }}
          onConfirm={run}
        />
      )}
      <ConfirmDialog
        open={asking === "close" || asking === "reopen" || asking === "release"}
        onOpenChange={(value) => {
          if (!value) setAsking(null);
        }}
        icon={asking === "release" ? ShieldCheck : Wrench}
        tone="primary"
        title={
          asking === "close"
            ? t.actions.close
            : asking === "reopen"
              ? t.actions.reopen
              : t.actions.release
        }
        description={asking === "release" ? t.hygieneNeeded : data.title}
        confirmLabel={t.dialogs.confirm}
        pendingLabel={texts.admin.common.saving}
        onConfirm={async () => {
          const body: WorkAction | null =
            asking === "close"
              ? { action: "close" }
              : asking === "reopen"
                ? { action: "reopen" }
                : asking === "release"
                  ? { action: "release_hygiene" }
                  : null;
          if (body !== null) await act.mutateAsync(body).catch(() => undefined);
        }}
      />
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="grid gap-2 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Footer({ busy, ready, onSave }: { busy: boolean; ready: boolean; onSave: () => void }) {
  return (
    <>
      <DialogClose asChild>
        <Button variant="outline" disabled={busy}>
          {texts.admin.common.cancel}
        </Button>
      </DialogClose>
      <Button disabled={!ready || busy} onClick={onSave}>
        {t.dialogs.confirm}
      </Button>
    </>
  );
}

function TextDialog({
  title,
  label,
  hint,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  label: string;
  hint?: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        title={title}
        footer={
          <Footer
            busy={busy}
            ready={text.trim() !== ""}
            onSave={() => {
              onConfirm(text.trim());
            }}
          />
        }
      >
        <FormField label={label} {...(hint === undefined ? {} : { hint })}>
          {(control) => (
            <Input
              {...control}
              maxLength={120}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          )}
        </FormField>
      </DialogContent>
    </Dialog>
  );
}

function DoneDialog({
  data,
  busy,
  onClose,
  onConfirm,
}: {
  data: WorkOrderDetail;
  busy: boolean;
  onClose: () => void;
  onConfirm: (body: WorkAction) => void;
}) {
  const d = t.dialogs;
  const [cause, setCause] = useState(data.cause);
  const [solution, setSolution] = useState(data.solution);
  const [downtime, setDowntime] = useState(
    data.downtimeMinutes === null ? "" : String(data.downtimeMinutes),
  );
  const minutes = downtime.trim() === "" ? null : Number.parseInt(downtime, 10);
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={d.doneTitle}
        description={data.title}
        footer={
          <Footer
            busy={busy}
            ready={
              solution.trim() !== "" &&
              (minutes === null || (Number.isInteger(minutes) && minutes >= 0))
            }
            onSave={() => {
              onConfirm({
                action: "done",
                cause: cause.trim(),
                solution: solution.trim(),
                downtimeMinutes: minutes,
              });
            }}
          />
        }
      >
        <div className="grid gap-4">
          <FormField label={d.solution}>
            {(control) => (
              <Textarea
                {...control}
                rows={4}
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
          <FormField label={d.downtime} hint={d.downtimeHint}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                className="w-32"
                value={downtime}
                onChange={(event) => {
                  setDowntime(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LaborDialog({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: (body: WorkAction) => void;
}) {
  const d = t.dialogs;
  const [day, setDay] = useState(todayDay());
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const value = Number.parseInt(minutes, 10);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={d.laborTitle}
        footer={
          <Footer
            busy={busy}
            ready={day !== "" && Number.isInteger(value) && value > 0}
            onSave={() => {
              onConfirm({ action: "labor", day, minutes: value, note: note.trim() });
            }}
          />
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={d.laborDay}>
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
            <FormField label={d.laborMinutes}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  max={1440}
                  value={minutes}
                  onChange={(event) => {
                    setMinutes(event.target.value);
                  }}
                />
              )}
            </FormField>
          </div>
          <FormField label={d.laborNote}>
            {(control) => (
              <Input
                {...control}
                maxLength={200}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PartDialog({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: (body: WorkAction) => void;
}) {
  const d = t.dialogs;
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("ud");
  const [chosen, setChosen] = useState<Part | null>(null);
  const amount = Number(quantity.replace(",", "."));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={d.partTitle}
        footer={
          <Footer
            busy={busy}
            ready={
              description.trim() !== "" &&
              Number.isFinite(amount) &&
              amount > 0 &&
              unit.trim() !== ""
            }
            onSave={() => {
              onConfirm({
                action: "part",
                partCode: code.trim(),
                description: description.trim(),
                quantity: amount,
                unit: unit.trim(),
              });
            }}
          />
        }
      >
        <div className="grid gap-4">
          <PartPicker
            chosen={chosen}
            onChoose={(part) => {
              setChosen(part);
              setCode(part.code);
              setDescription(part.description);
              setUnit(part.unit);
            }}
          />
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <FormField label={d.partCode} hint={d.partCodeHint}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setChosen(null);
                  }}
                />
              )}
            </FormField>
            <FormField label={d.partDescription}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={160}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={d.partQuantity}>
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                  }}
                />
              )}
            </FormField>
            <FormField label={d.partUnit}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={20}
                  value={unit}
                  onChange={(event) => {
                    setUnit(event.target.value);
                  }}
                />
              )}
            </FormField>
          </div>
          {Number.isFinite(amount) && lowAfter(chosen, amount) && (
            <Banner tone="warning">{texts.maintenance.parts.lowAfter}</Banner>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
