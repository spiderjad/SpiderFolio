// /app/:slug/medio-ambiente/vertidos — discharges (docs/spec/medio-ambiente.md, section 3): the discharge
// permit's limits, the analyses compared with them, a chart per parameter and, with the quality module on,
// a nonconformity from an analysis out of limits.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChartTooltip } from "@/components/ui/chart";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useMembership } from "@/features/home/workspace-layout";
import { cn, formatUtcDate } from "@/lib/utils";
import {
  environmentMoreApi,
  environmentMoreKeys,
  type DischargeLimit,
  type DischargePermit,
  type Sample,
} from "./environment-api";
import { useEnvironment } from "./environment-common";
import { locale, texts } from "@/i18n";

const t = texts.environment.discharge;

const numberOf = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const limitText = (limit: { min: number | null; max: number | null; unit: string }) =>
  [
    limit.min === null ? null : `≥ ${limit.min.toLocaleString(locale)}`,
    limit.max === null ? null : `≤ ${limit.max.toLocaleString(locale)}`,
  ]
    .filter(Boolean)
    .join(" · ") + (limit.unit === "" ? "" : ` ${limit.unit}`);

export function DischargePage() {
  const { workspaceSlug = "" } = useParams();
  const { manage, view, record } = useEnvironment();
  const permits = useQuery({
    queryKey: environmentMoreKeys.dischargePermits(workspaceSlug),
    queryFn: () => environmentMoreApi.dischargePermits(workspaceSlug),
    select: (data) => data.permits,
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const permit =
    (permits.data ?? []).find((item) => item.id === chosen) ?? (permits.data ?? [])[0] ?? null;
  const permitSource = useStaticSource(
    "environment-discharge-permits",
    (permits.data ?? []).map((item) => ({ id: item.id, label: item.name })),
  );
  const [editingLimits, setEditingLimits] = useState(false);
  const [recording, setRecording] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        {(permits.data ?? []).length > 1 && (
          <div className="w-72">
            <Combobox
              searchable={false}
              label={t.permit}
              placeholder={t.permit}
              source={permitSource}
              value={permit?.id ?? null}
              onChange={(option) => {
                setChosen(option?.id ?? null);
              }}
            />
          </div>
        )}
      </div>
      {permits.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : permit === null ? (
        <Card>
          <EmptyState icon={Droplets} title={t.noPermits}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="grid gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>
                {t.limits} · {permit.name}
              </CardTitle>
              {manage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingLimits(true);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  {t.editLimits}
                </Button>
              )}
            </div>
            {permit.limits.length === 0 ? (
              <div className="grid justify-items-start gap-2">
                <p className="max-w-2xl text-sm text-muted-foreground">{t.noLimitsHelp}</p>
                {manage && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingLimits(true);
                    }}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {t.loadLimits}
                  </Button>
                )}
              </div>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {permit.limits.map((limit) => (
                  <li key={limit.parameter} className="v-badge">
                    <span className="font-medium">{limit.parameter}</span>&nbsp;{limitText(limit)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {record && (
            <div className="flex justify-end">
              <Button
                variant={permit.limits.length === 0 ? "outline" : "primary"}
                onClick={() => {
                  setRecording(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t.newSample}
              </Button>
            </div>
          )}
          {view && <Samples permit={permit} />}
          {editingLimits && (
            <LimitsDialog
              permit={permit}
              onClose={() => {
                setEditingLimits(false);
              }}
            />
          )}
          {recording && (
            <SampleDialog
              permit={permit}
              onClose={() => {
                setRecording(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function Samples({ permit }: { permit: DischargePermit }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { manage } = useEnvironment();
  const membership = useMembership();
  const qualityOn = membership.workspace.quality.enabled;
  const samples = useQuery({
    queryKey: environmentMoreKeys.samples(workspaceSlug, permit.id),
    queryFn: () => environmentMoreApi.samples(workspaceSlug, permit.id),
    select: (data) => data.samples,
  });
  const [parameter, setParameter] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Sample | null>(null);
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["w", workspaceSlug, "environment"] });
  };
  const openNc = useMutation({
    mutationFn: (id: string) => environmentMoreApi.openNc(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(t.ncOpened);
      await invalidate();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => environmentMoreApi.deleteSample(workspaceSlug, id),
    onSuccess: async () => {
      setDeleting(null);
      toast.success(t.deleted);
      await invalidate();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const parameters = useMemo(
    () => [
      ...new Set([
        ...permit.limits.map((limit) => limit.parameter),
        ...(samples.data ?? []).flatMap((sample) => sample.values.map((value) => value.parameter)),
      ]),
    ],
    [permit.limits, samples.data],
  );
  const shown = parameter ?? parameters[0] ?? null;
  const parameterSource = useStaticSource(
    `environment-discharge-parameters-${permit.id}`,
    parameters.map((name) => ({ id: name, label: name })),
  );
  const limit = permit.limits.find((item) => item.parameter === shown);
  const chart = useMemo(
    () =>
      [...(samples.data ?? [])].reverse().flatMap((sample) => {
        const value = sample.values.find((entry) => entry.parameter === shown);
        return value === undefined ? [] : [{ day: sample.takenOn, value: value.value }];
      }),
    [samples.data, shown],
  );
  if (samples.isPending) return <Skeleton className="h-64 w-full" />;
  const list = samples.data ?? [];
  return (
    <>
      {chart.length > 1 && shown !== null && (
        <Card className="grid gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t.chart}</CardTitle>
            <div className="w-56">
              <Combobox
                searchable={false}
                label={t.parameter}
                placeholder={t.parameter}
                source={parameterSource}
                value={shown}
                onChange={(option) => {
                  setParameter(option?.id ?? null);
                }}
              />
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ left: -8, right: 12, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tickFormatter={(value: string) => formatUtcDate(value)}
                  className="fill-muted-foreground"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  className="fill-muted-foreground"
                />
                <ChartTip
                  content={(props) => (
                    <ChartTooltip
                      active={props.active}
                      label={props.label}
                      payload={props.payload}
                      names={{ value: shown }}
                      formatLabel={(value) => formatUtcDate(value)}
                    />
                  )}
                />
                {limit?.max !== null && limit?.max !== undefined && (
                  <ReferenceLine y={limit.max} stroke="var(--danger)" strokeDasharray="4 4" />
                )}
                {limit?.min !== null && limit?.min !== undefined && (
                  <ReferenceLine y={limit.min} stroke="var(--danger)" strokeDasharray="4 4" />
                )}
                <Line dataKey="value" stroke="var(--primary)" strokeWidth={2} type="linear" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <Card className="grid gap-0 p-0">
        <div className="border-b border-border px-4 py-3">
          <CardTitle>{t.samples}</CardTitle>
        </div>
        {list.length === 0 ? (
          <EmptyState icon={Droplets} title={t.empty}>
            {null}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((sample) => (
              <li key={sample.id} className="grid gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium tabular-nums">
                      {formatUtcDate(sample.takenOn)}
                    </span>
                    {sample.point !== "" && (
                      <span className="text-muted-foreground">{sample.point}</span>
                    )}
                    {sample.laboratory !== "" && (
                      <span className="text-muted-foreground">· {sample.laboratory}</span>
                    )}
                    <Badge tone={sample.outOfLimits > 0 ? "danger" : "success"}>
                      {sample.outOfLimits > 0 ? t.out : t.ok}
                    </Badge>
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    {sample.ncId !== null ? (
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/app/${workspaceSlug}/calidad/no-conformidades/${sample.ncId}`}>
                          {t.viewNc}
                        </Link>
                      </Button>
                    ) : (
                      manage &&
                      qualityOn &&
                      sample.outOfLimits > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={openNc.isPending}
                          onClick={() => {
                            openNc.mutate(sample.id);
                          }}
                        >
                          {t.openNc}
                        </Button>
                      )
                    )}
                    {manage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`${t.delete}: ${formatUtcDate(sample.takenOn)}`}
                        onClick={() => {
                          setDeleting(sample);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {sample.values.map((value) => (
                    <li
                      key={value.parameter}
                      className={cn("v-badge", value.out && "v-badge--danger")}
                      title={
                        value.min === null && value.max === null ? undefined : limitText(value)
                      }
                    >
                      {value.parameter}: {value.value.toLocaleString(locale)}
                      {value.unit === "" ? "" : ` ${value.unit}`}
                    </li>
                  ))}
                </ul>
                {sample.notes !== "" && (
                  <p className="text-xs text-muted-foreground">{sample.notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        icon={Trash2}
        tone="destructive"
        title={t.deleteTitle}
        description={t.deleteText}
        confirmLabel={t.delete}
        pendingLabel={texts.admin.common.saving}
        onConfirm={async () => {
          if (deleting !== null) await remove.mutateAsync(deleting.id).catch(() => undefined);
        }}
      />
    </>
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
        {busy ? texts.admin.common.saving : texts.admin.common.save}
      </Button>
    </>
  );
}

function LimitsDialog({ permit, onClose }: { permit: DischargePermit; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(
    permit.limits.length === 0
      ? [{ parameter: "", unit: "", min: "", max: "" }]
      : permit.limits.map((limit) => ({
          parameter: limit.parameter,
          unit: limit.unit,
          min: limit.min === null ? "" : String(limit.min),
          max: limit.max === null ? "" : String(limit.max),
        })),
  );
  const save = useMutation({
    mutationFn: () => {
      const limits: DischargeLimit[] = rows
        .filter((row) => row.parameter.trim() !== "")
        .map((row) => ({
          parameter: row.parameter.trim(),
          unit: row.unit.trim(),
          min: numberOf(row.min),
          max: numberOf(row.max),
        }));
      return environmentMoreApi.saveLimits(workspaceSlug, permit.id, limits);
    },
    onSuccess: async () => {
      toast.success(t.limitsSaved);
      await queryClient.invalidateQueries({ queryKey: ["w", workspaceSlug, "environment"] });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const set = (index: number, patch: Partial<(typeof rows)[number]>) => {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={t.limitsTitle}
        description={permit.name}
        footer={
          <Footer
            busy={save.isPending}
            ready
            onSave={() => {
              save.mutate();
            }}
          />
        }
      >
        <div className="grid gap-2">
          <p className="mb-1 text-sm text-muted-foreground">{t.limitsHint}</p>
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 text-xs text-muted-foreground sm:grid">
            <span>{t.parameter}</span>
            <span>{t.unit}</span>
            <span>{t.min}</span>
            <span>{t.max}</span>
          </div>
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem]"
            >
              <Input
                aria-label={t.parameter}
                placeholder={t.parameter}
                maxLength={120}
                value={row.parameter}
                onChange={(event) => {
                  set(index, { parameter: event.target.value });
                }}
              />
              <Input
                aria-label={t.unit}
                placeholder="mg/L"
                maxLength={40}
                value={row.unit}
                onChange={(event) => {
                  set(index, { unit: event.target.value });
                }}
              />
              <Input
                aria-label={t.min}
                placeholder={t.min}
                inputMode="decimal"
                value={row.min}
                onChange={(event) => {
                  set(index, { min: event.target.value });
                }}
              />
              <Input
                aria-label={t.max}
                placeholder={t.max}
                inputMode="decimal"
                value={row.max}
                onChange={(event) => {
                  set(index, { max: event.target.value });
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-9"
                aria-label={t.removeParameter}
                onClick={() => {
                  setRows(rows.filter((_, i) => i !== index));
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length >= 30}
              onClick={() => {
                setRows([...rows, { parameter: "", unit: "", min: "", max: "" }]);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.addParameter}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // The usual ones that aren't there yet; empty rows give way to them.
                const kept = rows.filter((row) => row.parameter.trim() !== "");
                const have = new Set(kept.map((row) => row.parameter.trim().toLowerCase()));
                const added = t.commonParameters
                  .filter((item) => !have.has(item.parameter.toLowerCase()))
                  .map((item) => ({
                    parameter: item.parameter,
                    unit: item.unit,
                    min: "",
                    max: "",
                  }));
                setRows([...kept, ...added].slice(0, 30));
              }}
            >
              {t.addCommon}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SampleDialog({ permit, onClose }: { permit: DischargePermit; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [state, setState] = useState({ takenOn: today, point: "", laboratory: "", notes: "" });
  const [values, setValues] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<{ parameter: string; value: string }[]>([]);
  const entries = [
    ...permit.limits.map((limit) => ({
      parameter: limit.parameter,
      value: numberOf(values[limit.parameter] ?? ""),
    })),
    ...extra.map((row) => ({ parameter: row.parameter.trim(), value: numberOf(row.value) })),
  ].filter(
    (entry): entry is { parameter: string; value: number } =>
      entry.parameter !== "" && entry.value !== null,
  );
  const save = useMutation({
    mutationFn: () =>
      environmentMoreApi.createSample(workspaceSlug, {
        permitId: permit.id,
        takenOn: state.takenOn,
        point: state.point.trim(),
        laboratory: state.laboratory.trim(),
        notes: state.notes.trim(),
        values: entries,
      }),
    onSuccess: async () => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: ["w", workspaceSlug, "environment"] });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const field = (label: string, key: "point" | "laboratory") => (
    <FormField label={label}>
      {(control) => (
        <Input
          {...control}
          maxLength={120}
          value={state[key]}
          onChange={(event) => {
            setState({ ...state, [key]: event.target.value });
          }}
        />
      )}
    </FormField>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={t.sampleTitle}
        description={permit.name}
        footer={
          <Footer
            busy={save.isPending}
            ready={state.takenOn !== "" && entries.length > 0}
            onSave={() => {
              save.mutate();
            }}
          />
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label={t.takenOn}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={today}
                  value={state.takenOn}
                  onChange={(event) => {
                    setState({ ...state, takenOn: event.target.value });
                  }}
                />
              )}
            </FormField>
            {field(t.point, "point")}
            {field(t.laboratory, "laboratory")}
          </div>
          {permit.limits.length === 0 && <Banner tone="info">{t.sampleNoLimits}</Banner>}
          <div className="grid gap-3 sm:grid-cols-2">
            {permit.limits.map((limit) => (
              <FormField key={limit.parameter} label={limit.parameter} hint={limitText(limit)}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    value={values[limit.parameter] ?? ""}
                    onChange={(event) => {
                      setValues({ ...values, [limit.parameter]: event.target.value });
                    }}
                  />
                )}
              </FormField>
            ))}
          </div>
          {extra.length > 0 && (
            <div className="-mb-2 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_2rem] gap-2 text-xs text-muted-foreground">
              <span>{t.parameter}</span>
              <span>{t.value}</span>
            </div>
          )}
          {extra.map((row, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_2rem] gap-2">
              <Input
                aria-label={t.parameter}
                placeholder={t.parameter}
                maxLength={120}
                value={row.parameter}
                onChange={(event) => {
                  setExtra(
                    extra.map((item, i) =>
                      i === index ? { ...item, parameter: event.target.value } : item,
                    ),
                  );
                }}
              />
              <Input
                aria-label={t.value}
                placeholder={t.value}
                inputMode="decimal"
                value={row.value}
                onChange={(event) => {
                  setExtra(
                    extra.map((item, i) =>
                      i === index ? { ...item, value: event.target.value } : item,
                    ),
                  );
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-9"
                aria-label={t.removeParameter}
                onClick={() => {
                  setExtra(extra.filter((_, i) => i !== index));
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setExtra([...extra, { parameter: "", value: "" }]);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.other}
            </Button>
          </div>
          <FormField label={t.notes}>
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={4000}
                value={state.notes}
                onChange={(event) => {
                  setState({ ...state, notes: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}
