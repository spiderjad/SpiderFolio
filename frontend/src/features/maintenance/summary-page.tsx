// /app/:slug/mantenimiento/resumen — the maintenance indicators (docs/spec/mantenimiento.md, section 7):
// availability, MTBF, MTTR, downtime, breakdowns, preventive versus corrective, preventive compliance and
// open work orders, for a period and the whole plant or one line or machine; the equipment with the most
// breakdowns, and the CSV of every piece of equipment. For whoever sees maintenance.
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarCheck,
  Clock,
  Download,
  Gauge,
  ListTodo,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { KpiCard } from "@/components/ui/data";
import { Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { formatNumber } from "@/lib/utils";
import { maintenanceApi, maintenanceKeys, type IndicatorsQuery } from "./maintenance-api";
import { todayDay, useAssetSource, useAssets } from "./maintenance-common";
import { texts } from "@/i18n";

const t = texts.maintenance.summary;
const PERIODS = ["30", "90", "365", "year"] as const;
type Period = (typeof PERIODS)[number];

function addDaysTo(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rangeOf(period: Period): { desde: string; hasta: string } {
  const hasta = todayDay();
  if (period === "year") return { desde: `${hasta.slice(0, 4)}-01-01`, hasta };
  return { desde: addDaysTo(hasta, 1 - Number(period)), hasta };
}

/** Hours as people read them: «10 min», «1 h 42 min», «89 d 23 h». */
export function readableHours(value: number): string {
  const minutes = Math.round(value * 60);
  if (minutes < 60) return t.duration.minutes(minutes);
  if (minutes < 48 * 60) return t.duration.hours(Math.floor(minutes / 60), minutes % 60);
  const hours = Math.round(value);
  return t.duration.days(Math.floor(hours / 24), hours % 24);
}

/** A duration, readable, with the exact hours on hover. */
function Hours({ value }: { value: number | null }) {
  if (value === null) return <>{t.none}</>;
  return <span title={t.duration.exact(formatNumber(value))}>{readableHours(value)}</span>;
}
/** One decimal; two when it rounds to 100 % but isn't (99,99 %: there was some downtime). */
const percent = (value: number | null) => {
  if (value === null) return t.none;
  const one = Math.round(value * 1000) / 10;
  const shown = one === 100 && value < 1 ? Math.floor(value * 10_000) / 100 : one;
  return `${formatNumber(shown)} %`;
};

export function SummaryPage() {
  const { workspaceSlug = "" } = useParams();
  const [period, setPeriod] = useState<Period>("90");
  const [assetId, setAssetId] = useState<string | null>(null);
  const assets = useAssets();
  const assetSource = useAssetSource("summary", assets.data ?? []);
  const query: IndicatorsQuery = { ...rangeOf(period), equipo: assetId ?? undefined };
  const data = useQuery({
    queryKey: maintenanceKeys.indicators(workspaceSlug, query),
    queryFn: () => maintenanceApi.indicators(workspaceSlug, query),
  });
  const csv = useMutation({
    mutationFn: () => maintenanceApi.indicatorsCsv(workspaceSlug, query),
    onSuccess: (blob) => {
      downloadBlobFile(`indicadores-${query.desde}-${query.hasta}.csv`, blob);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const d = data.data;
  const loading = data.isPending;
  const base = `/app/${workspaceSlug}/mantenimiento/ot`;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="v-segmented" role="tablist">
            {PERIODS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={period === value}
                className="v-segmented__item"
                onClick={() => {
                  setPeriod(value);
                }}
              >
                {t.periods[value]}
              </button>
            ))}
          </div>
          <div className="w-60 max-w-full">
            <Combobox
              clearable
              compact
              label={t.scope}
              placeholder={t.allPlant}
              source={assetSource}
              value={assetId}
              onChange={(option) => {
                setAssetId(option?.id ?? null);
              }}
            />
          </div>
          <Button
            variant="outline"
            disabled={csv.isPending || d === undefined}
            onClick={() => {
              csv.mutate();
            }}
          >
            <Download className="size-4" aria-hidden="true" />
            {t.export}
          </Button>
        </div>
      </div>
      {data.isError ? (
        <Card>
          <EmptyState icon={Gauge} title={adminErrorText(data.error)}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label={t.availability}
              icon={Activity}
              loading={loading}
              value={percent(d?.availability ?? null)}
              detail={t.availabilityDetail(readableHours(d?.downtimeHours ?? 0))}
            />
            <KpiCard
              label={t.mtbf}
              icon={Timer}
              loading={loading}
              value={<Hours value={d?.mtbfHours ?? null} />}
            />
            <KpiCard
              label={t.mttr}
              icon={Clock}
              loading={loading}
              value={<Hours value={d?.mttrHours ?? null} />}
            />
            <KpiCard
              label={t.breakdowns}
              icon={TriangleAlert}
              loading={loading}
              value={formatNumber(d?.breakdowns ?? 0)}
              detail={t.breakdownsDetail(d?.equipment ?? 0)}
            />
            <KpiCard
              label={t.preventive}
              icon={CalendarCheck}
              loading={loading}
              value={percent(d?.preventiveShare ?? null)}
              detail={t.preventiveDetail(d?.preventiveDone ?? 0, d?.correctiveDone ?? 0)}
            />
            <KpiCard
              label={t.compliance}
              icon={CalendarCheck}
              loading={loading}
              value={percent(d?.compliance.rate ?? null)}
              detail={t.complianceDetail(d?.compliance.onTime ?? 0, d?.compliance.due ?? 0)}
            />
            <KpiCard
              label={t.open}
              icon={ListTodo}
              loading={loading}
              to={`${base}?estado=open`}
              value={formatNumber(d?.open ?? 0)}
              detail={t.openDetail(d?.overdue ?? 0, d?.onHold ?? 0)}
            />
          </div>
          <Card className="grid gap-3 p-4 sm:p-5">
            <CardTitle>{t.top}</CardTitle>
            {loading ? (
              <Skeleton className="h-32" />
            ) : (d?.top ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.topEmpty}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">{t.columns.asset}</th>
                      <th className="py-2 pr-3 font-medium">{t.columns.line}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t.columns.breakdowns}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t.columns.downtime}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t.columns.mttr}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t.columns.mtbf}</th>
                      <th className="py-2 text-right font-medium">{t.columns.availability}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(d?.top ?? []).map((asset) => (
                      <tr key={asset.id}>
                        <td className="py-2 pr-3">
                          <span className="font-medium tabular-nums">{asset.code}</span>{" "}
                          {asset.name}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{asset.line}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{asset.breakdowns}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <Hours value={asset.downtimeHours} />
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <Hours value={asset.mttrHours} />
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          <Hours value={asset.mtbfHours} />
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {percent(asset.availability)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="max-w-3xl text-xs text-muted-foreground">{t.how}</p>
        </>
      )}
    </div>
  );
}
