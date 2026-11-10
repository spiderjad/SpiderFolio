// The maintenance module in Security › General (docs/spec/mantenimiento.md, «Activación»): on or off for
// the company. Only the owner (the server enforces it). Turning it off hides the module and pauses its
// notices; it never deletes anything.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench } from "lucide-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { Card, CardTitle, Skeleton } from "@/components/ui/display";
import { Switch } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { IntegrationTokens } from "./integration-tokens";
import { maintenanceApi, maintenanceKeys } from "./maintenance-api";
import { texts } from "@/i18n";

const t = texts.maintenance.admin;

export function MaintenanceAdminCard() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { reloadAccount } = useAuth();
  const settings = useQuery({
    queryKey: maintenanceKeys.settings(workspaceSlug),
    queryFn: () => maintenanceApi.settings(workspaceSlug),
    select: (data) => data.maintenance,
  });
  const save = useMutation({
    mutationFn: (enabled: boolean) => maintenanceApi.saveSettings(workspaceSlug, enabled),
    onSuccess: async (_result, enabled) => {
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.all(workspaceSlug) });
      await reloadAccount();
      toast.success(enabled ? t.enabled : t.disabled);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = settings.data;
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Wrench className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 break-words">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.description}</p>
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="mt-5 h-10 w-full max-w-sm" />
      ) : (
        <div className="mt-5 grid max-w-xl gap-4">
          <div className="flex items-start gap-3">
            <Switch
              aria-labelledby="maintenance-enabled-label"
              checked={data.enabled}
              disabled={save.isPending}
              onCheckedChange={(enabled) => {
                save.mutate(enabled);
              }}
            />
            <div>
              <p id="maintenance-enabled-label" className="text-sm font-medium">
                {t.enable}
              </p>
              <p className="text-xs text-muted-foreground">{t.enableHint}</p>
            </div>
          </div>
          {data.space !== null && (
            <p className="text-sm">
              {t.space}:{" "}
              <Link
                to={`/app/${workspaceSlug}/files/${data.space.id}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {data.space.name}
              </Link>
            </p>
          )}
          {data.enabled && <IntegrationTokens />}
        </div>
      )}
    </Card>
  );
}
