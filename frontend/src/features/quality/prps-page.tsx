// /app/:slug/calidad/prerrequisitos — prerequisite programmes (docs/spec/calidad.md, «Fase 6a»): the
// controls repeated every N days, grouped by programme, with their state (up to date, due soon,
// overdue). quality.manage creates, edits and archives them; their responsible person and
// quality.manage record checks; quality.view reads them. Whoever only has controls in their charge sees
// those.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ClipboardCheck, History, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import { MaintenanceCalibrationsCard } from "@/features/maintenance/calibrations-card";
import { useFormSource } from "./ccp-dialog";
import {
  PRP_KINDS,
  SEVERITIES,
  prpKeys,
  prpsApi,
  qualityKeys,
  type Prp,
  type PrpState,
  type Severity,
} from "./quality-api";
import { todayDay, useQuality, usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.prps;
const stateTone = { ok: "success", due_soon: "warning", overdue: "danger" } as const;

export function PrpStateBadge({ state }: { state: PrpState }) {
  return <Badge tone={stateTone[state]}>{t.states[state]}</Badge>;
}

function useSaved(onClose: () => void) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return {
    done: async (message: string) => {
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
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

function PrpDialog({ prp, onClose }: { prp?: Prp; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const f = t.form;
  const people = usePeopleSource();
  const forms = useFormSource();
  const kinds = useStaticSource(
    "quality-prp-kinds",
    PRP_KINDS.map((id) => ({ id, label: t.kinds[id] })),
  );
  const [state, setState] = useState({
    kind: prp?.kind ?? "CLEANING",
    name: prp?.name ?? "",
    location: prp?.location ?? "",
    everyDays: String(prp?.everyDays ?? 7),
    nextDueOn: prp?.nextDueOn ?? todayDay(),
    notes: prp?.notes ?? "",
    responsible: prp?.responsible ?? null,
    form: prp?.form === null || prp?.form === undefined ? null : prp.form,
  });
  const saved = useSaved(onClose);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind: state.kind,
        name: state.name.trim(),
        location: state.location.trim() === "" ? null : state.location.trim(),
        everyDays: Number(state.everyDays),
        responsibleId: state.responsible?.id ?? null,
        formId: state.form?.id ?? null,
        nextDueOn: state.nextDueOn,
        notes: state.notes.trim() === "" ? null : state.notes.trim(),
      };
      return prp === undefined
        ? prpsApi.create(workspaceSlug, body)
        : prpsApi.update(workspaceSlug, prp.id, body);
    },
    onSuccess: () => saved.done(prp === undefined ? f.created : f.saved),
    onError: saved.onError,
  });
  const days = Number(state.everyDays);
  const ready =
    state.name.trim() !== "" &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= 730 &&
    state.nextDueOn !== "";
  return (
    <DialogContent
      size="lg"
      title={prp === undefined ? f.title : f.editTitle}
      footer={
        <Footer
          pending={save.isPending}
          ready={ready}
          label={prp === undefined ? texts.admin.common.create : texts.admin.common.save}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
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
                  const next = PRP_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) setState({ ...state, kind: next });
                }}
              />
            )}
          </FormField>
          <FormField label={f.name}>
            {(control) => (
              <Input
                {...control}
                maxLength={160}
                placeholder={f.namePlaceholder}
                value={state.name}
                onChange={(event) => {
                  setState({ ...state, name: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={f.location}>
            {(control) => (
              <Input
                {...control}
                maxLength={120}
                value={state.location}
                onChange={(event) => {
                  setState({ ...state, location: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.everyDays}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                max={730}
                value={state.everyDays}
                onChange={(event) => {
                  setState({ ...state, everyDays: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.firstDue}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={state.nextDueOn}
                onChange={(event) => {
                  setState({ ...state, nextDueOn: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
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
                  setState({
                    ...state,
                    responsible: option === null ? null : { id: option.id, name: option.label },
                  });
                }}
              />
            )}
          </FormField>
          <FormField label={f.formLink}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={f.formLink}
                placeholder={f.formPlaceholder}
                source={forms}
                value={state.form?.id ?? null}
                valueLabel={state.form?.name}
                onChange={(option) => {
                  setState({
                    ...state,
                    form:
                      option === null ? null : { id: option.id, name: option.label, spaceId: "" },
                  });
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.notes}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="min-h-16"
              maxLength={1000}
              value={state.notes}
              onChange={(event) => {
                setState({ ...state, notes: event.target.value });
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

function CheckDialog({ prp, onClose }: { prp: Prp; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const f = t.check;
  const results = useStaticSource("quality-prp-results", [
    { id: "yes", label: f.conforming },
    { id: "no", label: f.notConforming },
  ]);
  const severities = useStaticSource(
    "quality-prp-severities",
    SEVERITIES.map((id) => ({ id, label: texts.quality.severities[id] })),
  );
  const [doneOn, setDoneOn] = useState(todayDay());
  const [conforming, setConforming] = useState(true);
  const [note, setNote] = useState("");
  const [openNc, setOpenNc] = useState(true);
  const [severity, setSeverity] = useState<Severity>("MAJOR");
  const saved = useSaved(onClose);
  const save = useMutation({
    mutationFn: () =>
      prpsApi.check(workspaceSlug, prp.id, {
        doneOn,
        conforming,
        note: note.trim() === "" ? null : note.trim(),
        openNc: !conforming && openNc,
        severity,
      }),
    onSuccess: () => saved.done(f.done),
    onError: saved.onError,
  });
  return (
    <DialogContent
      title={f.title(prp.name)}
      footer={
        <Footer
          pending={save.isPending}
          ready={doneOn !== ""}
          label={t.record}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.doneOn}>
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
          <FormField label={f.result}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.result}
                placeholder={f.result}
                source={results}
                value={conforming ? "yes" : "no"}
                onChange={(option) => {
                  if (option !== null) setConforming(option.id === "yes");
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.note}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </FormField>
        {!conforming && (
          <>
            <Checkbox
              label={f.openNc}
              checked={openNc}
              onChange={(event) => {
                setOpenNc(event.target.checked);
              }}
            />
            {openNc && (
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
            )}
          </>
        )}
      </FormGrid>
    </DialogContent>
  );
}

function HistoryDialog({ prp }: { prp: Prp }) {
  const { workspaceSlug = "" } = useParams();
  const query = useQuery({
    queryKey: prpKeys.checks(workspaceSlug, prp.id),
    queryFn: () => prpsApi.checks(workspaceSlug, prp.id),
    select: (data) => data.checks,
  });
  return (
    <DialogContent title={t.checks.title(prp.name)}>
      {query.data === undefined ? (
        <Skeleton className="h-24" />
      ) : query.data.length === 0 ? (
        <EmptyState icon={History}>{t.checks.empty}</EmptyState>
      ) : (
        <ul className="-my-2 divide-y divide-border">
          {query.data.map((check) => (
            <li key={check.id} className="grid gap-1 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{formatUtcDate(check.doneOn)}</span>
                <Badge tone={check.conforming ? "success" : "danger"}>
                  {check.conforming ? t.check.conforming : t.check.notConforming}
                </Badge>
                {check.nc !== null && (
                  <Link
                    to={`/app/${workspaceSlug}/calidad/no-conformidades/${check.nc.id}`}
                    className="text-xs tabular-nums underline-offset-4 hover:underline"
                  >
                    {check.nc.code}
                  </Link>
                )}
                <span className="text-xs text-muted-foreground">{t.checks.by(check.by.name)}</span>
              </div>
              {check.note !== null && (
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {check.note}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </DialogContent>
  );
}

type DialogState =
  | { kind: "new" }
  | { kind: "edit"; prp: Prp }
  | { kind: "check"; prp: Prp }
  | { kind: "history"; prp: Prp }
  | null;

function PrpRow({
  prp,
  busy,
  onOpen,
  onArchive,
}: {
  prp: Prp;
  busy: boolean;
  onOpen: (dialog: DialogState) => void;
  onArchive: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-sm font-medium">{prp.name}</p>
        <p className="text-xs text-muted-foreground">
          {[prp.location, t.every(prp.everyDays), prp.responsible?.name ?? t.noResponsible]
            .filter((part) => part !== null && part !== "")
            .join(" · ")}
        </p>
      </div>
      <dl className="grid w-52 shrink-0 grid-cols-2 gap-4 text-xs">
        <div>
          <dt className="text-muted-foreground">{t.last}</dt>
          <dd className="tabular-nums">
            {prp.lastDoneOn === null ? t.never : formatUtcDate(prp.lastDoneOn)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.next}</dt>
          <dd className="whitespace-nowrap tabular-nums">{formatUtcDate(prp.nextDueOn)}</dd>
        </div>
      </dl>
      <div className="w-24 shrink-0">
        {prp.archived ? (
          <Badge tone="neutral">{t.archived}</Badge>
        ) : (
          <PrpStateBadge state={prp.state} />
        )}
      </div>
      <div className="flex items-center gap-1">
        {!prp.archived && prp.access !== "read" && (
          <Button
            size="sm"
            onClick={() => {
              onOpen({ kind: "check", prp });
            }}
          >
            <ClipboardCheck className="size-4" aria-hidden="true" />
            {t.record}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.history}
          onClick={() => {
            onOpen({ kind: "history", prp });
          }}
        >
          <History className="size-4" aria-hidden="true" />
        </Button>
        {prp.access === "manage" && (
          <>
            {!prp.archived && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.edit}
                onClick={() => {
                  onOpen({ kind: "edit", prp });
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={prp.archived ? t.restore : t.archive}
              disabled={busy}
              onClick={onArchive}
            >
              {prp.archived ? (
                <ArchiveRestore className="size-4" aria-hidden="true" />
              ) : (
                <Archive className="size-4" aria-hidden="true" />
              )}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function PrpsPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage, view } = useQuality();
  const queryClient = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const filters = { archived };
  const query = useQuery({
    queryKey: prpKeys.list(workspaceSlug, filters),
    queryFn: () => prpsApi.list(workspaceSlug, filters),
    select: (data) => data.prps,
  });
  const archive = useMutation({
    mutationFn: (prp: Prp) => prpsApi.archive(workspaceSlug, prp.id, !prp.archived),
    onSuccess: async (_data, prp) => {
      toast.success(prp.archived ? t.restoredDone : t.archivedDone);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const close = () => {
    setDialog(null);
  };
  const prps = query.data;
  const groups = PRP_KINDS.map((kind) => ({
    kind,
    items: (prps ?? []).filter((prp) => prp.kind === kind),
  })).filter((group) => group.items.length > 0);
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view && (
            <Button
              variant="outline"
              onClick={() => {
                setArchived(!archived);
              }}
            >
              {archived ? t.hideArchived : t.showArchived}
            </Button>
          )}
          {manage && (
            <Button
              onClick={() => {
                setDialog({ kind: "new" });
              }}
            >
              <Plus strokeWidth={1.75} aria-hidden="true" />
              {t.create}
            </Button>
          )}
        </div>
      </div>
      {prps === undefined ? (
        <Skeleton className="h-40" />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardCheck}>{view ? t.empty : t.emptyMine}</EmptyState>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.kind} className="grid gap-1 p-4 sm:p-5">
            <CardTitle>{t.kinds[group.kind]}</CardTitle>
            <ul className="divide-y divide-border">
              {group.items.map((prp) => (
                <PrpRow
                  key={prp.id}
                  prp={prp}
                  busy={archive.isPending}
                  onOpen={setDialog}
                  onArchive={() => {
                    archive.mutate(prp);
                  }}
                />
              ))}
            </ul>
          </Card>
        ))
      )}
      {view && !archived && <MaintenanceCalibrationsCard />}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {dialog?.kind === "new" && <PrpDialog onClose={close} />}
        {dialog?.kind === "edit" && <PrpDialog prp={dialog.prp} onClose={close} />}
        {dialog?.kind === "check" && <CheckDialog prp={dialog.prp} onClose={close} />}
        {dialog?.kind === "history" && <HistoryDialog prp={dialog.prp} />}
      </Dialog>
    </div>
  );
}
