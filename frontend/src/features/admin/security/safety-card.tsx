// The occupational health and safety module in Security › General (docs/spec/seguridad-salud.md):
// on or off for the company, its country's terms and, when turning it on, the food sector's examples.
// Only the owner (the server enforces it). Turning it off hides the module and never deletes anything.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Card, CardTitle, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, Switch } from "@/components/ui/form";
import { adminApi, adminKeys, type SafetyTerms } from "../api";
import { adminErrorText } from "../admin-utils";
import { texts } from "@/i18n";

const TERMS: readonly SafetyTerms[] = ["es", "latam"];

export function SafetyCard() {
  const t = texts.admin.security.safety;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { reloadAccount } = useAuth();
  const termsSource = useStaticSource(
    "safety-terms",
    TERMS.map((id) => ({ id, label: t.termsOptions[id] })),
  );
  const [examples, setExamples] = useState(true);
  const settings = useQuery({
    queryKey: adminKeys.safety(workspaceSlug),
    queryFn: () => adminApi.safety(workspaceSlug),
    select: (data) => data.safety,
  });
  const update = useMutation({
    mutationFn: (changes: { enabled?: boolean; terms?: SafetyTerms; examples?: boolean }) =>
      adminApi.updateSafety(workspaceSlug, changes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      // The menu and the module's terms come with the session's company data.
      await reloadAccount();
      toast.success(texts.admin.common.saved);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = settings.data;

  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <HardHat className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 break-words">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.text}</p>
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="mt-5 h-10 w-full max-w-sm" />
      ) : (
        <div className="mt-5 grid max-w-xl gap-4">
          <div className="flex items-start gap-3">
            <Switch
              id="safety-enabled"
              aria-labelledby="safety-enabled-label"
              checked={data.enabled}
              disabled={update.isPending}
              onCheckedChange={(enabled) => {
                update.mutate(enabled ? { enabled, examples } : { enabled });
              }}
            />
            <div className="min-w-0 break-words">
              <p id="safety-enabled-label" className="text-sm font-medium">
                {t.enable}
              </p>
              <p className="text-xs text-muted-foreground">
                {data.enabled ? t.enabledHint : t.enableHint}
              </p>
            </div>
          </div>
          {!data.enabled && (
            <div>
              <Checkbox
                label={t.examples}
                aria-describedby="safety-examples-hint"
                checked={examples}
                disabled={update.isPending}
                onChange={(event) => {
                  setExamples(event.target.checked);
                }}
              />
              <p id="safety-examples-hint" className="ml-6 mt-1 text-xs text-muted-foreground">
                {t.examplesHint}
              </p>
            </div>
          )}
          <div className="max-w-sm">
            <FormField label={t.terms} hint={t.termsHint}>
              {(control) => (
                <Combobox
                  id={control.id}
                  aria-describedby={control["aria-describedby"]}
                  label={t.terms}
                  placeholder={t.terms}
                  searchable={false}
                  disabled={update.isPending}
                  source={termsSource}
                  value={data.terms}
                  onChange={(option) => {
                    const terms = TERMS.find((id) => id === option?.id);
                    if (terms !== undefined && terms !== data.terms) update.mutate({ terms });
                  }}
                />
              )}
            </FormField>
          </div>
          {data.enabled && data.space !== null && (
            <p className="text-xs text-muted-foreground">
              {t.space}{" "}
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                to={`/app/${workspaceSlug}/files/${data.space.id}`}
              >
                {data.space.name}
              </Link>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
