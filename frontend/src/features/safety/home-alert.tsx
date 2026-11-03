// On Home (docs/spec/seguridad-salud.md): for whoever doesn't manage the module, a notice when their
// position requires PPE they lack or they have training pending.
import { useQuery } from "@tanstack/react-query";
import { HardHat } from "lucide-react";
import { Link } from "react-router";
import { Card } from "@/components/ui/display";
import { useMembership } from "@/features/home/workspace-layout";
import { peopleApi } from "./safety-api";
import { texts } from "@/i18n";

export function SafetyHomeAlert({ slug }: { slug: string }) {
  const membership = useMembership();
  const manages =
    membership.capabilities.includes("safety.manage") ||
    membership.capabilities.includes("safety.health");
  const enabled =
    membership.workspace.safety.enabled && !manages && membership.role.base !== "GUEST";
  const query = useQuery({
    queryKey: ["w", slug, "safety", "my-alerts"],
    queryFn: () => peopleApi.myAlerts(slug),
    select: (data) => data.alerts,
    enabled,
  });
  const alerts = query.data;
  if (!enabled || alerts == null || (alerts.missingPpe === 0 && alerts.training === 0)) return null;
  const t = texts.safety.people;
  return (
    <Card className="flex flex-wrap items-center gap-3 border-warning-soft-foreground/30 bg-warning-soft/40 p-4">
      <HardHat className="size-5 shrink-0 text-warning-soft-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t.homeTitle}</p>
        <p className="text-sm text-muted-foreground">
          {t.homeText}{" "}
          {[
            alerts.missingPpe > 0 ? t.missingPpe(alerts.missingPpe) : null,
            alerts.training > 0 ? t.training(alerts.training) : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
      </div>
      <Link
        to={`/app/${slug}/seguridad/personas/${membership.id}`}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t.homeOpen}
      </Link>
    </Card>
  );
}
