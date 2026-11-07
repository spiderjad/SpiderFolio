// /app/:slug/calidad/plan-analitico — the sampling plan (docs/spec/calidad.md, «Fase 6b»): product,
// surface, environment and water points repeated every N days, each result against its criterion.
// quality.manage creates, edits and archives the points; their responsible person and quality.manage
// record results; quality.view reads them. Whoever only has points in their charge sees those.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  FlaskConical,
  FolderOpen,
  History,
  Pencil,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource, type ComboboxSource } from "@/components/ui/combobox";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import { PrpStateBadge } from "./prps-page";
import {
  SAMPLING_KINDS,
  SEVERITIES,
  productsApi,
  qualityKeys,
  samplingApi,
  samplingKeys,
  type SamplingPoint,
  type Severity,
} from "./quality-api";
import { todayDay, useQuality, usePeopleSource } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.sampling;

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

/** The company's products, searched in the server. */
export function useProductSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "quality", "product-options"],
      search: async (q) => {
        const page = await productsApi.search(workspaceSlug, q);
        return {
          items: page.items.map((product) => ({ id: product.id, label: product.name })),
          nextCursor: null,
        };
      },
      byIds: async (ids) => {
        const page = await productsApi.search(workspaceSlug, "", ids);
        return page.items.map((product) => ({ id: product.id, label: product.name }));
      },
    }),
    [workspaceSlug],
  );
}

const numberOrNull = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

function PointDialog({ point, onClose }: { point?: SamplingPoint; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const f = t.form;
  const people = usePeopleSource();
  const products = useProductSource();
  const kinds = useStaticSource(
    "quality-sampling-kinds",
    SAMPLING_KINDS.map((id) => ({ id, label: t.kinds[id] })),
  );
  const [state, setState] = useState({
    kind: point?.kind ?? "ENVIRONMENT",
    name: point?.name ?? "",
    product: point?.product ?? null,
    zone: point?.zone ?? "",
    parameter: point?.parameter ?? "",
    criterion: point?.criterion ?? "",
    maxValue:
      point?.maxValue === null || point?.maxValue === undefined ? "" : String(point.maxValue),
    unit: point?.unit ?? "",
    everyDays: String(point?.everyDays ?? 30),
    nextDueOn: point?.nextDueOn ?? todayDay(),
    laboratory: point?.laboratory ?? "",
    responsible: point?.responsible ?? null,
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const text = (value: string) => (value.trim() === "" ? null : value.trim());
  const saved = useSaved(onClose);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind: state.kind,
        name: state.name.trim(),
        productId: state.product?.id ?? null,
        zone: text(state.zone),
        parameter: state.parameter.trim(),
        criterion: text(state.criterion),
        maxValue: numberOrNull(state.maxValue),
        unit: text(state.unit),
        everyDays: Number(state.everyDays),
        laboratory: text(state.laboratory),
        responsibleId: state.responsible?.id ?? null,
        nextDueOn: state.nextDueOn,
      };
      return point === undefined
        ? samplingApi.create(workspaceSlug, body)
        : samplingApi.update(workspaceSlug, point.id, body);
    },
    onSuccess: () => saved.done(point === undefined ? f.created : f.saved),
    onError: saved.onError,
  });
  const days = Number(state.everyDays);
  const ready =
    state.name.trim() !== "" &&
    state.parameter.trim() !== "" &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= 730 &&
    state.nextDueOn !== "" &&
    (state.maxValue.trim() === "" || numberOrNull(state.maxValue) !== null);
  const field = (
    label: string,
    key: "name" | "zone" | "parameter" | "criterion" | "unit" | "laboratory",
    max: number,
    placeholder?: string,
  ) => (
    <FormField label={label}>
      {(control) => (
        <Input
          {...control}
          maxLength={max}
          placeholder={placeholder}
          value={state[key]}
          onChange={(event) => {
            set({ [key]: event.target.value });
          }}
        />
      )}
    </FormField>
  );
  return (
    <DialogContent
      size="lg"
      title={point === undefined ? f.title : f.editTitle}
      footer={
        <Footer
          pending={save.isPending}
          ready={ready}
          label={point === undefined ? texts.admin.common.create : texts.admin.common.save}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
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
                  const next = SAMPLING_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) set({ kind: next });
                }}
              />
            )}
          </FormField>
          {field(f.name, "name", 160, f.namePlaceholder)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field(f.zone, "zone", 120, f.zonePlaceholder)}
          <FormField label={f.product}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                clearable
                label={f.product}
                placeholder={f.productPlaceholder}
                source={products}
                value={state.product?.id ?? null}
                valueLabel={state.product?.name}
                onChange={(option) => {
                  set({ product: option === null ? null : { id: option.id, name: option.label } });
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field(f.parameter, "parameter", 120, f.parameterPlaceholder)}
          {field(f.criterion, "criterion", 200, f.criterionPlaceholder)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.maxValue}>
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={state.maxValue}
                onChange={(event) => {
                  set({ maxValue: event.target.value });
                }}
              />
            )}
          </FormField>
          {field(f.unit, "unit", 20, f.unitPlaceholder)}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={f.everyDays}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                max={730}
                value={state.everyDays}
                onChange={(event) => {
                  set({ everyDays: event.target.value });
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
                  set({ nextDueOn: event.target.value });
                }}
              />
            )}
          </FormField>
          {field(f.laboratory, "laboratory", 120)}
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
      </FormGrid>
    </DialogContent>
  );
}

