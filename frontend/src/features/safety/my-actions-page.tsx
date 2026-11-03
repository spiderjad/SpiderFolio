// /app/:slug/seguridad/medidas — the corrective measures assigned to the person
// (docs/spec/seguridad-salud.md): only the measure and its date, never the incident's details.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ListChecks } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/display";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatDateTime, formatUtcDate } from "@/lib/utils";
import { incidentsApi, incidentsKeys } from "./safety-api";
import { useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety;

export function MyActionsPage() {
  const { workspaceSlug = "" } = useParams();
  const { canManage, health, membershipId } = useSafety();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: incidentsKeys.mine(workspaceSlug),
    queryFn: () => incidentsApi.mine(workspaceSlug),
    select: (data) => data.items,
  });
  const done = useMutation({
    mutationFn: (id: string) => incidentsApi.done(workspaceSlug, id),
    onSuccess: async () => {
      toast.success(t.incidents.toasts.done);
      await queryClient.invalidateQueries({ queryKey: incidentsKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4">
      <Link
        to={
          canManage || health
            ? `/app/${workspaceSlug}/seguridad/resumen`
            : `/app/${workspaceSlug}/seguridad/personas/${membershipId}`
        }
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {texts.safety.back}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.myActions.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">{t.myActions.subtitle}</p>
      </div>
      {query.data === undefined ? (
        <Skeleton className="h-32 w-full" />
      ) : query.data.length === 0 ? (
        <Card>
          <EmptyState icon={ListChecks} title={t.myActions.empty}>
            {null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {query.data.map((action) => (
              <li
                key={action.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0">
                  <p
                    className={
                      action.done === null ? "font-medium" : "text-muted-foreground line-through"
                    }
                  >
                    {action.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.incidents.due(formatUtcDate(action.dueOn))}
                    {action.done !== null &&
                      ` · ${t.incidents.doneBy(action.done.by?.name ?? "", formatDateTime(action.done.at))}`}
                  </p>
                </div>
                {action.done === null && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={done.isPending}
                    onClick={() => {
                      done.mutate(action.id);
                    }}
                  >
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    {t.incidents.markDone}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
