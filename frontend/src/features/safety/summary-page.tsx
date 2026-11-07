// /app/:slug/seguridad/resumen — what needs attention in health and safety (docs/spec/seguridad-salud.md,
// «Resumen»): the start of the module for whoever manages it, each card with a link to its filtered list.
// The health data cards (fitness, measures, cases) only with safety.health.
import { useQuery } from "@tanstack/react-query";
import { ServerCrash } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { adminErrorText } from "@/features/admin/admin-utils";
import { peopleApi, safetyKeys } from "./safety-api";
import { PpeTabs, ReportIncidentButton, useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.summary;

function SummaryCard({
  title,
  text,
  count,
  extra,
  to,
}: {
  title: string;
  text: string;
  count: number;
  extra?: string | undefined;
  to: string;
}) {
  return (
    <Card className="grid content-between gap-3 p-4 sm:p-5">
      <div>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{text}</p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="flex items-baseline gap-2">
          <span
            className={count === 0 ? "text-3xl text-muted-foreground" : "text-3xl font-semibold"}
          >
            {count}
          </span>
          {extra !== undefined && <Badge tone="warning">{extra}</Badge>}
        </p>
        <Link to={to} className="text-sm text-primary underline-offset-4 hover:underline">
          {t.see}
        </Link>
      </div>
    </Card>
  );
}

export function SummaryPage() {
  const { workspaceSlug = "" } = useParams();
  const { canManage } = useSafety();
  const query = useQuery({
    queryKey: [...safetyKeys.all(workspaceSlug), "summary"],
    queryFn: () => peopleApi.summary(workspaceSlug),
    select: (data) => data.summary,
  });
  const base = `/app/${workspaceSlug}/seguridad`;
  const people = (alert: string) => `${base}/personas?aviso=${alert}`;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" asChild>
            <Link to={`${base}/medidas`}>{texts.safety.myActions.title}</Link>
          </Button>
          <ReportIncidentButton />
        </div>
      </div>
      <PpeTabs />
      {query.isError ? (
        <Card>
          <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
            {adminErrorText(query.error)}
          </EmptyState>
        </Card>
      ) : query.data === undefined ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            title={t.missingPpe.title}
            text={t.missingPpe.text}
            count={query.data.missingPpe}
            to={people("ppe")}
          />
          <SummaryCard
            title={t.replace.title}
            text={t.replace.text}
            count={query.data.replace}
            to={people("replace")}
          />
          <SummaryCard
            title={t.training.title}
            text={t.training.text}
            count={query.data.training + query.data.trainingSoon}
            extra={
              query.data.trainingSoon > 0 ? t.trainingSoon(query.data.trainingSoon) : undefined
            }
            to={people("training")}
          />
          {query.data.fitness !== null && (
            <SummaryCard
              title={t.fitness.title}
              text={t.fitness.text}
              count={query.data.fitness}
              to={people("fitness")}
            />
          )}
          {query.data.actions !== null && (
            <SummaryCard
              title={t.actions.title}
              text={t.actions.text}
              count={query.data.actions.open}
              extra={
                query.data.actions.overdue > 0 ? t.overdue(query.data.actions.overdue) : undefined
              }
              to={
                canManage
                  ? `${base}/planificacion${query.data.actions.overdue > 0 ? "?estado=overdue" : ""}`
                  : `${base}/incidentes?estado=open`
              }
            />
          )}
          {query.data.incidents !== null && (
            <SummaryCard
              title={t.incidents.title}
              text={t.incidents.text}
              count={query.data.incidents.open}
              extra={
                query.data.incidents.recent > 0 ? t.recent(query.data.incidents.recent) : undefined
              }
              to={`${base}/incidentes?estado=open`}
            />
          )}
        </div>
      )}
    </div>
  );
}
