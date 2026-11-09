// /app/:slug/medio-ambiente/frio — cooling units and fluorinated gases (docs/spec/medio-ambiente.md,
// section 5): each unit's charge, CO2 equivalent and leak check period, worked out by the server; its log
// of checks, recharges and recoveries; the next check in color.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Snowflake,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import {
  COOLING_EVENTS,
  environmentMoreApi,
  environmentMoreKeys,
  type CoolingEventKind,
  type CoolingUnit,
} from "./environment-api";
import { DueDate, orNull, useEnvironment } from "./environment-common";
import { locale, texts } from "@/i18n";

const t = texts.environment.cooling;
const c = texts.environment.common;

const numberOf = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function CoolingPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage, record } = useEnvironment();
  const [archived, setArchived] = useState(false);
  const units = useQuery({
    queryKey: environmentMoreKeys.coolingUnits(workspaceSlug, archived),
    queryFn: () => environmentMoreApi.coolingUnits(workspaceSlug, archived),
    select: (data) => data.units,
  });
  const [editing, setEditing] = useState<CoolingUnit | "new" | null>(null);
  const [logging, setLogging] = useState<CoolingUnit | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
                {value ? c.archived : c.active}
              </button>
            ))}
          </div>
          {manage && !archived && (
            <Button
              onClick={() => {
                setEditing("new");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.new}
            </Button>
          )}
        </div>
      </div>
      {units.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (units.data ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={Snowflake} title={t.empty}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {(units.data ?? []).map((unit) => (
              <li key={unit.id} className="grid gap-2 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    type="button"
                    className="flex min-w-0 items-start gap-2 text-left"
                    aria-expanded={open === unit.id}
                    onClick={() => {
                      setOpen(open === unit.id ? null : unit.id);
                    }}
                  >
                    {open === unit.id ? (
                      <ChevronDown className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    )}
                    <span className="grid min-w-0 gap-0.5">
                      <span className="font-medium">{unit.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[unit.location, unit.installer].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="grid text-right">
                      <span>
                        {unit.refrigerant} · {unit.chargeKg.toLocaleString(locale)} kg
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {t.co2(unit.co2Tonnes.toLocaleString(locale, { maximumFractionDigits: 2 }))}
                      </span>
                    </span>
                    <span className="min-w-28 text-right">
                      {unit.nextCheckOn === null ? (
                        <span className="text-xs text-muted-foreground">{c.none}</span>
                      ) : (
                        <DueDate day={unit.nextCheckOn} warnDays={30} />
                      )}
                    </span>
                    {record && !unit.archived && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setLogging(unit);
                        }}
                      >
                        {t.newEvent}
                      </Button>
                    )}
                    {manage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`${c.edit}: ${unit.name}`}
                        onClick={() => {
                          setEditing(unit);
                        }}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-6">
                  {!unit.fluorinated ? (
                    <Badge>{t.notFgas}</Badge>
                  ) : unit.checkEveryMonths === null ? (
                    <Badge>{t.noCheck}</Badge>
                  ) : (
                    <Badge tone="primary">{t.every(unit.checkEveryMonths)}</Badge>
                  )}
                  {unit.lastCheckOn !== null && (
                    <Badge>{t.lastCheck(formatUtcDate(unit.lastCheckOn))}</Badge>
                  )}
                  {unit.restricted && (
                    <Badge tone="warning">
                      <AlertTriangle className="mr-1 inline size-3" aria-hidden="true" />
                      {t.restricted}
                    </Badge>
                  )}
                </div>
                {open === unit.id && <Log unitId={unit.id} manage={manage} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing !== null && (
        <UnitDialog
          unit={editing === "new" ? undefined : editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {logging !== null && (
        <EventDialog
          unit={logging}
          onClose={() => {
            setLogging(null);
          }}
        />
      )}
    </div>
  );
}

function Log({ unitId, manage }: { unitId: string; manage: boolean }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const events = useQuery({
    queryKey: environmentMoreKeys.coolingEvents(workspaceSlug, unitId),
    queryFn: () => environmentMoreApi.coolingEvents(workspaceSlug, unitId),
    select: (data) => data.events,
  });
  const remove = useMutation({
    mutationFn: (id: string) => environmentMoreApi.deleteCoolingEvent(workspaceSlug, id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["w", workspaceSlug, "environment"] });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  if (events.isPending) return <Skeleton className="ml-6 h-16" />;
  const list = events.data ?? [];
  return (
    <div className="ml-6 rounded-lg border border-border">
      <p className="border-b border-border px-3 py-2 text-xs font-medium">{t.log}</p>
      {list.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{t.noEvents}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {list.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
            >
              <div className="grid min-w-0 gap-0.5">
                <span>
                  <span className="tabular-nums">{formatUtcDate(event.date)}</span> ·{" "}
                  <span className="font-medium">{t.eventKinds[event.kind]}</span>
                  {event.leakFound === true && (
                    <Badge tone="danger" className="ml-2">
                      {t.eventForm.leakFound}
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[
                    event.kgAdded === null ? null : `+${event.kgAdded.toLocaleString(locale)} kg`,
                    event.kgRecovered === null
                      ? null
                      : `−${event.kgRecovered.toLocaleString(locale)} kg`,
                    event.company,
                    event.certificateRef,
                    event.recordedBy,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {event.notes !== "" && (
                  <span className="text-xs text-muted-foreground">{event.notes}</span>
                )}
              </div>
              {manage && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={t.deleteEvent}
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate(event.id);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Footer({
  busy,
  ready,
  onSave,
  extra,
}: {
  busy: boolean;
  ready: boolean;
  onSave: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      {extra ?? <span />}
      <div className="flex gap-2">
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            {texts.admin.common.cancel}
          </Button>
        </DialogClose>
        <Button disabled={!ready || busy} onClick={onSave}>
          {busy ? texts.admin.common.saving : texts.admin.common.save}
        </Button>
      </div>
    </div>
  );
}

function UnitDialog({ unit, onClose }: { unit?: CoolingUnit | undefined; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const f = t.form;
  const refrigerants = useQuery({
    queryKey: environmentMoreKeys.refrigerants(workspaceSlug),
    queryFn: () => environmentMoreApi.refrigerants(workspaceSlug),
    select: (data) => data.refrigerants,
    staleTime: Infinity,
  });
  const [state, setState] = useState({
    name: unit?.name ?? "",
    location: unit?.location ?? "",
    refrigerant: unit?.refrigerant ?? "",
    chargeKg: unit === undefined ? "" : String(unit.chargeKg),
    gwp: unit === undefined ? "" : String(unit.gwp),
    leakDetection: unit?.leakDetection ?? false,
    installer: unit?.installer ?? "",
    installedOn: unit?.installedOn ?? "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const charge = numberOf(state.chargeKg);
  const gwp = state.gwp.trim() === "" ? null : Number.parseInt(state.gwp, 10);
  const save = useMutation({
    mutationFn: (archived?: boolean) => {
      const body = {
        name: state.name.trim(),
        location: state.location.trim(),
        refrigerant: state.refrigerant.trim(),
        chargeKg: charge ?? 0,
        gwp: gwp !== null && Number.isInteger(gwp) ? gwp : null,
        leakDetection: state.leakDetection,
        installer: state.installer.trim(),
        installedOn: orNull(state.installedOn),
      };
      return unit === undefined
        ? environmentMoreApi.createCoolingUnit(workspaceSlug, body)
        : environmentMoreApi.updateCoolingUnit(workspaceSlug, unit.id, {
            ...body,
            ...(archived === undefined ? {} : { archived }),
          });
    },
    onSuccess: async () => {
      toast.success(unit === undefined ? c.created : c.saved);
      await queryClient.invalidateQueries({ queryKey: ["w", workspaceSlug, "environment"] });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const known = refrigerants.data ?? {};
  const reference = known[state.refrigerant.trim()];
  const ready = state.name.trim() !== "" && state.refrigerant.trim() !== "" && charge !== null;
  const text = (label: string, key: "name" | "location" | "installer", hint?: string) => (
    <FormField label={label} {...(hint === undefined ? {} : { hint })}>
      {(control) => (
        <Input
          {...control}
          maxLength={160}
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
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={unit === undefined ? t.new : t.edit}
        footer={
          <Footer
            busy={save.isPending}
            ready={ready}
            onSave={() => {
              save.mutate(undefined);
            }}
            extra={
              unit === undefined ? undefined : (
                <Button
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    save.mutate(!unit.archived);
                  }}
                >
                  {unit.archived ? c.restore : c.archive}
                </Button>
              )
            }
          />
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {text(f.name, "name")}
            {text(f.location, "location")}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label={f.refrigerant} hint={f.refrigerantHint}>
              {(control) => (
                <>
                  <Input
                    {...control}
                    list="environment-refrigerants"
                    maxLength={40}
                    value={state.refrigerant}
                    onChange={(event) => {
                      set({ refrigerant: event.target.value });
                    }}
                  />
                  <datalist id="environment-refrigerants">
                    {Object.keys(known).map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>
            <FormField label={f.charge}>
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={state.chargeKg}
                  onChange={(event) => {
                    set({ chargeKg: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField
              label={f.gwp}
              hint={reference === undefined ? f.gwpHint : `${f.gwpHint} (${String(reference)})`}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={0}
                  max={30000}
                  placeholder={reference === undefined ? "" : String(reference)}
                  value={state.gwp}
                  onChange={(event) => {
                    set({ gwp: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>
          <Checkbox
            label={f.leakDetection}
            checked={state.leakDetection}
            onChange={(event) => {
              set({ leakDetection: event.target.checked });
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {text(f.installer, "installer")}
            <FormField label={f.installedOn}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={state.installedOn}
                  onChange={(event) => {
                    set({ installedOn: event.target.value });
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

function EventDialog({ unit, onClose }: { unit: CoolingUnit; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const f = t.eventForm;
  const today = new Date().toISOString().slice(0, 10);
  const kinds = useStaticSource(
    "environment-cooling-events",
    COOLING_EVENTS.map((id) => ({ id, label: t.eventKinds[id] })),
  );
  const [state, setState] = useState({
    date: today,
    kind: "LEAK_CHECK" as CoolingEventKind,
    kgAdded: "",
    kgRecovered: "",
    leakFound: false,
    company: unit.installer,
    certificateRef: "",
    notes: "",
  });
  const set = (patch: Partial<typeof state>) => {
    setState({ ...state, ...patch });
  };
  const save = useMutation({
    mutationFn: () =>
      environmentMoreApi.createCoolingEvent(workspaceSlug, {
        unitId: unit.id,
        date: state.date,
        kind: state.kind,
        kgAdded: numberOf(state.kgAdded),
        kgRecovered: numberOf(state.kgRecovered),
        leakFound: state.kind === "LEAK_CHECK" ? state.leakFound : null,
        company: state.company.trim(),
        certificateRef: state.certificateRef.trim(),
        notes: state.notes.trim(),
      }),
    onSuccess: async () => {
      toast.success(t.eventSaved);
      await queryClient.invalidateQueries({ queryKey: ["w", workspaceSlug, "environment"] });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const text = (label: string, key: "company" | "certificateRef") => (
    <FormField label={label}>
      {(control) => (
        <Input
          {...control}
          maxLength={120}
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
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        size="lg"
        title={t.eventTitle}
        description={unit.name}
        footer={
          <Footer
            busy={save.isPending}
            ready={state.date !== ""}
            onSave={() => {
              save.mutate();
            }}
          />
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.date}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={today}
                  value={state.date}
                  onChange={(event) => {
                    set({ date: event.target.value });
                  }}
                />
              )}
            </FormField>
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
                    const kind = COOLING_EVENTS.find((id) => id === option?.id);
                    if (kind !== undefined) set({ kind });
                  }}
                />
              )}
            </FormField>
          </div>
          {state.kind === "LEAK_CHECK" && (
            <Checkbox
              label={f.leakFound}
              checked={state.leakFound}
              onChange={(event) => {
                set({ leakFound: event.target.checked });
              }}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={f.kgAdded}>
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={state.kgAdded}
                  onChange={(event) => {
                    set({ kgAdded: event.target.value });
                  }}
                />
              )}
            </FormField>
            <FormField label={f.kgRecovered}>
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={state.kgRecovered}
                  onChange={(event) => {
                    set({ kgRecovered: event.target.value });
                  }}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {text(f.company, "company")}
            {text(f.certificate, "certificateRef")}
          </div>
          <FormField label={f.notes}>
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={4000}
                value={state.notes}
                onChange={(event) => {
                  set({ notes: event.target.value });
                }}
              />
            )}
          </FormField>
        </div>
      </DialogContent>
    </Dialog>
  );
}
