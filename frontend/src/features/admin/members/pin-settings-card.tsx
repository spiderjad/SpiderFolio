// Ajustes del ingreso con usuario + PIN (CLAUDE.md, sección 7.6): activarlo, tiempo de
// inactividad y cierre después de confirmar una lectura. Solo con members.pin.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Tablet } from "lucide-react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Skeleton } from "@/components/ui/display";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { FormField, FormGrid, Switch } from "@/components/ui/form";
import { adminApi, adminKeys, type PinSettings } from "../api";
import { adminErrorText } from "../admin-utils";
import { idleChoices } from "../choices";
import { texts } from "@/i18n";

export function PinSettingsCard() {
  const t = texts.admin.pin.settings;
  const idleSource = useStaticSource("pin-idle", idleChoices);
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: adminKeys.pinSettings(workspaceSlug),
    queryFn: () => adminApi.pinSettings(workspaceSlug),
    select: (data) => data.settings,
  });
  const update = useMutation({
    mutationFn: (changes: Partial<PinSettings>) =>
      adminApi.updatePinSettings(workspaceSlug, changes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.pinSettings(workspaceSlug) });
      toast.success(texts.admin.common.saved);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  const entryUrl = `${window.location.origin}/entrar/${workspaceSlug}`;
  const data = settings.data;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Tablet className="size-5 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.subtitle}</p>
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="mt-5 h-20 w-full" />
      ) : (
        <div className="mt-5 grid gap-5">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">{t.enabled}</span>
              <span className="block text-xs text-muted-foreground">{t.enabledHint}</span>
            </span>
            <Switch
              aria-label={t.enabled}
              checked={data.enabled}
              disabled={update.isPending}
              onCheckedChange={(enabled) => {
                update.mutate({ enabled });
              }}
            />
          </label>
          <FormGrid columns={2}>
            <FormField label={t.idle} hint={t.idleHint}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  label={t.idle}
                  placeholder={t.idle}
                  searchable={false}
                  disabled={update.isPending}
                  source={idleSource}
                  value={String(data.idleMinutes)}
                  onChange={(option) => {
                    if (option !== null) update.mutate({ idleMinutes: Number(option.id) });
                  }}
                />
              )}
            </FormField>
            <label className="flex items-center justify-between gap-4 self-end">
              <span className="text-sm font-medium">{t.closeAfterConfirm}</span>
              <Switch
                aria-label={t.closeAfterConfirm}
                checked={data.closeAfterConfirm}
                disabled={update.isPending}
                onCheckedChange={(closeAfterConfirm) => {
                  update.mutate({ closeAfterConfirm });
                }}
              />
            </label>
          </FormGrid>
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">{t.address}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <code className="min-w-0 truncate text-sm">{entryUrl}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(entryUrl)
                    .then(() => {
                      toast.success(t.copied);
                    })
                    .catch(() => {
                      toast.error(texts.admin.pin.reveal.copyFailed);
                    });
                }}
              >
                <Copy strokeWidth={1.75} aria-hidden="true" />
                {t.copy}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
