// /app/:slug/medio-ambiente/resumen — the Environment area's summary (docs/spec/medio-ambiente.md): what's
// due in the next 60 days, the analyses out of limits and last month's consumption. environment.view.
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { formatUtcDate } from "@/lib/utils";
import {
  environmentMoreApi,
  environmentMoreKeys,
  type EnvironmentSummary,
} from "./environment-api";
import { DueDate } from "./environment-common";
import { locale, texts } from "@/i18n";

const t = texts.environment.summary;

const pathOf: Record<EnvironmentSummary["due"][number]["kind"], string> = {
  permit: "autorizaciones",
  obligation: "autorizaciones",
  contractor: "residuos?pestana=gestores",
  storage: "residuos?pestana=catalogo",
  leak_check: "frio",
};

const monthName = (month: string) =>
  new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

const amount = (value: number | null, unit: string) =>
  value === null ? "—" : `${value.toLocaleString(locale)} ${unit}`;

export function EnvironmentSummaryPage() {
  const { workspaceSlug = "" } = useParams();
  const summary = useQuery({
    queryKey: environmentMoreKeys.summary(workspaceSlug),
    queryFn: () => environmentMoreApi.summary(workspaceSlug),
  });
  const data = summary.data;
  const base = `/app/${workspaceSlug}/medio-ambiente`;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      {data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="grid content-start gap-3 p-4 sm:p-5 lg:row-span-2">
            <CardTitle>{t.due}</CardTitle>
            {data.due.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noDue}</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.due.map((item) => (
                  <li
                    key={`${item.kind}-${item.id}`}
                    className="flex items-start justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`${base}/${pathOf[item.kind]}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {item.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{t.kinds[item.kind]}</p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <DueDate day={item.dueOn} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="grid content-start gap-3 p-4 sm:p-5">
            <CardTitle>{t.samples}</CardTitle>
            {data.samplesOut.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noSamples}</p>
            ) : (
              <ul className="grid gap-2">
                {data.samplesOut.map((sample) => (
                  <li key={sample.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      to={`${base}/vertidos`}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {sample.permit} · {formatUtcDate(sample.takenOn)}
                    </Link>
                    <Badge tone="danger">{t.outCount(sample.outOfLimits)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="grid content-start gap-3 p-4 sm:p-5">
            <CardTitle>{t.lastMonth(monthName(data.lastMonth.month))}</CardTitle>
            {data.lastMonth.meters.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noReadings}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1 font-normal" />
                    <th className="pb-1 text-right font-normal">
                      {monthName(data.lastMonth.month)}
                    </th>
                    <th className="pb-1 text-right font-normal">{t.vsLastYear}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lastMonth.meters.map((meter) => (
                    <tr key={meter.name} className="border-t border-border">
                      <td className="py-1.5">{meter.name}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {amount(meter.consumption, meter.unit)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {amount(meter.previous, meter.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