/** What the limit says: over the maximum or detected is not conforming; null when nothing says. */
function suggestion(point: SamplingPoint, value: number | null, detected: boolean | null) {
  if (detected === true) return false;
  if (value !== null && point.maxValue !== null) return value <= point.maxValue;
  if (detected === false) return true;
  return null;
}

function ResultDialog({ point, onClose }: { point: SamplingPoint; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const f = t.result;
  const files = useQuery({
    queryKey: samplingKeys.files(workspaceSlug, point.id),
    queryFn: () => samplingApi.files(workspaceSlug, point.id),
    select: (data) => data.items,
  });
  const fileSource: ComboboxSource = {
    key: [...samplingKeys.files(workspaceSlug, point.id), String(files.dataUpdatedAt)],
    search: (q) =>
      Promise.resolve({
        items: (files.data ?? [])
          .filter((file) => file.name.toLowerCase().includes(q.trim().toLowerCase()))
          .map((file) => ({ id: file.id, label: file.name })),
        nextCursor: null,
      }),
    byIds: () => Promise.resolve([]),
  };
  const presences = useStaticSource("quality-sampling-presence", [
    { id: "none", label: f.noPresence },
    { id: "no", label: t.notDetected },
    { id: "yes", label: t.detected },
  ]);
  const outcomes = useStaticSource("quality-sampling-outcomes", [
    { id: "yes", label: t.conforming },
    { id: "no", label: t.notConforming },
  ]);
  const severities = useStaticSource(
    "quality-sampling-severities",
    SEVERITIES.map((id) => ({ id, label: texts.quality.severities[id] })),
  );
  const [sampledOn, setSampledOn] = useState(todayDay());
  const [value, setValue] = useState("");
  const [detected, setDetected] = useState<boolean | null>(null);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [report, setReport] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState("");
  const [openNc, setOpenNc] = useState(true);
  const [severity, setSeverity] = useState<Severity>("MAJOR");
  const parsed = numberOrNull(value);
  const suggested = suggestion(point, parsed, detected);
  const conforming = choice ?? suggested ?? true;
  const folder = useMutation({
    mutationFn: () => samplingApi.folder(workspaceSlug, point.id),
    onSuccess: async ({ folder: target }) => {
      await navigate(`/app/${workspaceSlug}/files/${target.spaceId}/f/${target.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const saved = useSaved(onClose);
  const save = useMutation({
    mutationFn: () =>
      samplingApi.addResult(workspaceSlug, point.id, {
        sampledOn,
        value: parsed,
        detected,
        conforming,
        reportNodeId: report?.id ?? null,
        note: note.trim() === "" ? null : note.trim(),
        openNc: !conforming && openNc,
        severity,
      }),
    onSuccess: () => saved.done(f.done),
    onError: saved.onError,
  });
  return (
    <DialogContent
      size="lg"
      title={f.title(point.name)}
      footer={
        <Footer
          pending={save.isPending}
          ready={sampledOn !== "" && (value.trim() === "" || parsed !== null)}
          label={t.record}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <p className="text-xs text-muted-foreground">
          {[point.parameter, point.criterion].filter((part) => part !== null).join(" · ")}
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={f.sampledOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={sampledOn}
                onChange={(event) => {
                  setSampledOn(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.value(point.unit)}>
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setChoice(null);
                }}
              />
            )}
          </FormField>
          <FormField label={f.presence}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.presence}
                placeholder={f.presence}
                source={presences}
                value={detected === null ? "none" : detected ? "yes" : "no"}
                onChange={(option) => {
                  setDetected(option?.id === "yes" ? true : option?.id === "no" ? false : null);
                  setChoice(null);
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={f.outcome}
            {...(suggested === null ? {} : { hint: f.suggested(suggested) })}
          >
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.outcome}
                placeholder={f.outcome}
                source={outcomes}
                value={conforming ? "yes" : "no"}
                onChange={(option) => {
                  if (option !== null) setChoice(option.id === "yes");
                }}
              />
            )}
          </FormField>
          <FormField label={f.report}>
            {(control) => (
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <Combobox
                    id={control.id}
                    aria-describedby={control["aria-describedby"]}
                    clearable
                    label={f.report}
                    placeholder={f.reportPlaceholder}
                    source={fileSource}
                    value={report?.id ?? null}
                    valueLabel={report?.name}
                    onChange={(option) => {
                      setReport(option === null ? null : { id: option.id, name: option.label });
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t.folder}
                  disabled={folder.isPending}
                  onClick={() => {
                    folder.mutate();
                  }}
                >
                  <FolderOpen className="size-4" aria-hidden="true" />
                </Button>
              </div>
            )}
          </FormField>
        </div>
        <FormField label={f.note}>
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

function valueText(
  value: number | null,
  detected: boolean | null,
  unit: string | null,
): string | null {
  const parts: string[] = [];
  if (value !== null) parts.push(unit === null ? String(value) : `${String(value)} ${unit}`);
  if (detected !== null) parts.push(detected ? t.detected : t.notDetected);
  return parts.length === 0 ? null : parts.join(" · ");
}

function ResultsDialog({ point }: { point: SamplingPoint }) {
  const { workspaceSlug = "" } = useParams();
  const query = useQuery({
    queryKey: samplingKeys.results(workspaceSlug, point.id),
    queryFn: () => samplingApi.results(workspaceSlug, point.id),
    select: (data) => data.results,
  });
  const limit =
    point.maxValue === null
      ? null
      : t.results.limit(
          point.unit === null ? String(point.maxValue) : `${String(point.maxValue)} ${point.unit}`,
        );
  return (
    <DialogContent title={t.results.title(point.name)}>
      {limit !== null && <p className="text-xs text-muted-foreground">{limit}</p>}
      {query.data === undefined ? (
        <Skeleton className="h-24" />
      ) : query.data.length === 0 ? (
        <EmptyState icon={History}>{t.results.empty}</EmptyState>
      ) : (
        <ul className="-my-2 divide-y divide-border">
          {query.data.map((result) => (
            <li key={result.id} className="grid gap-1 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{formatUtcDate(result.sampledOn)}</span>
                <Badge tone={result.conforming ? "success" : "danger"}>
                  {result.conforming ? t.conforming : t.notConforming}
                </Badge>
                {valueText(result.value, result.detected, point.unit) !== null && (
                  <span className="tabular-nums">
                    {valueText(result.value, result.detected, point.unit)}
                  </span>
                )}
                {result.nc !== null && (
                  <Link
                    to={`/app/${workspaceSlug}/calidad/no-conformidades/${result.nc.id}`}
                    className="text-xs tabular-nums underline-offset-4 hover:underline"
                  >
                    {result.nc.code}
                  </Link>
                )}
                {result.report !== null && (
                  <Link
                    to={`/app/${workspaceSlug}/files/${result.report.spaceId}`}
                    className="text-xs underline-offset-4 hover:underline"
                  >
                    {result.report.name}
                  </Link>
                )}
                <span className="text-xs text-muted-foreground">
                  {t.results.by(result.by.name)}
                </span>
              </div>
              {result.note !== null && (
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {result.note}
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
  | { kind: "edit"; point: SamplingPoint }
  | { kind: "result"; point: SamplingPoint }
  | { kind: "history"; point: SamplingPoint }
  | null;

function PointRow({
  point,
  busy,
  onOpen,
  onArchive,
}: {
  point: SamplingPoint;
  busy: boolean;
  onOpen: (dialog: DialogState) => void;
  onArchive: () => void;
}) {
  const last = point.last;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-56">
        <p className="break-words text-sm font-medium">{point.name}</p>
        <p className="text-xs text-muted-foreground">
          {[
            point.parameter,
            point.criterion,
            point.zone,
            texts.quality.prps.every(point.everyDays),
            point.responsible?.name ?? texts.quality.prps.noResponsible,
          ]
            .filter((part) => part !== null && part !== "")
            .join(" · ")}
        </p>
      </div>
      <dl className="grid w-64 shrink-0 grid-cols-2 gap-4 text-xs">
        <div>
          <dt className="text-muted-foreground">{t.lastResult}</dt>
          <dd className="tabular-nums">
            {last === null ? (
              t.noResult
            ) : (
              <span className={last.conforming ? undefined : "text-danger"}>
                {valueText(last.value, last.detected, point.unit) ??
                  (last.conforming ? t.conforming : t.notConforming)}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{texts.quality.prps.next}</dt>
          <dd className="whitespace-nowrap tabular-nums">{formatUtcDate(point.nextDueOn)}</dd>
        </div>
      </dl>
      <div className="flex w-36 shrink-0 flex-wrap gap-1">
        {point.archived ? (
          <Badge tone="neutral">{texts.quality.prps.archived}</Badge>
        ) : (
          <PrpStateBadge state={point.state} />
        )}
        {point.repeated && (
          <Badge tone="danger" title={t.repeatedHint}>
            {t.repeated}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!point.archived && point.access !== "read" && (
          <Button
            size="sm"
            onClick={() => {
              onOpen({ kind: "result", point });
            }}
          >
            <FlaskConical className="size-4" aria-hidden="true" />
            {t.record}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={texts.quality.prps.history}
          onClick={() => {
            onOpen({ kind: "history", point });
          }}
        >
          <History className="size-4" aria-hidden="true" />
        </Button>
        {point.access === "manage" && (
          <>
            {!point.archived && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={texts.quality.prps.edit}
                onClick={() => {
                  onOpen({ kind: "edit", point });
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={point.archived ? texts.quality.prps.restore : texts.quality.prps.archive}
              disabled={busy}
              onClick={onArchive}
            >
              {point.archived ? (
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

export function SamplingPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage, view } = useQuality();
  const queryClient = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const filters = { archived };
  const query = useQuery({
    queryKey: samplingKeys.list(workspaceSlug, filters),
    queryFn: () => samplingApi.list(workspaceSlug, filters),
    select: (data) => data.items,
  });
  const archive = useMutation({
    mutationFn: (point: SamplingPoint) =>
      samplingApi.archive(workspaceSlug, point.id, !point.archived),
    onSuccess: async (_data, point) => {
      toast.success(
        point.archived ? texts.quality.prps.restoredDone : texts.quality.prps.archivedDone,
      );
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const close = () => {
    setDialog(null);
  };
  const points = query.data;
  const groups = SAMPLING_KINDS.map((kind) => ({
    kind,
    items: (points ?? []).filter((point) => point.kind === kind),
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
              {archived ? texts.quality.prps.hideArchived : texts.quality.prps.showArchived}
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
      {points === undefined ? (
        <Skeleton className="h-40" />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={FlaskConical}>{view ? t.empty : t.emptyMine}</EmptyState>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.kind} className="grid gap-1 p-4 sm:p-5">
            <CardTitle>{t.kinds[group.kind]}</CardTitle>
            <ul className="divide-y divide-border">
              {group.items.map((point) => (
                <PointRow
                  key={point.id}
                  point={point}
                  busy={archive.isPending}
                  onOpen={setDialog}
                  onArchive={() => {
                    archive.mutate(point);
                  }}
                />
              ))}
            </ul>
          </Card>
        ))
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {dialog?.kind === "new" && <PointDialog onClose={close} />}
        {dialog?.kind === "edit" && <PointDialog point={dialog.point} onClose={close} />}
        {dialog?.kind === "result" && <ResultDialog point={dialog.point} onClose={close} />}
        {dialog?.kind === "history" && <ResultsDialog point={dialog.point} />}
      </Dialog>
    </div>
  );
}
