// /app/:slug/mantenimiento/preventivo — preventive maintenance and calibration (docs/spec/mantenimiento.md,
// section 5): the plans of each piece of equipment (by time or by use), the most urgent first, and the
// meters with their readings. When a plan is due its work order is created by itself. maintenance.manage
// creates and edits plans and meters; maintenance.work logs readings.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Gauge, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatDateTime, formatUtcDate } from "@/lib/utils";
import {
  maintenanceApi,
  maintenanceKeys,
  PLAN_UNITS,
  type Meter,
  type Plan,
  type PlanKind,
  type PlanUnit,
} from "./maintenance-api";
import {
  useAssetSource,
  useAssets,
  useMaintenance,
  useTechnicianSource,
} from "./maintenance-common";
import { texts } from "@/i18n";

const t = texts.maintenance.plans;
const k = texts.maintenance;

const STATE_TONE = { ok: "success", due_soon: "warning", overdue: "danger" } as const;

/** «Cada 2 semanas» or «Cada 500 h de Horas de funcionamiento». */
export function frequencyOf(plan: Plan): string {
  if (plan.every !== null && plan.everyUnit !== null) {
    return t.every(plan.every, t.units[plan.everyUnit]);
  }
  if (plan.meter !== null && plan.meterEvery !== null) {
    return t.everyMeter(plan.meterEvery, plan.meter.unit, plan.meter.name);
  }
  return "";
}

/** When it's next due: the day, or the meter reading. */
export function nextOf(plan: Plan): string {
  if (plan.nextDueOn !== null) return t.next(formatUtcDate(plan.nextDueOn));
  if (plan.nextMeterAt !== null && plan.meter !== null) {
    return t.nextMeter(plan.nextMeterAt, plan.meter.unit, plan.meter.lastValue);
  }
  return "";
}

export function PlanStateBadge({ state }: { state: Plan["state"] }) {
  return <Badge tone={STATE_TONE[state]}>{t.states[state]}</Badge>;
}

