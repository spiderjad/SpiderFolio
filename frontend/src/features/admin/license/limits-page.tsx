// Administración › Límites y uso: lo que usa la empresa y los límites que quiere fijar. Por defecto no
// hay ninguno (docs/spec/limites.md). Ver: «Ajustes de la empresa» o «Ver el almacenamiento»; cambiar:
// solo «Ajustes de la empresa» (lo hace cumplir el servidor).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, ServerCrash, SlidersHorizontal } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/data";
import { Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, Input } from "@/components/ui/form";
import { adminErrorText } from "@/features/admin/admin-utils";
import { useCan } from "@/features/admin/guards";
import { formatBytes } from "@/lib/utils";
import {
  licenseApi,
  licenseKeys,
  limitKeys,
  type LimitKey,
  type Limits,
  type LimitsOverview,
} from "./license-api";
import { locale, texts } from "@/i18n";

const t = texts.license.limits;

/** Las que se editan acá (el total de Bian también está en su pantalla). */
const editable: readonly LimitKey[] = limitKeys;

export function LimitsPage() {
  const { workspaceSlug = "" } = useParams();
  const overview = useQuery({
    queryKey: licenseKeys.limits(workspaceSlug),
    queryFn: () => licenseApi.limits(workspaceSlug),
  });
  const data = overview.data;
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-5xl grid-cols-1 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t.subtitle}</p>
      </div>
      {overview.isError ? (
        <Card>
          <EmptyState icon={ServerCrash} title={t.loadError}>
            {adminErrorText(overview.error)}
          </EmptyState>
        </Card>
      ) : data === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <UsageCard data={data} />
          <LimitsForm key={JSON.stringify(data.limits)} slug={workspaceSlug} limits={data.limits} />
        </>
      )}
    </div>
  );
}

function UsageCard({ data }: { data: LimitsOverview }) {
  const { usage, limits } = data;
  const count = (value: number) => value.toLocaleString(locale);
  return (
    <Card className="grid gap-4 p-5" aria-label={t.usageTitle}>
      <div className="flex items-center gap-2">
        <Gauge className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <h2 className="font-medium">{t.usageTitle}</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Meter
          label={t.storage}
          text={
            usage.storageMaxBytes === null
              ? `${formatBytes(usage.storageBytes)} · ${t.unlimited}`
              : t.of(formatBytes(usage.storageBytes), formatBytes(usage.storageMaxBytes))
          }
          value={usage.storageBytes}
          max={usage.storageMaxBytes}
        />
        <Meter
          label={t.members}
          text={t.membersValue(count(usage.members.FULL), count(usage.members.READER))}
          value={0}
          max={null}
        />
        <Meter
          label={t.aiThisMonth}
          text={
            limits.aiQueriesPerMonth === null
              ? `${count(usage.aiQueriesThisMonth)} · ${t.unlimited}`
              : t.of(count(usage.aiQueriesThisMonth), count(limits.aiQueriesPerMonth))
          }
          value={usage.aiQueriesThisMonth}
          max={limits.aiQueriesPerMonth}
        />
      </div>
    </Card>
  );
}

function Meter({
  label,
  text,
  value,
  max,
}: {
  label: string;
  text: string;
  value: number;
  max: number | null;
}) {
  const ratio = max === null || max === 0 ? 0 : value / max;
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-sm tabular-nums text-muted-foreground">{text}</p>
      {max !== null && (
        <ProgressBar
          value={value}
          max={max}
          label={label}
          tone={ratio >= 1 ? "danger" : ratio >= 0.8 ? "warning" : "primary"}
          className="mt-2"
        />
      )}
    </div>
  );
}

function LimitsForm({ slug, limits }: { slug: string; limits: Limits }) {
  const canEdit = useCan("workspace.settings");
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<LimitKey, string>>(
    () =>
      Object.fromEntries(
        limitKeys.map((key) => [key, limits[key] === null ? "" : String(limits[key])]),
      ) as Record<LimitKey, string>,
  );
  const save = useMutation({
    mutationFn: (changes: Partial<Limits>) => licenseApi.updateLimits(slug, changes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: licenseKeys.limits(slug) });
      toast.success(t.saved);
    },
    onError: (error) => toast.error(adminErrorText(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const changes = Object.fromEntries(
      editable.map((key) => {
        const raw = values[key].trim();
        return [key, raw === "" ? null : Math.max(0, Math.trunc(Number(raw)))];
      }),
    ) as Partial<Limits>;
    save.mutate(changes);
  };
  return (
    <Card className="p-5">
      <form className="grid gap-4" onSubmit={submit}>
        <div className="flex items-center gap-2">
          <SlidersHorizontal
            className="size-4 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <h2 className="font-medium">{t.limitsTitle}</h2>
        </div>
        {!canEdit && <p className="text-xs text-muted-foreground">{t.readOnly}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {editable.map((key) => {
            const field = t.fields[key];
            const unlimited = values[key] === "";
            return (
              <FormField key={key} label={`${field.label} (${field.unit})`} hint={field.hint}>
                {(control) => (
                  <div className="flex items-center gap-3">
                    <Input
                      {...control}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={values[key]}
                      placeholder={t.noLimit}
                      disabled={!canEdit}
                      className="max-w-40"
                      onChange={(event) => {
                        setValues((current) => ({ ...current, [key]: event.target.value }));
                      }}
                    />
                    <Checkbox
                      label={t.noLimit}
                      checked={unlimited}
                      disabled={!canEdit}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setValues((current) => ({
                          ...current,
                          [key]: checked ? "" : String(limits[key] ?? ""),
                        }));
                      }}
                    />
                  </div>
                )}
              </FormField>
            );
          })}
        </div>
        {canEdit && (
          <div>
            <Button type="submit" disabled={save.isPending}>
              {t.save}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
