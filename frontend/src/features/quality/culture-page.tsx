// /app/:slug/calidad/cultura — food safety culture (docs/spec/calidad.md, «Fase 6c»): the year's objectives,
// its activities and the anonymous surveys with their results. quality.manage plans and runs the surveys,
// an activity's responsible person marks it done, quality.view reads everything; the rest see only the
// activities they're in charge of. The year lives in the address (?anio=2026).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  HeartHandshake,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatNumber, formatUtcDate } from "@/lib/utils";
import {
  CULTURE_KINDS,
  cultureApi,
  cultureKeys,
  type CultureActivity,
  type SurveyState,
  type SurveySummary,
} from "./culture-api";
import { qualityKeys } from "./quality-api";
import { todayDay, usePeopleSource, useQuality } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.culture;

function useSaved(onClose: () => void) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return {
    done: async (message: string) => {
      toast.success(message);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cultureKeys.all(workspaceSlug) }),
        queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) }),
      ]);
      onClose();
    },
    onError: (error: unknown) => {
      toast.error(adminErrorText(error));
    },
  };
}

function Footer({
  pending,
  ready,
  label,
  onSave,
}: {
  pending: boolean;
  ready: boolean;
  label: string;
  onSave: () => void;
}) {
  return (
    <>
      <DialogClose asChild>
        <Button variant="outline" disabled={pending}>
          {texts.admin.common.cancel}
        </Button>
      </DialogClose>
      <Button disabled={!ready || pending} onClick={onSave}>
        {pending ? texts.admin.common.saving : label}
      </Button>
    </>
  );
}

