// /app/:slug/medio-ambiente/consumos — consumption and indicators (docs/spec/medio-ambiente.md, section 4):
// each meter's reading at the end of the month (the server works out the consumption), the month's
// production, the ratio per tonne against the year's target and the same month the year before.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChartTooltip } from "@/components/ui/chart";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { cn } from "@/lib/utils";
import {
  METER_KINDS,
  environmentMoreApi,
  environmentMoreKeys,
  type ConsumptionYear,
  type Meter,
  type MeterKind,
} from "./environment-api";
import { useEnvironment } from "./environment-common";
import { locale, texts } from "@/i18n";

const t = texts.environment.consumption;

const monthShort = (month: string) =>
  new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
const monthLong = (month: string) =>
  new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
const fmt = (value: number | null, digits = 2) =>
  value === null ? "—" : value.toLocaleString(locale, { maximumFractionDigits: digits });
const numberOf = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

type Editing =
  | { kind: "reading"; meter: Meter; month: string; reading: number | null }
  | { kind: "production"; month: string; tonnes: number | null }
  | { kind: "target"; meter: Meter; target: number | null }
  | { kind: "meter"; meter: Meter | null };

export function ConsumptionPage() {
  const { workspaceSlug = "" } = useParams();
  const { manage, record } = useEnvironment();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const years = useStaticSource(
    "environment-years",
    Array.from({ length: 6 }, (_, index) => {
      const value = String(thisYear - index);
      return { id: value, label: value };
    }),
  );
  const data = useQuery({
    queryKey: environmentMoreKeys.consumption(workspaceSlug, year),
    queryFn: () => environmentMoreApi.consumption(workspaceSlug, year),
  });
  const [editing, setEditing] = useState<Editing | null>(null);
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-32">
            <Combobox
              searchable={false}
              label={t.year}
              placeholder={t.year}
              source={years}
              value={String(year)}
              onChange={(option) => {
                if (option !== null) setYear(Number(option.id));
              }}
            />
          </div>
          {manage && (
            <Button
              onClick={() => {
                setEditing({ kind: "meter", meter: null });
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.newMeter}
            </Button>
          )}
        </div>
      </div>
      {data.data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Production data={data.data} canEdit={record} onEdit={setEditing} />
          {data.data.meters.length === 0 ? (
            <Card>
              <EmptyState icon={Gauge} title={t.empty}>
                {null}
              </EmptyState>
            </Card>
          ) : (
            data.data.meters.map((entry) => (
              <MeterCard
                key={entry.meter.id}
                entry={entry}
                manage={manage}
                record={record}
                onEdit={setEditing}
              />
            ))
          )}
        </>
      )}
      {editing !== null && (
        <EditDialog
          editing={editing}
          year={year}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function Production({
  data,
  canEdit,
  onEdit,
}: {
  data: ConsumptionYear;
  canEdit: boolean;
  onEdit: (editing: Editing) => void;
}) {
  return (
    <Card className="grid gap-2 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>{t.production}</CardTitle>
        <span className="text-sm tabular-nums text-muted-foreground">
          {t.total}: {fmt(data.tonnes, 1)} t
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
        {data.production.map((entry) => (
          <button
            key={entry.month}
            type="button"
            disabled={!canEdit}
            className={cn(
              "grid rounded-md border border-border px-2 py-1.5 text-left text-xs",
              canEdit &&
                "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
            onClick={() => {
              onEdit({ kind: "production", month: entry.month, tonnes: entry.tonnes });
            }}
          >
            <span className="text-muted-foreground">{monthShort(entry.month)}</span>
            <span className="tabular-nums">{fmt(entry.tonnes, 1)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function MeterCard({
  entry,
  manage,
  record,
  onEdit,
}: {
  entry: ConsumptionYear["meters"][number];
  manage: boolean;
  record: boolean;
  onEdit: (editing: Editing) => void;
}) {
  const unit = entry.meter.unit;
  const overTarget =
    entry.target !== null && entry.perTonne !== null && entry.perTonne > entry.target;
  const chart = entry.months.map((point) => ({
    month: point.month,
    consumption: point.consumption,
    previous: point.previous,
  }));
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{entry.meter.name}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {t.meterKinds[entry.meter.kind]} · {unit}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="tabular-nums">
            {t.total}: {fmt(entry.total)} {unit}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {t.previousYear}: {fmt(entry.previousTotal)} {unit}
          </span>
          <span className={cn("tabular-nums", overTarget && "text-danger")}>
            {fmt(entry.perTonne, 3)} {unit} {t.perTonne}
            {entry.target !== null && ` / ${fmt(entry.target, 3)}`}
          </span>
          {manage && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onEdit({ kind: "target", meter: entry.meter, target: entry.target });
                }}
              >
                {t.target}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={`${t.edit}: ${entry.meter.name}`}
                onClick={() => {
                  onEdit({ kind: "meter", meter: entry.meter });
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ left: -8, right: 8, top: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              fontSize={11}
              tickFormatter={monthShort}
              className="fill-muted-foreground"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              fontSize={11}
              className="fill-muted-foreground"
            />
            <ChartTip
              cursor={{ className: "fill-muted" }}
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  label={props.label}
                  payload={props.payload}
                  names={{ consumption: t.consumption, previous: t.previousYear }}
                  formatLabel={monthLong}
                />
              )}
            />
            <Bar
              dataKey="previous"
              fill="var(--muted-foreground)"
              fillOpacity={0.35}
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
            />
            <Bar
              dataKey="consumption"
              fill="var(--primary)"
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-normal">{t.month}</th>
              {entry.months.map((point) => (
                <th key={point.month} className="py-1 text-right font-normal">
                  {monthShort(point.month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="py-1.5 text-muted-foreground">{t.consumption}</td>
              {entry.months.map((point) => (
                <td key={point.month} className="py-1 text-right">
                  <button
                    type="button"
                    disabled={!record}
                    title={
                      point.reading === null ? undefined : `${t.reading}: ${fmt(point.reading, 3)}`
                    }
                    className={cn(
                      "w-full rounded px-1 py-0.5 text-right tabular-nums",
                      record &&
                        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    )}
                    onClick={() => {
                      onEdit({
                        kind: "reading",
                        meter: entry.meter,
                        month: point.month,
                        reading: point.reading,
                      });
                    }}
                  >
                    {fmt(point.consumption, 1)}
                  </button>
                </td>
              ))}
            </tr>
            <tr className="border-t border-border">
              <td className="py-1.5 text-muted-foreground">{t.perTonne}</td>
              {entry.months.map((point) => (
                <td
                  key={point.month}
                  className={cn(
                    "px-1 py-1.5 text-right tabular-nums",
                    entry.target !== null &&
                      point.perTonne !== null &&
                      point.perTonne > entry.target &&
                      "text-danger",
                  )}
                >
                  {fmt(point.perTonne, 3)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-border text-muted-foreground">
              <td className="py-1.5">{t.previousYear}</td>
              {entry.months.map((point) => (
                <td key={point.month} className="px-1 py-1.5 text-right tabular-nums">
                  {fmt(point.previous, 1)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function EditDialog({
  editing,
  year,
  onClose,
}: {
  editing: Editing;
  year: number;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const kinds = useStaticSource(
    "environment-meter-kinds",
    METER_KINDS.map((id) => ({ id, label: t.meterKinds[id] })),
  );
  const [first, setFirst] = useState(
    editing.kind === "reading"
      ? editing.reading === null
        ? ""
        : String(editing.reading)
      : editing.kind === "production"
        ? editing.tonnes === null
          ? ""
          : String(editing.tonnes)
        : editing.kind === "target"
          ? editing.target === null
            ? ""
            : String(editing.target)
          : (editing.meter?.name ?? ""),
  );
  const [second, setSecond] = useState(editing.kind === "meter" ? (editing.meter?.unit ?? "") : "");
  const [kind, setKind] = useState<MeterKind>(
    editing.kind === "meter" ? (editing.meter?.kind ?? "WATER_NETWORK") : "WATER_NETWORK",
  );
  const done = async () => {
    toast.success(t.saved);
    await queryClient.invalidateQueries({ queryKey: ["w", workspaceSlug, "environment"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: async (archived?: boolean) => {
      if (editing.kind === "reading") {
        await environmentMoreApi.saveReading(workspaceSlug, {
          meterId: editing.meter.id,
          month: editing.month,
          reading: numberOf(first),
          consumption: numberOf(second),
        });
      } else if (editing.kind === "production") {
        await environmentMoreApi.saveProduction(workspaceSlug, {
          month: editing.month,
          tonnes: numberOf(first) ?? 0,
        });
      } else if (editing.kind === "target") {
        await environmentMoreApi.saveTarget(workspaceSlug, {
          meterId: editing.meter.id,
          year,
          perTonne: numberOf(first),
        });
      } else {
        const body = { name: first.trim(), kind, unit: second.trim() };
        if (editing.meter === null) await environmentMoreApi.createMeter(workspaceSlug, body);
        else {
          await environmentMoreApi.updateMeter(workspaceSlug, editing.meter.id, {
            ...body,
            ...(archived === undefined ? {} : { archived }),
          });
        }
      }
    },
    onSuccess: done,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const clear = useMutation({
    mutationFn: () =>
      editing.kind === "reading"
        ? environmentMoreApi.deleteReading(workspaceSlug, {
            meterId: editing.meter.id,
            month: editing.month,
          })
        : Promise.resolve(undefined),
    onSuccess: done,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const title =
    editing.kind === "reading"
      ? t.readingTitle(editing.meter.name, monthLong(editing.month))
      : editing.kind === "production"
        ? t.productionTitle(monthLong(editing.month))
        : editing.kind === "target"
          ? `${t.target} · ${editing.meter.name} · ${String(year)}`
          : editing.meter === null
            ? t.newMeter
            : t.editMeter;
  const ready =
    editing.kind === "meter"
      ? first.trim() !== "" && second.trim() !== ""
      : editing.kind === "reading"
        ? numberOf(first) !== null || numberOf(second) !== null
        : editing.kind === "production"
          ? numberOf(first) !== null
          : true;
  const busy = save.isPending || clear.isPending;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={title}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            {editing.kind === "reading" && editing.reading !== null ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  clear.mutate();
                }}
              >
                {t.clear}
              </Button>
            ) : editing.kind === "meter" && editing.meter !== null ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  save.mutate(!editing.meter?.archived);
                }}
              >
                {editing.meter.archived
                  ? texts.environment.common.restore
                  : texts.environment.common.archive}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="outline" disabled={busy}>
                  {texts.admin.common.cancel}
                </Button>
              </DialogClose>
              <Button
                disabled={!ready || busy}
                onClick={() => {
                  save.mutate(undefined);
                }}
              >
                {busy ? texts.admin.common.saving : texts.admin.common.save}
              </Button>
            </div>
          </div>
        }
      >
        {editing.kind === "meter" ? (
          <div className="grid gap-4">
            <FormField label={t.form.name}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={160}
                  value={first}
                  onChange={(event) => {
                    setFirst(event.target.value);
                  }}
                />
              )}
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t.form.kind}>
                {(control) => (
                  <Combobox
                    id={control.id}
                    aria-describedby={control["aria-describedby"]}
                    searchable={false}
                    label={t.form.kind}
                    placeholder={t.form.kind}
                    source={kinds}
                    value={kind}
                    onChange={(option) => {
                      const next = METER_KINDS.find((id) => id === option?.id);
                      if (next !== undefined) setKind(next);
                    }}
                  />
                )}
              </FormField>
              <FormField label={t.form.unit} hint={t.form.unitHint}>
                {(control) => (
                  <Input
                    {...control}
                    maxLength={20}
                    value={second}
                    onChange={(event) => {
                      setSecond(event.target.value);
                    }}
                  />
                )}
              </FormField>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <FormField
              label={
                editing.kind === "reading"
                  ? t.reading
                  : editing.kind === "production"
                    ? t.tonnes
                    : `${t.target} (${editing.meter.unit} / t)`
              }
              {...(editing.kind === "reading" ? { hint: t.readingHint } : {})}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={first}
                  onChange={(event) => {
                    setFirst(event.target.value);
                  }}
                />
              )}
            </FormField>
            {editing.kind === "reading" && (
              <FormField label={t.override} hint={t.overrideHint}>
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    value={second}
                    onChange={(event) => {
                      setSecond(event.target.value);
                    }}
                  />
                )}
              </FormField>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
