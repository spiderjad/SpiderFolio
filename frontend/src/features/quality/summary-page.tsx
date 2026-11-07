// /app/:slug/calidad/resumen — the Quality area's summary (docs/spec/calidad.md, «Pantallas»): open
// nonconformities by severity, overdue actions, checks due today and the latest open ones. The full
// indicators panel is phase 6.
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, ClipboardX, Siren } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { cn, formatUtcDate } from "@/lib/utils";
import { SEVERITIES, qualityApi, qualityKeys } from "./quality-api";
import { NcStatusBadge, SeverityBadge } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.summary;

function Stat({
  label,
  value,
  to,
  alert,
}: {
  label: string;
  value: number;
  to: string;
  alert?: boolean;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-border bg-background p-4 transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          alert === true && value > 0 && "text-danger",
        )}
      >
        {value}
      </p>
    </Link>
  );
}

export function QualitySummaryPage() {
  const { workspaceSlug = "" } = useParams();
  const query = useQuery({
    queryKey: qualityKeys.summary(workspaceSlug),
    queryFn: () => qualityApi.summary(workspaceSlug),
  });
  const base = `/app/${workspaceSlug}/calidad`;
  const data = query.data;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      {data === undefined ? (
        <Skeleton className="h-28" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {SEVERITIES.map((severity) => (
            <Stat
              key={severity}
              label={t.open(texts.quality.severities[severity])}
              value={data.open[severity]}
              to={`${base}/no-conformidades?gravedad=${severity}`}
              alert={severity === "CRITICAL"}
            />
          ))}
          <Stat
            label={t.overdueActions}
            value={data.overdueActions}
            to={`${base}/acciones?estado=overdue`}
            alert
          />
          <Stat
            label={t.verifications}
            value={data.verificationsDue}
            to={`${base}/no-conformidades?estado=VERIFICATION`}
          />
        </div>
      )}
      <Card className="grid gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{t.latest}</CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link to={`${base}/no-conformidades`}>{t.seeAll}</Link>
          </Button>
        </div>
        {data !== undefined && data.latest.length === 0 ? (
          <EmptyState icon={ClipboardX}>{t.empty}</EmptyState>
        ) : (
          <ul className="-my-2 divide-y divide-border">
            {(data?.latest ?? []).map((nc) => (
              <li key={nc.id}>
                <Link
                  to={`${base}/no-conformidades/${nc.id}`}
                  className="flex min-h-14 flex-wrap items-center gap-3 py-2 text-sm hover:text-primary"
                >
                  <span className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {nc.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{nc.title}</span>
                  <SeverityBadge severity={nc.severity} />
                  <NcStatusBadge status={nc.status} />
                  <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                    {nc.actions.overdue > 0 ? (
                      <Siren className="size-3.5 text-danger" aria-hidden="true" />
                    ) : (
                      <CalendarCheck className="size-3.5" aria-hidden="true" />
                    )}
                    {formatUtcDate(nc.detectedOn)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
