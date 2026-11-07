// The food quality module in Security › General (docs/spec/calidad.md, «Activación»): on or off for the
// company, the standards it's audited against and the days to the effectiveness check. Only the owner
// (the server enforces it). Turning it off hides the module and never deletes anything.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, Input, Switch } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { haccpApi, qualityApi, qualityKeys, type QualitySettingsView } from "./quality-api";
import { texts } from "@/i18n";

const t = texts.quality.admin;
const STANDARDS = ["IFS8", "BRCGS9"] as const;

function VerifyDays({
  current,
  pending,
  onSave,
}: {
  current: number;
  pending: boolean;
  onSave: (days: number) => void;
}) {
  const [days, setDays] = useState(String(current));
  const value = Number.parseInt(days, 10);
  const valid = Number.isInteger(value) && value >= 1 && value <= 365;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <FormField label={t.verifyDays} hint={t.verifyDaysHint}>
        {(control) => (
          <Input
            {...control}
            type="number"
            min={1}
            max={365}
            className="w-28"
            value={days}
            onChange={(event) => {
              setDays(event.target.value);
            }}
          />
        )}
      </FormField>
      <Button
        variant="outline"
        disabled={!valid || value === current || pending}
        onClick={() => {
          onSave(value);
        }}
      >
        {texts.admin.common.save}
      </Button>
    </div>
  );
}

export function QualityAdminCard() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { reloadAccount } = useAuth();
  const settings = useQuery({
    queryKey: qualityKeys.settings(workspaceSlug),
    queryFn: () => qualityApi.settings(workspaceSlug),
    select: (data) => data.quality,
  });
  const update = useMutation({
    mutationFn: (
      changes: Partial<Pick<QualitySettingsView, "enabled" | "standards" | "verifyDays">>,
    ) => qualityApi.saveSettings(workspaceSlug, changes),
    onSuccess: async (_result, changes) => {
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      // The Quality area comes with the session's company data.
      await reloadAccount();
      toast.success(
        changes.enabled === true ? t.enabled : changes.enabled === false ? t.disabled : t.saved,
      );
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const template = useMutation({
    mutationFn: () => haccpApi.template(workspaceSlug),
    onSuccess: async (result) => {
      toast.success(texts.quality.templateCard.loaded(result.forms, result.ccps));
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = settings.data;
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <BadgeCheck
          className="size-5 shrink-0 text-primary"
          strokeWidth={1.75}
          aria-hidden="true"
        />
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
              aria-labelledby="quality-enabled-label"
              checked={data.enabled}
              disabled={update.isPending}
              onCheckedChange={(enabled) => {
                update.mutate({ enabled });
              }}
            />
            <div className="min-w-0 break-words">
              <p id="quality-enabled-label" className="text-sm font-medium">
                {t.enable}
              </p>
              {data.enabled && data.space !== null && (
                <p className="text-xs text-muted-foreground">
                  <Link
                    to={`/app/${workspaceSlug}/files/${data.space.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {t.space(data.space.name)}
                  </Link>
                </p>
              )}
            </div>
          </div>
          {data.enabled && (
            <>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t.standards}</legend>
                {STANDARDS.map((standard) => (
                  <Checkbox
                    key={standard}
                    label={t.standardNames[standard]}
                    checked={data.standards.includes(standard)}
                    disabled={update.isPending}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...data.standards, standard]
                        : data.standards.filter((id) => id !== standard);
                      update.mutate({ standards: STANDARDS.filter((id) => next.includes(id)) });
                    }}
                  />
                ))}
              </fieldset>
              <VerifyDays
                key={data.verifyDays}
                current={data.verifyDays}
                pending={update.isPending}
                onSave={(verifyDays) => {
                  update.mutate({ verifyDays });
                }}
              />
              <div className="grid gap-2 rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{texts.quality.templateCard.title}</p>
                <p className="text-xs text-muted-foreground">
                  {texts.quality.templateCard.description}
                </p>
                <Button
                  variant="outline"
                  className="justify-self-start"
                  disabled={template.isPending}
                  onClick={() => {
                    template.mutate();
                  }}
                >
                  {texts.quality.templateCard.load}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