function PlanDialog({
  year,
  objectives,
  onClose,
}: {
  year: number;
  objectives: string;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const [text, setText] = useState(objectives);
  const saved = useSaved(onClose);
  const save = useMutation({
    mutationFn: () => cultureApi.savePlan(workspaceSlug, year, text.trim()),
    onSuccess: () => saved.done(t.plan.saved),
    onError: saved.onError,
  });
  return (
    <DialogContent
      title={t.plan.dialogTitle(year)}
      footer={
        <Footer
          pending={save.isPending}
          ready
          label={texts.admin.common.save}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormField label={t.plan.title}>
        {(control) => (
          <Textarea
            {...control}
            rows={8}
            maxLength={4000}
            placeholder={t.plan.placeholder}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        )}
      </FormField>
    </DialogContent>
  );
}

function ActivityDialog({
  year,
  activity,
  onClose,
}: {
  year: number;
  activity?: CultureActivity | undefined;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const f = t.activities.form;
  const people = usePeopleSource();
  const kinds = useStaticSource(
    "quality-culture-kinds",
    CULTURE_KINDS.map((id) => ({ id, label: t.activities.kinds[id] })),
  );
  const [state, setState] = useState({
    title: activity?.title ?? "",
    kind: activity?.kind ?? "TRAINING",
    plannedOn: activity?.plannedOn ?? todayDay(),
    responsible: activity?.responsible ?? null,
    note: activity?.note ?? "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const saved = useSaved(onClose);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: state.title.trim(),
        kind: state.kind,
        plannedOn: state.plannedOn,
        responsibleId: state.responsible?.id ?? null,
        note: state.note.trim() === "" ? null : state.note.trim(),
      };
      return activity === undefined
        ? cultureApi.createActivity(workspaceSlug, { ...body, year })
        : cultureApi.updateActivity(workspaceSlug, activity.id, body);
    },
    onSuccess: () => saved.done(activity === undefined ? f.created : f.saved),
    onError: saved.onError,
  });
  const ready = state.title.trim() !== "" && state.plannedOn !== "";
  return (
    <DialogContent
      title={activity === undefined ? f.title : f.editTitle}
      footer={
        <Footer
          pending={save.isPending}
          ready={ready}
          label={activity === undefined ? texts.admin.common.create : texts.admin.common.save}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <FormField label={f.name}>
          {(control) => (
            <Input
              {...control}
              maxLength={160}
              placeholder={f.namePlaceholder}
              value={state.title}
              onChange={(event) => {
                set({ title: event.target.value });
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.kind}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.kind}
                placeholder={f.kind}
                source={kinds}
                value={state.kind}
                onChange={(option) => {
                  const next = CULTURE_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) set({ kind: next });
                }}
              />
            )}
          </FormField>
          <FormField label={f.plannedOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={state.plannedOn}
                onChange={(event) => {
                  set({ plannedOn: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.responsible}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={f.responsible}
              placeholder={f.responsiblePlaceholder}
              source={people}
              value={state.responsible?.id ?? null}
              valueLabel={state.responsible?.name}
              onChange={(option) => {
                set({
                  responsible: option === null ? null : { id: option.id, name: option.label },
                });
              }}
            />
          )}
        </FormField>
        <FormField label={f.note}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={1000}
              value={state.note}
              onChange={(event) => {
                set({ note: event.target.value });
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

function DoneDialog({ activity, onClose }: { activity: CultureActivity; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const [doneOn, setDoneOn] = useState(todayDay());
  const saved = useSaved(onClose);
  const save = useMutation({
    mutationFn: () => cultureApi.done(workspaceSlug, activity.id, doneOn),
    onSuccess: () => saved.done(t.activities.doneSaved),
    onError: saved.onError,
  });
  return (
    <DialogContent
      title={t.activities.doneDialog.title}
      footer={
        <Footer
          pending={save.isPending}
          ready={doneOn !== ""}
          label={t.activities.markDone}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <p className="text-sm font-medium">{activity.title}</p>
      <FormField label={t.activities.doneDialog.doneOn}>
        {(control) => (
          <Input
            {...control}
            type="date"
            max={todayDay()}
            value={doneOn}
            onChange={(event) => {
              setDoneOn(event.target.value);
            }}
          />
        )}
      </FormField>
    </DialogContent>
  );
}

function SurveyDialog({
  survey,
  onClose,
}: {
  survey?: SurveySummary | undefined;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const f = t.surveys.form;
  const full = useQuery({
    queryKey: cultureKeys.survey(workspaceSlug, survey?.id ?? ""),
    queryFn: () => cultureApi.survey(workspaceSlug, survey?.id ?? ""),
    enabled: survey !== undefined,
    select: (data) => data.survey,
  });
  const year = new Date().getFullYear();
  const [state, setState] = useState<{
    title: string;
    opensOn: string;
    closesOn: string;
    questions: string | null;
  }>({
    title: survey?.title ?? f.defaultTitle(year),
    opensOn: survey?.opensOn ?? todayDay(),
    closesOn: survey?.closesOn ?? `${String(year)}-12-31`,
    questions: null,
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const questions = state.questions ?? full.data?.questions.join("\n") ?? "";
  const lines = questions
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const saved = useSaved(onClose);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: state.title.trim(),
        opensOn: state.opensOn,
        closesOn: state.closesOn,
        ...(lines.length === 0 ? {} : { questions: lines }),
      };
      return survey === undefined
        ? cultureApi.createSurvey(workspaceSlug, body)
        : cultureApi.updateSurvey(workspaceSlug, survey.id, body);
    },
    onSuccess: () => saved.done(survey === undefined ? f.created : f.saved),
    onError: saved.onError,
  });
  const datesOk = state.opensOn !== "" && state.closesOn !== "" && state.closesOn >= state.opensOn;
  const ready =
    state.title.trim() !== "" &&
    datesOk &&
    lines.length <= 20 &&
    lines.every((line) => line.length <= 200) &&
    (survey === undefined || lines.length > 0);
  return (
    <DialogContent
      size="lg"
      title={survey === undefined ? f.title : f.editTitle}
      footer={
        <Footer
          pending={save.isPending}
          ready={ready}
          label={survey === undefined ? texts.admin.common.create : texts.admin.common.save}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <FormField label={f.name}>
          {(control) => (
            <Input
              {...control}
              maxLength={160}
              value={state.title}
              onChange={(event) => {
                set({ title: event.target.value });
              }}
            />
          )}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.opensOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={state.opensOn}
                onChange={(event) => {
                  set({ opensOn: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.closesOn} error={datesOk || state.closesOn === "" ? undefined : f.datesOrder}>
            {(control) => (
              <Input
                {...control}
                type="date"
                min={state.opensOn}
                value={state.closesOn}
                onChange={(event) => {
                  set({ closesOn: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <FormField
          label={f.questions}
          hint={survey === undefined ? `${f.questionsHint} ${f.defaultsHint}` : f.questionsHint}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={10}
              value={questions}
              onChange={(event) => {
                set({ questions: event.target.value });
              }}
            />
          )}
        </FormField>
        <p className="text-xs text-muted-foreground">{t.surveys.anonymity}</p>
      </FormGrid>
    </DialogContent>
  );
}

/** One question's answers, from 1 to 5, as a stacked bar with its counts below. */
function Distribution({ counts }: { counts: number[] }) {
  const total = counts.reduce((sum, n) => sum + n, 0);
  const shades = ["bg-danger", "bg-warning", "bg-muted-foreground/40", "bg-primary/60", "bg-primary"];
  return (
    <div className="grid gap-1">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {counts.map((n, index) =>
          n === 0 ? null : (
            <div
              key={index}
              className={shades[index]}
              style={{ width: `${String((n / Math.max(total, 1)) * 100)}%` }}
            />
          ),
        )}
      </div>
      <ul className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {counts.map((n, index) => (
          <li key={index} className="tabular-nums">
            {String(index + 1)}: {n}
            <span className="sr-only"> ({t.scale[index]})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultsDialog({ survey }: { survey: SurveySummary }) {
  const { workspaceSlug = "" } = useParams();
  const r = t.results;
  const query = useQuery({
    queryKey: cultureKeys.results(workspaceSlug, survey.id),
    queryFn: () => cultureApi.results(workspaceSlug, survey.id),
  });
  const data = query.data;
  return (
    <DialogContent size="lg" title={survey.title}>
      {data === undefined ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-3">
              <dt className="text-xs text-muted-foreground">{r.participation}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {data.participation === null ? "—" : `${String(Math.round(data.participation))} %`}
              </dd>
              <dd className="text-xs text-muted-foreground">
                {r.participationValue(data.answers, data.eligible)}
              </dd>
            </div>
            <div className="rounded-xl border border-border p-3">
              <dt className="text-xs text-muted-foreground">{r.average}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {data.average === null ? "—" : formatNumber(Math.round(data.average * 10) / 10)}
              </dd>
            </div>
          </dl>
          {data.hidden ? (
            <p className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {r.hidden(data.minimum)}
            </p>
          ) : (
            <>
              <ol className="grid gap-3">
                {data.questions.map((question, index) => (
                  <li key={index} className="grid gap-2 border-b border-border pb-3 last:border-b-0">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span>
                        {String(index + 1)}. {question.text}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatNumber(Math.round(question.average * 10) / 10)}
                      </span>
                    </div>
                    <Distribution counts={question.distribution} />
                  </li>
                ))}
              </ol>
              <div className="grid gap-2">
                <CardTitle>{r.comments}</CardTitle>
                {data.comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{r.noComments}</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">{r.commentsHint}</p>
                    <ul className="grid gap-2">
                      {data.comments.map((comment, index) => (
                        <li
                          key={index}
                          className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm"
                        >
                          {comment}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </DialogContent>
  );
}

const surveyTone: Record<SurveyState, "primary" | "neutral" | "success"> = {
  scheduled: "neutral",
  open: "primary",
  closed: "success",
};

type DialogState =
  | { kind: "plan" }
  | { kind: "activity"; activity?: CultureActivity }
  | { kind: "done"; activity: CultureActivity }
  | { kind: "survey"; survey?: SurveySummary }
  | { kind: "results"; survey: SurveySummary }
  | null;

function ActivityRow({
  activity,
  busy,
  onOpen,
  onReopen,
  onArchive,
}: {
  activity: CultureActivity;
  busy: boolean;
  onOpen: (dialog: DialogState) => void;
  onReopen: () => void;
  onArchive: () => void;
}) {
  const a = t.activities;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-sm font-medium">{activity.title}</p>
        <p className="text-xs text-muted-foreground">
          {[a.kinds[activity.kind], activity.responsible?.name ?? a.noResponsible].join(" · ")}
        </p>
        {activity.note !== null && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {activity.note}
          </p>
        )}
      </div>
      <dl className="grid w-56 shrink-0 grid-cols-2 gap-4 text-xs">
        <div>
          <dt className="text-muted-foreground">{a.planned}</dt>
          <dd className="whitespace-nowrap tabular-nums">{formatUtcDate(activity.plannedOn)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{a.done}</dt>
          <dd className="whitespace-nowrap tabular-nums">
            {activity.doneOn === null ? "—" : formatUtcDate(activity.doneOn)}
          </dd>
        </div>
      </dl>
      <div className="w-24 shrink-0">
        {activity.doneOn !== null ? (
          <Badge tone="success">{a.done}</Badge>
        ) : activity.overdue ? (
          <Badge tone="danger">{a.overdue}</Badge>
        ) : (
          <Badge tone="neutral">{a.pending}</Badge>
        )}
      </div>
      <div className="flex items-center gap-1">
        {activity.access !== "read" &&
          (activity.doneOn === null ? (
            <Button
              size="sm"
              onClick={() => {
                onOpen({ kind: "done", activity });
              }}
            >
              <Check className="size-4" aria-hidden="true" />
              {a.markDone}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={a.reopen}
              disabled={busy}
              onClick={onReopen}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
            </Button>
          ))}
        {activity.access === "manage" && (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={a.edit}
              onClick={() => {
                onOpen({ kind: "activity", activity });
              }}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={a.archive}
              disabled={busy}
              onClick={onArchive}
            >
              <Archive className="size-4" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function SurveyRow({
  survey,
  manage,
  busy,
  onOpen,
  onClose,
}: {
  survey: SurveySummary;
  manage: boolean;
  busy: boolean;
  onOpen: (dialog: DialogState) => void;
  onClose: () => void;
}) {
  const s = t.surveys;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-sm font-medium">{survey.title}</p>
        <p className="text-xs text-muted-foreground">
          {[
            s.period(formatUtcDate(survey.opensOn), formatUtcDate(survey.closesOn)),
            texts.quality.culture.pending.questions(survey.questions),
            s.answers(survey.answers),
          ].join(" · ")}
        </p>
      </div>
      <Badge tone={surveyTone[survey.state]}>{s.states[survey.state]}</Badge>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onOpen({ kind: "results", survey });
          }}
        >
          <BarChart3 className="size-4" aria-hidden="true" />
          {s.results}
        </Button>
        {manage && survey.state !== "closed" && survey.answers === 0 && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={s.edit}
            onClick={() => {
              onOpen({ kind: "survey", survey });
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        )}
        {manage && survey.state !== "closed" && (
          <Button variant="ghost" size="icon" aria-label={s.close} disabled={busy} onClick={onClose}>
            <Lock className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </li>
  );
}

export function CulturePage() {
  const { workspaceSlug = "" } = useParams();
  const { view } = useQuality();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get("anio"));
  const year = Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : undefined;
  const [dialog, setDialog] = useState<DialogState>(null);
  const query = useQuery({
    queryKey: cultureKeys.overview(workspaceSlug, year),
    queryFn: () => cultureApi.overview(workspaceSlug, year),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: cultureKeys.all(workspaceSlug) }),
      queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) }),
    ]);
  };
  const onError = (error: unknown) => {
    toast.error(adminErrorText(error));
  };
  const reopen = useMutation({
    mutationFn: (activity: CultureActivity) => cultureApi.done(workspaceSlug, activity.id, null),
    onSuccess: async () => {
      toast.success(t.activities.reopened);
      await refresh();
    },
    onError,
  });
  const archive = useMutation({
    mutationFn: (activity: CultureActivity) =>
      cultureApi.archiveActivity(workspaceSlug, activity.id),
    onSuccess: async () => {
      toast.success(t.activities.archived);
      await refresh();
    },
    onError,
  });
  const closeSurvey = useMutation({
    mutationFn: (survey: SurveySummary) => cultureApi.closeSurvey(workspaceSlug, survey.id),
    onSuccess: async () => {
      toast.success(t.surveys.closed);
      await refresh();
    },
    onError,
  });
  const close = () => {
    setDialog(null);
  };
  const data = query.data;
  const shown = data?.year ?? year ?? new Date().getFullYear();
  const goTo = (next: number) => {
    setParams((current) => {
      const copy = new URLSearchParams(current);
      copy.set("anio", String(next));
      return copy;
    });
  };
  const manage = data?.canManage ?? false;
  const busy = reopen.isPending || archive.isPending;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label={t.year}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.previousYear}
            onClick={() => {
              goTo(shown - 1);
            }}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="min-w-14 text-center text-sm font-semibold tabular-nums" aria-live="polite">
            {shown}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.nextYear}
            onClick={() => {
              goTo(shown + 1);
            }}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="h-60" />
      ) : (
        <>
          {view && (
            <Card className="grid gap-2 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{t.plan.title}</CardTitle>
                {manage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDialog({ kind: "plan" });
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    {t.plan.edit}
                  </Button>
                )}
              </div>
              {data.objectives === "" ? (
                <p className="text-sm text-muted-foreground">{t.plan.empty}</p>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm">{data.objectives}</p>
              )}
            </Card>
          )}
          <Card className="grid gap-1 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{t.activities.title}</CardTitle>
              {manage && (
                <Button
                  size="sm"
                  onClick={() => {
                    setDialog({ kind: "activity" });
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {t.activities.create}
                </Button>
              )}
            </div>
            {data.activities.length === 0 ? (
              <EmptyState icon={HeartHandshake}>
                {view ? t.activities.empty : t.activities.emptyMine}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {data.activities.map((activity) => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    busy={busy}
                    onOpen={setDialog}
                    onReopen={() => {
                      reopen.mutate(activity);
                    }}
                    onArchive={() => {
                      archive.mutate(activity);
                    }}
                  />
                ))}
              </ul>
            )}
          </Card>
          {view && (
            <Card className="grid gap-1 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{t.surveys.title}</CardTitle>
                {manage && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setDialog({ kind: "survey" });
                    }}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {t.surveys.create}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t.surveys.anonymity}</p>
              {data.surveys.length === 0 ? (
                <EmptyState icon={BarChart3}>{t.surveys.empty}</EmptyState>
              ) : (
                <ul className="divide-y divide-border">
                  {data.surveys.map((survey) => (
                    <SurveyRow
                      key={survey.id}
                      survey={survey}
                      manage={manage}
                      busy={closeSurvey.isPending}
                      onOpen={setDialog}
                      onClose={() => {
                        closeSurvey.mutate(survey);
                      }}
                    />
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {dialog?.kind === "plan" && data !== undefined && (
          <PlanDialog year={data.year} objectives={data.objectives} onClose={close} />
        )}
        {dialog?.kind === "activity" && (
          <ActivityDialog year={shown} activity={dialog.activity} onClose={close} />
        )}
        {dialog?.kind === "done" && <DoneDialog activity={dialog.activity} onClose={close} />}
        {dialog?.kind === "survey" && <SurveyDialog survey={dialog.survey} onClose={close} />}
        {dialog?.kind === "results" && <ResultsDialog survey={dialog.survey} />}
      </Dialog>
    </div>
  );
}
