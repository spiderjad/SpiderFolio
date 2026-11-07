// /app/:slug/seguridad/indicadores — accident rates (docs/spec/seguridad-salud.md, «Indicadores de
// siniestralidad»): frequency, severity and incidence for the year to date and the last 12 months, by
// month in a chart, each month's hours and headcount (entered here by whoever manages the module) and,
// only with the health data capability, by department. Aggregated counts: no case details.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChartTooltip } from "@/components/ui/chart";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Card, CardTitle, Skeleton } from "@/components/ui/display";
import { Input } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { useListParams } from "@/features/admin/list-params";
import { useDepartmentSource } from "@/features/admin/sources";
import { locale, texts } from "@/i18n";
import {
  indicatorsApi,
  indicatorsKeys,
  type MonthStat,
  type RateFigures,
  type RatePeriod,
} from "./safety-api";
import { NotFoundPage } from "@/features/home/not-found-page";
import { useSafety } from "./safety-common";

const t = texts.safety.indicators;

const number = (value: number | null, digits = 2): string =>
  value === null
    ? "—"
    : value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const monthName = (month: string): string =>
  new Date(`${month}T12:00:00Z`).toLocaleDateString(locale, { month: "short", timeZone: "UTC" });

function Formula({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <button
        type="button"
        aria-label={text}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <Info className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

const RATES = ["frequency", "severity", "incidence"] as const;

function PeriodCard({ title, period }: { title: string; period: RatePeriod }) {
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <CardTitle className="text-base">{title}</CardTitle>
      <dl className="grid gap-3 sm:grid-cols-3">
        {RATES.map((rate) => (
          <div key={rate}>
            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
              {t[rate]}
              <Formula text={t.formulas[rate]} />
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">{number(period[rate])}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        {t.accidents(period.accidents)} · {t.lostDays(period.lostDays)}
      </p>
      {period.missing > 0 && <p className="text-xs text-warning">{t.missing(period.missing)}</p>}
    </Card>
  );
}

export function IndicatorsPage() {
  const { workspaceSlug = "" } = useParams();
  const safety = useSafety();
  const { params, patch } = useListParams();
  const thisYear = new Date().getFullYear();
  const yearParam = Number.parseInt(params.get("ano") ?? "", 10);
  const year =
    Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= thisYear + 1
      ? yearParam
      : thisYear;
  const years = useStaticSource(
    "safety-indicator-years",
    Array.from({ length: 6 }, (_, i) => String(thisYear - i)).map((id) => ({ id, label: id })),
  );
  const query = useQuery({
    queryKey: indicatorsKeys.year(workspaceSlug, year),
    queryFn: () => indicatorsApi.get(workspaceSlug, year),
    select: (data) => data.indicators,
  });
  const csv = useMutation({
    mutationFn: async () => {
      downloadBlobFile(
        `indicadores-${String(year)}.csv`,
        await indicatorsApi.csv(workspaceSlug, year),
      );
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = query.data;
  const allowed = safety.canManage || safety.health;
  const chart = useMemo(
    () =>
      (data?.months ?? []).map((month) => ({
        month: month.month,
        frequency: month.frequency ?? 0,
        accidents: month.accidents,
      })),
    [data],
  );
  const names = { frequency: t.series.frequency, accidents: t.series.accidents };
  if (!allowed) return <NotFoundPage />;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.definitionsNote[safety.termsKey]}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-28">
            <Combobox
              compact
              searchable={false}
              label={t.year}
              placeholder={t.year}
              source={years}
              value={String(year)}
              onChange={(option) => {
                patch({ ano: option?.id === String(thisYear) ? undefined : option?.id });
              }}
            />
          </div>
          <Button
            variant="outline"
            disabled={csv.isPending}
            onClick={() => {
              csv.mutate();
            }}
          >
            <Download className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {t.csv}
          </Button>
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <PeriodCard title={t.ytd(year)} period={data.ytd} />
            <PeriodCard title={t.last12} period={data.last12} />
          </div>
          <Card className="grid gap-3 p-4 sm:p-5">
            <CardTitle className="text-base">{t.chartTitle}</CardTitle>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ left: -16, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    tickFormatter={(value: string) => monthName(value)}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    yAxisId="rate"
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    yAxisId="count"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    allowDecimals={false}
                    className="fill-muted-foreground"
                  />
                  <ChartTip
                    cursor={{ className: "fill-muted" }}
                    content={(props) => (
                      <ChartTooltip
                        active={props.active}
                        label={props.label}
                        payload={props.payload}
                        names={names}
                        formatLabel={monthName}
                      />
                    )}
                  />
                  <Bar
                    yAxisId="count"
                    dataKey="accidents"
                    fill="var(--warning)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={20}
                  />
                  <Line
                    yAxisId="rate"
                    dataKey="frequency"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                    type="linear"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
          {safety.canManage && <MonthsCard year={year} months={data.months} />}
          {data.departments !== null && (
            <Card className="grid gap-3 p-4 sm:p-5">
              <CardTitle className="text-base">{t.departmentsTitle}</CardTitle>
              <p className="text-xs text-muted-foreground">{t.departmentsText}</p>
              {data.departments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noDepartments}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">{t.scope}</th>
                        <th className="py-2 pr-3 font-medium">{t.columns.accidents}</th>
                        {RATES.map((rate) => (
                          <th key={rate} className="py-2 pr-3 font-medium">
                            {t[rate]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.departments.map((department) => (
                        <tr key={department.id}>
                          <td className="py-2 pr-3 font-medium">{department.name}</td>
                          <td className="py-2 pr-3 tabular-nums">{department.ytd.accidents}</td>
                          {RATES.map((rate) => (
                            <td key={rate} className="py-2 pr-3 tabular-nums">
                              {number(department.ytd[rate])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** Each month's hours and headcount: entered and corrected here (company or a department). */
function MonthsCard({
  year,
  months,
}: {
  year: number;
  months: (RateFigures & { month: string })[];
}) {
  const { workspaceSlug = "" } = useParams();
  const departments = useDepartmentSource(workspaceSlug);
  const [department, setDepartment] = useState<{ id: string; label: string } | null>(null);
  const stats = useQuery({
    queryKey: indicatorsKeys.stats(workspaceSlug, year, department?.id ?? null),
    queryFn: () => indicatorsApi.stats(workspaceSlug, year, department?.id ?? null),
    select: (data) => data.items,
  });
  const byMonth = new Map(months.map((month) => [month.month, month]));
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <CardTitle className="text-base">{t.monthsTitle}</CardTitle>
      <p className="text-xs text-muted-foreground">{t.monthsText}</p>
      <div className="w-full max-w-xs">
        <Combobox
          compact
          clearable
          label={t.scope}
          placeholder={t.wholeCompany}
          source={departments}
          value={department?.id ?? null}
          valueLabel={department?.label}
          onChange={(option) => {
            setDepartment(option === null ? null : { id: option.id, label: option.label });
          }}
        />
      </div>
      {stats.data === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{t.columns.month}</th>
                <th className="py-2 pr-3 font-medium">{t.columns.hours}</th>
                <th className="py-2 pr-3 font-medium">{t.columns.headcount}</th>
                {department === null && (
                  <>
                    <th className="py-2 pr-3 font-medium">{t.columns.accidents}</th>
                    <th className="py-2 pr-3 font-medium">{t.columns.lostDays}</th>
                  </>
                )}
                <th className="py-2 font-medium">
                  <span className="sr-only">{texts.admin.common.save}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.data.map((row) => (
                <MonthRow
                  key={`${department?.id ?? "all"}-${row.month}`}
                  row={row}
                  departmentId={department?.id ?? null}
                  figures={department === null ? byMonth.get(row.month) : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MonthRow({
  row,
  departmentId,
  figures,
}: {
  row: MonthStat;
  departmentId: string | null;
  figures: RateFigures | undefined;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(row.hoursWorked === null ? "" : String(row.hoursWorked));
  const [headcount, setHeadcount] = useState(
    row.avgHeadcount === null ? "" : String(row.avgHeadcount),
  );
  const label = new Date(`${row.month}T12:00:00Z`).toLocaleDateString(locale, {
    month: "long",
    timeZone: "UTC",
  });
  const save = useMutation({
    mutationFn: () =>
      indicatorsApi.setStat(workspaceSlug, {
        month: row.month,
        departmentId,
        hoursWorked: Number.parseInt(hours, 10),
        avgHeadcount: Number.parseFloat(headcount.replace(",", ".")),
      }),
    onSuccess: async () => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: indicatorsKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const valid =
    /^\d+$/u.test(hours) && /^\d+([.,]\d+)?$/u.test(headcount) && Number.parseInt(hours, 10) >= 0;
  const changed =
    hours !== (row.hoursWorked === null ? "" : String(row.hoursWorked)) ||
    headcount !== (row.avgHeadcount === null ? "" : String(row.avgHeadcount));
  return (
    <tr>
      <td className="py-2 pr-3 capitalize">{label}</td>
      <td className="py-2 pr-3">
        <Input
          aria-label={`${t.columns.hours} · ${label}`}
          inputMode="numeric"
          className="w-32"
          value={hours}
          onChange={(event) => {
            setHours(event.target.value.replace(/\D/gu, ""));
          }}
        />
      </td>
      <td className="py-2 pr-3">
        <Input
          aria-label={`${t.columns.headcount} · ${label}`}
          inputMode="decimal"
          className="w-28"
          value={headcount}
          onChange={(event) => {
            setHeadcount(event.target.value.replace(/[^\d.,]/gu, ""));
          }}
        />
      </td>
      {figures !== undefined && (
        <>
          <td className="py-2 pr-3 tabular-nums">{figures.accidents}</td>
          <td className="py-2 pr-3 tabular-nums">{figures.lostDays}</td>
        </>
      )}
      <td className="py-2 text-right">
        <Button
          size="sm"
          variant="outline"
          aria-label={t.save(label)}
          disabled={!valid || !changed || save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          {texts.admin.common.save}
        </Button>
      </td>
    </tr>
  );
}
