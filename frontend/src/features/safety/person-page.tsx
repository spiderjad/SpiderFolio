// /app/:slug/seguridad/personas/:membershipId — a person's PPE (docs/spec/seguridad-salud.md, «EPIs»):
// what they have with its replacement day, what their position requires and they lack («Le falta») and
// their handouts. The seed of their sheet: training and fitness come in later phases.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, ServerCrash } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatDateTime, formatDay } from "@/lib/utils";
import { safetyApi, safetyKeys } from "./safety-api";
import { PpeStateBadge, ReportIncidentButton, useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.person;

export function PersonPage() {
  const { workspaceSlug = "", membershipId = "" } = useParams();
  const navigate = useNavigate();
  const safety = useSafety();
  const ppe = useQuery({
    queryKey: safetyKeys.person(workspaceSlug, membershipId),
    queryFn: () => safetyApi.person(workspaceSlug, membershipId),
  });
  const history = useQuery({
    queryKey: safetyKeys.deliveries(workspaceSlug, { person: membershipId }),
    queryFn: ({ signal }) =>
      safetyApi.deliveries(workspaceSlug, { person: membershipId }, undefined, signal),
  });
  const base = `/app/${workspaceSlug}/seguridad`;

  if (ppe.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
          {adminErrorText(ppe.error)}
        </EmptyState>
      </Card>
    );
  }
  const data = ppe.data;
  if (data === undefined) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.person.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.person.position === null ? t.noPosition : t.position(data.person.position.name)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" asChild>
            <Link to={`${base}/medidas`}>{texts.safety.myActions.title}</Link>
          </Button>
          <ReportIncidentButton />
          {data.canDeliver && (
            <Button
              onClick={() => {
                void navigate(`${base}/epis/nueva?persona=${data.person.id}`);
              }}
            >
              <Plus strokeWidth={1.75} aria-hidden="true" />
              {t.deliver}
            </Button>
          )}
        </div>
      </div>

      {data.person.position !== null && (
        <Card className="p-4 sm:p-5">
          <CardTitle className="flex items-center gap-2 text-base">
            {data.missing.length > 0 && (
              <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
            )}
            {t.missing}
          </CardTitle>
          {data.missing.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t.noneMissing}</p>
          ) : (
            <ul className="mt-2 grid gap-1 text-sm">
              {data.missing.map((item) => (
                <li key={item.id}>
                  {item.name}
                  {item.expired && (
                    <span className="text-muted-foreground"> · {t.missingExpired}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="p-4 sm:p-5">
        <CardTitle className="text-base">{t.current(safety.terms.ppes)}</CardTitle>
        {data.current.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t.noCurrent}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {data.current.map((ppeItem) => (
              <li
                key={ppeItem.item.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {ppeItem.item.name}
                    {ppeItem.size !== null && (
                      <span className="text-muted-foreground">
                        {" · "}
                        {texts.safety.newDelivery.size} {ppeItem.size}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <Link
                      to={`${base}/epis/${ppeItem.deliveryId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {t.deliveredAt(formatDateTime(ppeItem.deliveredAt))}
                    </Link>
                    {" · "}
                    {ppeItem.replaceOn === null
                      ? t.noReplace
                      : t.replaceOn(formatDay(ppeItem.replaceOn))}
                  </p>
                </div>
                {ppeItem.replaceOn !== null && <PpeStateBadge state={ppeItem.state} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <CardTitle className="text-base">{t.history}</CardTitle>
        {history.data === undefined ? (
          <Skeleton className="mt-3 h-16 w-full" />
        ) : history.data.items.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t.noCurrent}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {history.data.items.map((delivery) => (
              <li key={delivery.id} className="py-2.5">
                <Link
                  to={`${base}/epis/${delivery.id}`}
                  className={
                    delivery.voided === null
                      ? "font-medium underline-offset-4 hover:underline"
                      : "text-muted-foreground line-through"
                  }
                >
                  {formatDateTime(delivery.deliveredAt)}
                </Link>
                <span className="text-muted-foreground">
                  {" · "}
                  {delivery.lines.map((line) => line.item.name).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
