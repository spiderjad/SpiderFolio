// /app/:slug/pendientes — «Mis pendientes» (docs/spec/diseno.md 10.4.1): everything the person has to
// do, from every area, in one place: readings and approvals, today's forms, their expiries, their
// Prevention measures, PPE and training. Each block comes from what the app already had and hides when
// there's nothing in it.
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, HeartHandshake, ListChecks } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/display";
import { ExpiriesHomeCard } from "@/features/expiries/home-card";
import { PendingFormsCard } from "@/features/forms/pending-forms";
import { incidentsApi, incidentsKeys } from "@/features/safety/safety-api";
import { SafetyHomeAlert } from "@/features/safety/home-alert";
import { qualityApi, qualityKeys } from "@/features/quality/quality-api";
import { cultureApi, cultureKeys } from "@/features/quality/culture-api";
import { formatUtcDate } from "@/lib/utils";
import { PendingCard } from "./dashboard-page";
import { useHome } from "./home-api";
import { useMembership } from "./workspace-layout";
import { texts } from "@/i18n";

const SHOWN = 5;

/** The Prevention measures assigned to the person, not done yet. */
function MyActionsCard({ slug }: { slug: string }) {
  const membership = useMembership();
  const enabled = membership.workspace.safety.enabled && membership.role.base !== "GUEST";
  const query = useQuery({
    queryKey: incidentsKeys.mine(slug),
    queryFn: () => incidentsApi.mine(slug),
    select: (data) => data.items.filter((action) => action.done === null),
    enabled,
  });
  const items = query.data ?? [];
  if (!enabled || items.length === 0) return null;
  const t = texts.safety.myActions;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <ListChecks className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">{t.title}</h2>
      </div>
      <ul className="-my-2 divide-y divide-border">
        {items.slice(0, SHOWN).map((action) => (
          <li key={action.id} className="flex min-h-14 items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{action.description}</p>
              <p className="text-xs text-muted-foreground">{formatUtcDate(action.dueOn)}</p>
            </div>
            {action.overdue && <Badge tone="danger">{texts.safety.planning.overdue}</Badge>}
          </li>
        ))}
      </ul>
      <Button asChild size="sm" variant="outline" className="justify-self-start">
        <Link to={`/app/${slug}/seguridad/medidas`}>{texts.shell.areas.myActions}</Link>
      </Button>
    </Card>
  );
}

/** The quality actions assigned to the person, not done yet (docs/spec/calidad.md). */
function MyQualityActionsCard({ slug }: { slug: string }) {
  const membership = useMembership();
  const enabled = membership.workspace.quality.enabled && membership.role.base !== "GUEST";
  const filters = { status: "open" as const, mine: "1" as const };
  const query = useQuery({
    queryKey: qualityKeys.actions(slug, filters),
    queryFn: ({ signal }) => qualityApi.actions(slug, filters, undefined, signal),
    select: (data) => data.items,
    enabled,
  });
  const items = query.data ?? [];
  if (!enabled || items.length === 0) return null;
  const t = texts.quality;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <BadgeCheck className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">{t.pending.title}</h2>
      </div>
      <ul className="-my-2 divide-y divide-border">
        {items.slice(0, SHOWN).map((action) => (
          <li key={action.id} className="flex min-h-14 items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{action.description}</p>
              <p className="text-xs text-muted-foreground">
                {action.nc.code} · {formatUtcDate(action.dueOn)}
              </p>
            </div>
            {action.overdue && <Badge tone="danger">{t.detail.actions.overdue}</Badge>}
          </li>
        ))}
      </ul>
      <Button asChild size="sm" variant="outline" className="justify-self-start">
        <Link to={`/app/${slug}/calidad/mis-acciones`}>{t.pending.all}</Link>
      </Button>
    </Card>
  );
}

/** The open food safety culture surveys the person hasn't answered (docs/spec/calidad.md, «Fase 6c»). */
function PendingSurveysCard({ slug }: { slug: string }) {
  const membership = useMembership();
  const enabled = membership.workspace.quality.enabled && membership.role.base !== "GUEST";
  const query = useQuery({
    queryKey: cultureKeys.pending(slug),
    queryFn: () => cultureApi.pending(slug),
    select: (data) => data.items,
    enabled,
  });
  const items = query.data ?? [];
  if (!enabled || items.length === 0) return null;
  const t = texts.quality.culture.pending;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <HeartHandshake className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">{t.title}</h2>
      </div>
      <ul className="-my-2 divide-y divide-border">
        {items.slice(0, SHOWN).map((survey) => (
          <li key={survey.id} className="flex min-h-14 items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{survey.title}</p>
              <p className="text-xs text-muted-foreground">
                {t.questions(survey.questions)} · {t.closes(formatUtcDate(survey.closesOn))}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to={`/app/${slug}/calidad/encuestas/${survey.id}`}>{t.answer}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PendingPage() {
  const { workspaceSlug = "" } = useParams();
  const overview = useHome(workspaceSlug);
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{texts.shell.areas.pending}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{texts.shell.areas.pendingHint}</p>
      </div>
      <PendingCard home={overview.data} slug={workspaceSlug} loading={overview.isPending} />
      <PendingFormsCard slug={workspaceSlug} />
      <ExpiriesHomeCard slug={workspaceSlug} />
      <MyActionsCard slug={workspaceSlug} />
      <PendingSurveysCard slug={workspaceSlug} />
      <MyQualityActionsCard slug={workspaceSlug} />
      <SafetyHomeAlert slug={workspaceSlug} />
    </div>
  );
}
