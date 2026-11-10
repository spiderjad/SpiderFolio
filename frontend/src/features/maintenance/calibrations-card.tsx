// Quality's calibration prerequisite reads Maintenance's calibration plans (docs/spec/mantenimiento.md,
// decision 5): the measuring instruments, their state and their open work order, without copying them.
// Shown on Quality › Prerequisites while the Maintenance module is on.
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Card, CardTitle, Skeleton } from "@/components/ui/display";
import { maintenanceApi, maintenanceKeys } from "./maintenance-api";
import { useMaintenance } from "./maintenance-common";
import { frequencyOf, nextOf, PlanStateBadge } from "./plans-page";
import { texts } from "@/i18n";

const t = texts.maintenance.calibrations;

export function MaintenanceCalibrationsCard() {
  const { workspaceSlug = "" } = useParams();
  const { enabled } = useMaintenance();
  const plans = useQuery({
    queryKey: maintenanceKeys.calibrations(workspaceSlug),
    queryFn: () => maintenanceApi.calibrations(workspaceSlug),
    select: (data) => data.plans,
    enabled,
    retry: false,
  });
  if (!enabled || plans.isError) return null;
  return (
    <Card className="grid gap-2 p-4 sm:p-5">
      <CardTitle>{t.title}</CardTitle>
      <p className="-mt-1 text-xs text-muted-foreground">{t.hint}</p>
      {plans.isPending ? (
        <Skeleton className="h-16" />
      ) : plans.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {plans.data.map((plan) => (
            <li key={plan.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{plan.name}</span>
                  <PlanStateBadge state={plan.state} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    plan.asset === null ? null : `${plan.asset.code} · ${plan.asset.name}`,
                    frequencyOf(plan),
                    nextOf(plan),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {plan.openWorkOrder !== null && (
                <Link
                  to={`/app/${workspaceSlug}/mantenimiento/ot/${plan.openWorkOrder.id}`}
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {plan.openWorkOrder.code}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