export function PlansPage() {
  const { manage } = useMaintenance();
  const [tab, setTab] = useState<"plans" | "meters">("plans");
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [newMeter, setNewMeter] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="v-segmented" role="tablist">
            {(["plans", "meters"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className="v-segmented__item"
                onClick={() => {
                  setTab(value);
                }}
              >
                {t.tabs[value]}
              </button>
            ))}
          </div>
          {tab === "plans" && (
            <div className="v-segmented" role="tablist">
              {[false, true].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  role="tab"
                  aria-selected={archived === value}
                  className="v-segmented__item"
                  onClick={() => {
                    setArchived(value);
                  }}
                >
                  {value ? k.common.archived : k.common.active}
                </button>
              ))}
            </div>
          )}
          {manage && tab === "plans" && !archived && (
            <Button
              onClick={() => {
                setEditing("new");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.new}
            </Button>
          )}
          {manage && tab === "meters" && (
            <Button
              onClick={() => {
                setNewMeter(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.meters.new}
            </Button>
          )}
        </div>
      </div>
      {tab === "plans" ? (
        <PlansList archived={archived} manage={manage} onEdit={setEditing} />
      ) : (
        <MetersList />
      )}
      {editing !== null && (
        <PlanDialog
          plan={editing === "new" ? undefined : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {newMeter && (
        <MeterDialog
          onClose={() => {
            setNewMeter(false);
          }}
        />
      )}
    </div>
  );
}

function PlansList({
  archived,
  manage,
  onEdit,
}: {
  archived: boolean;
  manage: boolean;
  onEdit: (plan: Plan) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const plans = useQuery({
    queryKey: maintenanceKeys.plans(workspaceSlug, archived),
    queryFn: () => maintenanceApi.plans(workspaceSlug, archived),
    select: (data) => data.plans,
  });
  if (plans.isPending) return <Skeleton className="h-48 w-full" />;
  if (plans.isError) {
    return (
      <Card>
        <EmptyState icon={CalendarClock} title={adminErrorText(plans.error)}>
          {null}
        </EmptyState>
      </Card>
    );
  }
  if (plans.data.length === 0) {
    return (
      <Card>
        <EmptyState icon={CalendarClock} title={t.empty}>
          {null}
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card className="p-0">
      <ul className="divide-y divide-border">
        {plans.data.map((plan) => (
          <li key={plan.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 basis-64">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{plan.name}</span>
                {plan.kind === "CALIBRATION" && <Badge tone="primary">{t.kinds.CALIBRATION}</Badge>}
                {!plan.archived && <PlanStateBadge state={plan.state} />}
              </p>
              <p className="text-xs text-muted-foreground">
                {[
                  plan.asset === null ? null : `${plan.asset.code} · ${plan.asset.name}`,
                  frequencyOf(plan),
                  plan.assignedTo?.name ?? null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-xs text-muted-foreground">
                {[
                  nextOf(plan),
                  plan.lastDoneOn === null ? null : t.last(formatUtcDate(plan.lastDoneOn)),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {plan.openWorkOrder !== null && (
                <Link
                  to={`/app/${workspaceSlug}/mantenimiento/ot/${plan.openWorkOrder.id}`}
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t.openOrder}: {plan.openWorkOrder.code}
                </Link>
              )}
              {manage && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`${k.common.edit}: ${plan.name}`}
                  onClick={() => {
                    onEdit(plan);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const intOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
};

function PlanDialog({ plan, onClose }: { plan?: Plan | undefined; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const f = t.form;
  const assets = useAssets();
  const assetSource = useAssetSource("plans", assets.data ?? []);
  const technicians = useTechnicianSource();
  const meters = useQuery({
    queryKey: maintenanceKeys.meters(workspaceSlug),
    queryFn: () => maintenanceApi.meters(workspaceSlug),
    select: (data) => data.meters,
  });
  const kinds = useStaticSource(
    "maintenance-plan-kinds",
    (["PREVENTIVE", "CALIBRATION"] as const).map((id) => ({ id, label: t.kinds[id] })),
  );
  const units = useStaticSource(
    "maintenance-plan-units",
    PLAN_UNITS.map((id) => ({ id, label: t.units[id] })),
  );
  const [state, setState] = useState({
    assetId: plan?.asset?.id ?? null,
    kind: plan?.kind ?? "PREVENTIVE",
    name: plan?.name ?? "",
    byUse: plan?.meter != null,
    every: plan?.every == null ? "1" : String(plan.every),
    everyUnit: plan?.everyUnit ?? "MONTHS",
    firstDueOn: plan?.nextDueOn ?? "",
    meterId: plan?.meter?.id ?? null,
    meterEvery: plan?.meterEvery == null ? "" : String(plan.meterEvery),
    firstMeterAt: plan?.nextMeterAt == null ? "" : String(plan.nextMeterAt),
    assignedToId: plan?.assignedTo?.id ?? null,
    estimated: plan?.estimatedMinutes == null ? "" : String(plan.estimatedMinutes),
    leadDays: String(plan?.leadDays ?? 3),
    lockout: plan?.lockout ?? false,
    checklist: (plan?.checklist ?? []).join("\n"),
    instructions: plan?.instructions ?? "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const assetMeters = (meters.data ?? []).filter((meter) => meter.asset?.id === state.assetId);
  const meterSource = useStaticSource(
    `maintenance-plan-meters-${state.assetId ?? ""}`,
    assetMeters.map((meter) => ({ id: meter.id, label: `${meter.name} (${meter.unit})` })),
  );
  const every = intOrNull(state.every);
  const meterEvery = intOrNull(state.meterEvery);
  const firstMeterAt = intOrNull(state.firstMeterAt);
  const estimated = intOrNull(state.estimated);
  const leadDays = intOrNull(state.leadDays);
  const valid =
    state.assetId !== null &&
    state.name.trim() !== "" &&
    (state.byUse
      ? state.meterId !== null &&
        meterEvery !== null &&
        meterEvery > 0 &&
        !Number.isNaN(firstMeterAt)
      : every !== null && every > 0) &&
    !Number.isNaN(estimated) &&
    leadDays !== null &&
    leadDays >= 0;
  const save = useMutation({
    mutationFn: (archived?: boolean) => {
      const body = {
        assetId: state.assetId ?? "",
        kind: state.kind,
        name: state.name.trim(),
        instructions: state.instructions.trim(),
        checklist: state.checklist
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== ""),
        every: state.byUse ? null : every,
        everyUnit: state.byUse ? null : state.everyUnit,
        firstDueOn: state.byUse || state.firstDueOn === "" ? null : state.firstDueOn,
        meterId: state.byUse ? state.meterId : null,
        meterEvery: state.byUse ? meterEvery : null,
        firstMeterAt: state.byUse ? firstMeterAt : null,
        assignedToId: state.assignedToId,
        estimatedMinutes: estimated,
        leadDays: leadDays ?? 3,
        lockout: state.lockout,
      };
      return plan === undefined
        ? maintenanceApi.createPlan(workspaceSlug, body)
        : maintenanceApi.updatePlan(workspaceSlug, plan.id, {
            ...body,
            ...(archived === undefined ? {} : { archived }),
          });
    },
    onSuccess: async () => {
      toast.success(plan === undefined ? k.common.created : k.common.saved);
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const number = (
    label: string,
    key: "every" | "meterEvery" | "firstMeterAt" | "estimated" | "leadDays",
    hint?: string,
  ) => (
    <FormField label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) => (
        <Input
          {...control}
          type="number"
          inputMode="numeric"
          min={0}
          value={state[key]}
          onChange={(event) => {
            set({ [key]: event.target.value });
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
        title={plan === undefined ? t.new : t.edit}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {plan === undefined ? (
              <span />
            ) : (
              <Button
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  save.mutate(!plan.archived);
                }}
              >
                {plan.archived ? k.common.restore : k.common.archive}
              </Button>
            )}
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="outline" disabled={save.isPending}>
                  {texts.admin.common.cancel}
                </Button>
              </DialogClose>
              <Button
                disabled={!valid || save.isPending}
                onClick={() => {
                  save.mutate(undefined);
                }}
              >
                {save.isPending ? texts.admin.common.saving : texts.admin.common.save}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.asset}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  label={f.asset}
                  placeholder={f.asset}
                  source={assetSource}
                  value={state.assetId}
                  onChange={(option) => {
                    set({ assetId: option?.id ?? null, meterId: null });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.kind}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  label={f.kind}
                  placeholder={f.kind}
                  source={kinds}
                  value={state.kind}
                  onChange={(option) => {
                    if (option !== null) set({ kind: option.id as PlanKind });
                  }}
                />
              )}
            </FormField>
          </div>
          <FormField label={f.name}>
            {(control) => (
              <Input
                {...control}
                maxLength={160}
                placeholder={f.namePlaceholder}
                value={state.name}
                onChange={(event) => {
                  set({ name: event.target.value });
                }}
              />
            )}
          </FormField>
          <fieldset className="grid gap-2">
            <legend className="v-label">{f.by}</legend>
            <div className="v-segmented w-fit" role="tablist">
              {[false, true].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  role="tab"
                  aria-selected={state.byUse === value}
                  className="v-segmented__item"
                  onClick={() => {
                    set({ byUse: value });
                  }}
                >
                  {value ? f.byUse : f.byTime}
                </button>
              ))}
            </div>
          </fieldset>
          {state.byUse ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                label={f.meter}
                {...(assetMeters.length === 0 ? { hint: f.noMeters } : {})}
              >
                {(control) => (
                  <Combobox
                    id={control.id}
                    aria-describedby={control["aria-describedby"]}
                    label={f.meter}
                    placeholder={f.meterPlaceholder}
                    source={meterSource}
                    value={state.meterId}
                    onChange={(option) => {
                      set({ meterId: option?.id ?? null });
                    }}
                  />
                )}
              </FormField>
              {number(f.meterEvery, "meterEvery")}
              {number(f.firstMeterAt, "firstMeterAt", f.firstMeterAtHint)}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {number(f.every, "every")}
              <FormField label={f.unit}>
                {(control) => (
                  <Combobox
                    id={control.id}
                    aria-describedby={control["aria-describedby"]}
                    label={f.unit}
                    placeholder={f.unit}
                    source={units}
                    value={state.everyUnit}
                    onChange={(option) => {
                      if (option !== null) set({ everyUnit: option.id as PlanUnit });
                    }}
                  />
                )}
              </FormField>
              <FormField label={f.firstDueOn} hint={f.firstDueOnHint}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={state.firstDueOn}
                    onChange={(event) => {
                      set({ firstDueOn: event.target.value });
                    }}
                  />
                )}
              </FormField>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label={f.assigned}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  clearable
                  label={f.assigned}
                  placeholder={f.assignedPlaceholder}
                  source={technicians}
                  value={state.assignedToId}
                  onChange={(option) => {
                    set({ assignedToId: option?.id ?? null });
                  }}
                />
              )}
            </FormField>
            {number(f.estimated, "estimated")}
            {number(f.leadDays, "leadDays", f.leadDaysHint)}
          </div>
          <FormField label={f.checklist} hint={f.checklistHint}>
            {(control) => (
              <Textarea
                {...control}
                rows={4}
                value={state.checklist}
                onChange={(event) => {
                  set({ checklist: event.target.value });
                }}
              />
            )}
          </FormField>
          <FormField label={f.instructions}>
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={4000}
                value={state.instructions}
                onChange={(event) => {
                  set({ instructions: event.target.value });
                }}
              />
            )}
          </FormField>
          <Checkbox
            label={f.lockout}
            checked={state.lockout}
            onChange={(event) => {
              set({ lockout: event.target.checked });
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetersList() {
  const { workspaceSlug = "" } = useParams();
  const { work } = useMaintenance();
  const [reading, setReading] = useState<Meter | null>(null);
  const meters = useQuery({
    queryKey: maintenanceKeys.meters(workspaceSlug),
    queryFn: () => maintenanceApi.meters(workspaceSlug),
    select: (data) => data.meters,
  });
  if (meters.isPending) return <Skeleton className="h-32 w-full" />;
  if (meters.isError || meters.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Gauge}
          title={meters.isError ? adminErrorText(meters.error) : t.meters.empty}
        >
          {null}
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card className="p-0">
      <ul className="divide-y divide-border">
        {meters.data.map((meter) => (
          <li key={meter.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{meter.name}</p>
              <p className="text-xs text-muted-foreground">
                {[
                  meter.asset === null ? null : `${meter.asset.code} · ${meter.asset.name}`,
                  meter.lastValue === null || meter.lastReadAt === null
                    ? t.meters.none
                    : t.meters.last(meter.lastValue, meter.unit, formatDateTime(meter.lastReadAt)),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {work && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setReading(meter);
                }}
              >
                {t.meters.read}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {reading !== null && (
        <ReadingDialog
          meter={reading}
          onClose={() => {
            setReading(null);
          }}
        />
      )}
    </Card>
  );
}

function ReadingDialog({ meter, onClose }: { meter: Meter; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(meter.lastValue === null ? "" : String(meter.lastValue));
  const parsed = intOrNull(value);
  const save = useMutation({
    mutationFn: () => maintenanceApi.addReading(workspaceSlug, meter.id, parsed ?? 0),
    onSuccess: async () => {
      toast.success(t.meters.saved);
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.meters.readTitle}
        description={`${meter.asset?.code ?? ""} · ${meter.name}`}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={save.isPending}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={parsed === null || Number.isNaN(parsed) || parsed < 0 || save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {texts.admin.common.save}
            </Button>
          </>
        }
      >
        <FormField label={`${t.meters.value} (${meter.unit})`}>
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="numeric"
              min={meter.lastValue ?? 0}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
          )}
        </FormField>
      </DialogContent>
    </Dialog>
  );
}

function MeterDialog({ onClose }: { onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const m = t.meters;
  const assets = useAssets();
  const assetSource = useAssetSource("meters", assets.data ?? []);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const save = useMutation({
    mutationFn: () =>
      maintenanceApi.createMeter(workspaceSlug, {
        assetId: assetId ?? "",
        name: name.trim(),
        unit: unit.trim(),
      }),
    onSuccess: async () => {
      toast.success(k.common.created);
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={m.new}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={save.isPending}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
            <Button
              disabled={
                assetId === null || name.trim() === "" || unit.trim() === "" || save.isPending
              }
              onClick={() => {
                save.mutate();
              }}
            >
              {texts.admin.common.save}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <FormField label={m.asset}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                label={m.asset}
                placeholder={m.asset}
                source={assetSource}
                value={assetId}
                onChange={(option) => {
                  setAssetId(option?.id ?? null);
                }}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField label={m.name}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  placeholder={m.namePlaceholder}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </FormField>
            <FormField label={m.unit}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={20}
                  placeholder={m.unitPlaceholder}
                  value={unit}
                  onChange={(event) => {
                    setUnit(event.target.value);
                  }}
                />
              )}
            </FormField>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
