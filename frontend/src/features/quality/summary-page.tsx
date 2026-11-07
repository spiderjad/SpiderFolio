// /app/:slug/calidad/resumen — the Quality dashboard (docs/spec/calidad.md, «Fase 6a»): open
// nonconformities by severity and origin, overdue actions, checks due today, the figures of HACCP,
// suppliers, complaints, audits and prerequisites, and the latest open nonconformities (quality.view).
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, ClipboardX, Siren } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { cn, formatUtcDate } from "@/lib/utils";
import { NC_ORIGINS, SEVERITIES, prpKeys, prpsApi, qualityApi, qualityKeys } from "./quality-api";
import { NcStatusBadge, SeverityBadge } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.summary;
const b = texts.quality.dashboard;

function Stat({
  label,
  value,
  to,
  alert,
}: {
  label: string;
  value: number | string;
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
          alert === true && typeof value === "number" && value > 0 && "text-danger",
        )}
      >
        {value}
      </p>
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="grid content-start gap-3 p-4 sm:p-5">
      <CardTitle>{title}</CardTitle>
      {children}
    </Card>
  );
}

export function QualitySummaryPage() {
  const { workspaceSlug = "" } = useParams();
  const query = useQuery({
    queryKey: qualityKeys.summary(workspaceSlug),
    queryFn: () => qualityApi.summary(workspaceSlug),
  });
  const dashboard = useQuery({
    queryKey: prpKeys.dashboard(workspaceSlug),
    queryFn: () => prpsApi.dashboard(workspaceSlug),
  });
  const base = `/app/${workspaceSlug}/calidad`;
  const data = query.data;
  const board = dashboard.data;
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
      {board === undefined ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={b.ncs}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat
                label={b.averageClose}
                value={board.ncs.averageCloseDays ?? "—"}
                to={`${base}/no-conformidades?estado=CLOSED`}
              />
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs text-muted-foreground">{b.byOrigin}</p>
                <ul className="mt-2 grid gap-1 text-sm">
                  {NC_ORIGINS.map((origin) => ({
                    origin,
                    count: board.ncs.byOrigin.find((row) => row.origin === origin)?.count ?? 0,
                  }))
                    .filter((row) => row.count > 0)
                    .map((row) => (
                      <li key={row.origin} className="flex justify-between gap-3">
                        <Link
                          to={`${base}/no-conformidades?origen=${row.origin}`}
                          className="truncate hover:text-primary"
                        >
                          {texts.quality.origins[row.origin]}
                        </Link>
                        <span className="tabular-nums">{row.count}</span>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </Section>
          <Section title={b.prps}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label={b.prpsOverdue}
                value={board.prps.overdue}
                to={`${base}/prerrequisitos`}
                alert
              />
              <Stat
                label={b.prpsDueSoon}
                value={board.prps.dueSoon}
                to={`${base}/prerrequisitos`}
              />
              <Stat
                label={b.prpsNonConforming}
                value={board.prps.nonConforming}
                to={`${base}/prerrequisitos`}
                alert
              />
            </div>
          </Section>
          <Section title={b.sampling}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat
                label={b.samplingOverdue}
                value={board.sampling.overdue}
                to={`${base}/plan-analitico`}
                alert
              />
              <Stat
                label={b.samplingNonConforming}
                value={board.sampling.nonConforming}
                to={`${base}/plan-analitico`}
                alert
              />
            </div>
          </Section>
          <Section title={b.products}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label={b.labelsOutdated}
                value={board.products.labelsOutdated}
                to={`${base}/productos`}
                alert
              />
              <Stat
                label={b.labelsInReview}
                value={board.products.labelsInReview}
                to={`${base}/productos`}
              />
              <Stat
                label={b.withoutStudy}
                value={board.products.withoutStudy}
                to={`${base}/productos`}
                alert
              />
            </div>
          </Section>
          <Section title={b.haccp}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={b.records} value={board.haccp.records} to={`${base}/appcc`} />
              <Stat
                label={b.outOfLimits}
                value={board.haccp.outOfLimits}
                to={`${base}/appcc`}
                alert
              />
              <Stat
                label={b.holdsPending}
                value={board.haccp.holdsPending}
                to={`${base}/retenido`}
                alert
              />
            </div>
          </Section>
          <Section title={b.suppliers}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label={b.docsExpired}
                value={board.suppliers.docsExpired}
                to={`${base}/proveedores`}
                alert
              />
              <Stat
                label={b.docsExpiring}
                value={board.suppliers.docsExpiring}
                to={`${base}/proveedores`}
              />
              <Stat
                label={b.reviewsOverdue}
                value={board.suppliers.reviewsOverdue}
                to={`${base}/proveedores`}
                alert
              />
            </div>
          </Section>
          <Section title={b.complaints}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label={b.complaintsOpen}
                value={board.complaints.open}
                to={`${base}/reclamaciones`}
              />
              <Stat
                label={b.complaintsOverdue}
                value={board.complaints.overdue}
                to={`${base}/reclamaciones`}
                alert
              />
              <Stat
                label={b.perMillion(board.complaints.year)}
                value={
                  board.complaints.perMillion === null
                    ? b.noUnits
                    : board.complaints.perMillion.toLocaleString()
                }
                to={`${base}/reclamaciones?pestana=indicadores`}
              />
            </div>
          </Section>
          <Section title={b.audits}>
            <div className="grid gap-3">
              {board.audits.coverage.length > 0 && (
                <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {board.audits.coverage.map((row) => (
                    <li key={row.standard}>
                      <span className="text-muted-foreground">
                        {texts.quality.audits.standards[row.standard]}:
                      </span>{" "}
                      <span className="tabular-nums">{b.coverage(row.covered, row.chapters)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <p className="text-xs text-muted-foreground">{b.upcoming}</p>
                {board.audits.upcoming.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">{b.noUpcoming}</p>
                ) : (
                  <ul className="mt-1 grid gap-1 text-sm">
                    {board.audits.upcoming.map((audit) => (
                      <li key={audit.id} className="flex justify-between gap-3">
                        <Link
                          to={`${base}/auditorias/${audit.id}`}
                          className="min-w-0 truncate hover:text-primary"
                        >
                          {audit.title}
                        </Link>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatUtcDate(audit.plannedOn)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Section>
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
