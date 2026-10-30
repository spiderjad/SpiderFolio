// Resumen: interruptores de Bian, consultas del mes con su renovación, límites por persona y «Cómo
// funciona Bian».
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Info, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ProgressBar } from "@/components/ui/data";
import { Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Input, Switch } from "@/components/ui/form";
import { adminErrorText, loadErrorIcon, loadErrorText } from "@/features/admin/admin-utils";
import { useDepartmentSource, useMemberSource } from "@/features/admin/sources";
import {
  bianApi,
  bianKeys,
  type BianOverview,
  type LimitMode,
  type LimitView,
} from "@/features/bian/bian-api";
import { formatUtcLongDate } from "@/lib/utils";
import { texts } from "@/i18n";

const select =
  "h-9 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** Modo y número de un límite; el botón entrega lo elegido. */
function LimitEditor({
  modes,
  initial,
  disabled,
  submitLabel,
  onSubmit,
}: {
  modes: readonly LimitMode[];
  initial?: LimitView | null;
  disabled?: boolean;
  submitLabel: string;
  onSubmit: (value: { mode: LimitMode; limit?: number }) => void;
}) {
  const t = texts.bian.admin.limits;
  const [mode, setMode] = useState<LimitMode>(initial?.mode ?? modes[0] ?? "LIMIT");
  const [limit, setLimit] = useState(String(initial?.limit ?? 10));
  const parsed = Number(limit);
  const valid = mode !== "LIMIT" || (Number.isInteger(parsed) && parsed >= 0);
  const labels: Record<LimitMode, string> = {
    LIMIT: t.modeLimit,
    UNLIMITED: t.modeUnlimited,
    BLOCKED: t.modeBlocked,
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <select
        aria-label={t.save}
        value={mode}
        className={select}
        onChange={(event) => {
          const next = modes.find((candidate) => candidate === event.target.value);
          if (next !== undefined) setMode(next);
        }}
      >
        {modes.map((candidate) => (
          <option key={candidate} value={candidate}>
            {labels[candidate]}
          </option>
        ))}
      </select>
      {mode === "LIMIT" && (
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t.number}
          <Input
            type="number"
            min={0}
            max={1000000}
            value={limit}
            className="h-9 w-28"
            onChange={(event) => {
              setLimit(event.target.value);
            }}
          />
        </label>
      )}
      <Button
        disabled={disabled === true || !valid}
        onClick={() => {
          onSubmit(mode === "LIMIT" ? { mode, limit: parsed } : { mode });
        }}
      >
        {submitLabel}
      </Button>
    </div>
  );
}

function useOverviewMutations(slug: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: bianKeys.overview(slug) });
  const onError = (error: unknown) => {
    toast.error(adminErrorText(error));
  };
  const settings = useMutation({
    mutationFn: (changes: { enabled?: boolean; guests?: boolean }) =>
      bianApi.updateSettings(slug, changes),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: bianKeys.usage(slug) });
      toast.success(texts.bian.admin.limits.saved);
    },
    onError,
  });
  const setLimit = useMutation({
    mutationFn: (body: Parameters<typeof bianApi.setLimit>[1]) => bianApi.setLimit(slug, body),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: bianKeys.usageTable(slug) });
      toast.success(texts.bian.admin.limits.saved);
    },
    onError,
  });
  const removeLimit = useMutation({
    mutationFn: (id: string) => bianApi.removeLimit(slug, id),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: bianKeys.usageTable(slug) });
      toast.success(texts.bian.admin.limits.removed);
    },
    onError,
  });
  const setTotal = useMutation({
    mutationFn: (total: number | null) => bianApi.setTotal(slug, total),
    onSuccess: async () => {
      await refresh();
      toast.success(texts.bian.admin.month.totalSaved);
    },
    onError,
  });
  return { settings, setLimit, removeLimit, setTotal };
}

function SettingsCard({ data, slug }: { data: BianOverview; slug: string }) {
  const t = texts.bian.admin.settings;
  const { settings } = useOverviewMutations(slug);
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Sparkles className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 break-words">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.text}</p>
        </div>
      </div>
      <div className="mt-5 grid max-w-xl gap-4">
        <div className="flex items-start gap-3">
          <Switch
            id="bian-enabled"
            aria-labelledby="bian-enabled-label"
            checked={data.settings.enabled}
            disabled={settings.isPending}
            onCheckedChange={(enabled) => {
              settings.mutate({ enabled });
            }}
          />
          <div className="min-w-0 break-words">
            <p id="bian-enabled-label" className="text-sm font-medium">
              {t.enabled}
            </p>
            <p className="text-xs text-muted-foreground">{t.enabledHint}</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Switch
            id="bian-guests"
            aria-labelledby="bian-guests-label"
            checked={data.settings.guests}
            disabled={settings.isPending || !data.settings.enabled}
            onCheckedChange={(guests) => {
              settings.mutate({ guests });
            }}
          />
          <div className="min-w-0 break-words">
            <p id="bian-guests-label" className="text-sm font-medium">
              {t.guests}
            </p>
            <p className="text-xs text-muted-foreground">{t.guestsHint}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function MonthCard({ data, slug }: { data: BianOverview; slug: string }) {
  const t = texts.bian.admin.month;
  const { used, total, renewsAt } = data.usage;
  const { setTotal } = useOverviewMutations(slug);
  const [draft, setDraft] = useState(total === null ? "" : String(total));
  const ratio = total === null ? 0 : used / Math.max(1, total);
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Gauge className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <CardTitle className="text-base">{t.title}</CardTitle>
      </div>
      <p className="mt-4 text-3xl font-semibold tabular-nums">
        {total === null ? t.unlimited(used) : t.of(used, total)}
      </p>
      {total !== null && (
        <ProgressBar
          value={used}
          max={Math.max(1, total)}
          label={t.barLabel}
          tone={ratio >= 0.95 ? "danger" : ratio >= 0.8 ? "warning" : "primary"}
          className="mt-3"
        />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {t.renews(formatUtcLongDate(renewsAt))}
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const raw = draft.trim();
          setTotal.mutate(raw === "" ? null : Math.max(0, Math.trunc(Number(raw))));
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t.totalLabel}</span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={draft}
            placeholder={t.totalPlaceholder}
            className="max-w-40"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <span className="text-xs text-muted-foreground">{t.totalHint}</span>
        </label>
        <Button type="submit" variant="outline" disabled={setTotal.isPending}>
          {t.saveTotal}
        </Button>
      </form>
    </Card>
  );
}

function LimitsCard({ data, slug }: { data: BianOverview; slug: string }) {
  const t = texts.bian.admin.limits;
  const { setLimit, removeLimit } = useOverviewMutations(slug);
  const departmentSource = useDepartmentSource(slug);
  const personSource = useMemberSource(slug);
  const [department, setDepartment] = useState<{ id: string; label: string } | null>(null);
  const [person, setPerson] = useState<{ id: string; label: string } | null>(null);
  const busy = setLimit.isPending || removeLimit.isPending;
  const row = (label: string, view: LimitView) => (
    <li key={view.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <span className="text-muted-foreground">{t.value(view.mode, view.limit)}</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          removeLimit.mutate(view.id);
        }}
      >
        {t.remove}
      </Button>
    </li>
  );
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Users className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0 break-words">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.text}</p>
        </div>
      </div>

      <section className="mt-5 grid gap-2" aria-label={t.general}>
        <h3 className="text-sm font-semibold">{t.general}</h3>
        <p className="text-xs text-muted-foreground">{t.generalHint}</p>
        <LimitEditor
          key={`${data.limits.general?.id ?? "none"}:${String(data.limits.general?.limit ?? "")}`}
          modes={["LIMIT", "UNLIMITED"]}
          initial={data.limits.general}
          disabled={busy}
          submitLabel={t.save}
          onSubmit={(value) => {
            setLimit.mutate({ scope: "GENERAL", ...value });
          }}
        />
      </section>

      <section className="mt-6 grid gap-2" aria-label={t.departments}>
        <h3 className="text-sm font-semibold">{t.departments}</h3>
        <p className="text-xs text-muted-foreground">{t.departmentsHint}</p>
        {data.limits.departments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.none}</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-border p-0">
            {data.limits.departments.map((item) => row(item.department.name, item))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-48">
            <Combobox
              label={t.pickDepartment}
              placeholder={t.pickDepartment}
              source={departmentSource}
              value={department?.id ?? null}
              valueLabel={department?.label}
              onChange={(option) => {
                setDepartment(option === null ? null : { id: option.id, label: option.label });
              }}
            />
          </div>
          {department !== null && (
            <LimitEditor
              key={department.id}
              modes={["LIMIT", "UNLIMITED"]}
              disabled={busy}
              submitLabel={t.add}
              onSubmit={(value) => {
                setLimit.mutate({ scope: "DEPARTMENT", subjectId: department.id, ...value });
                setDepartment(null);
              }}
            />
          )}
        </div>
      </section>

      <section className="mt-6 grid gap-2" aria-label={t.people}>
        <h3 className="text-sm font-semibold">{t.people}</h3>
        {data.limits.people.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.none}</p>
        ) : (
          <ul className="m-0 list-none divide-y divide-border p-0">
            {data.limits.people.map((item) => row(item.person.name, item))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-48">
            <Combobox
              label={t.pickPerson}
              placeholder={t.pickPerson}
              source={personSource}
              value={person?.id ?? null}
              valueLabel={person?.label}
              onChange={(option) => {
                setPerson(option === null ? null : { id: option.id, label: option.label });
              }}
            />
          </div>
          {person !== null && (
            <LimitEditor
              key={person.id}
              modes={["LIMIT", "UNLIMITED", "BLOCKED"]}
              disabled={busy}
              submitLabel={t.add}
              onSubmit={(value) => {
                setLimit.mutate({ scope: "PERSON", subjectId: person.id, ...value });
                setPerson(null);
              }}
            />
          )}
        </div>
      </section>
    </Card>
  );
}

/** Cómo funciona Bian: el proveedor, qué se envía y qué cuenta como una consulta. */
function HowCard() {
  const t = texts.bian.admin.how;
  const link = "text-primary hover:underline focus-visible:outline-none focus-visible:underline";
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Info className="size-5 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
        <CardTitle className="text-base">{t.title}</CardTitle>
      </div>
      <div className="mt-4 grid max-w-2xl gap-4 text-sm">
        <p>{t.provider}</p>
        <div>
          <h3 className="font-semibold">{t.sentTitle}</h3>
          <p className="text-muted-foreground">{t.sent}</p>
        </div>
        <div>
          <h3 className="font-semibold">{t.countsTitle}</h3>
          <p className="text-muted-foreground">{t.counts}</p>
        </div>
        <ul className="m-0 grid list-none gap-1 p-0">
          <li>
            <a href={t.termsUrl} target="_blank" rel="noopener noreferrer" className={link}>
              {t.terms}
            </a>
          </li>
          <li>
            <a href={t.privacyUrl} target="_blank" rel="noopener noreferrer" className={link}>
              {t.privacy}
            </a>
          </li>
        </ul>
      </div>
    </Card>
  );
}

export function OverviewTab() {
  const { workspaceSlug = "" } = useParams();
  const overview = useQuery({
    queryKey: bianKeys.overview(workspaceSlug),
    queryFn: () => bianApi.overview(workspaceSlug),
  });
  if (overview.isError) {
    return (
      <Card>
        <EmptyState icon={loadErrorIcon(overview.error)} title={texts.bian.admin.usage.error}>
          {loadErrorText(overview.error)}
        </EmptyState>
      </Card>
    );
  }
  if (overview.data === undefined) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <SettingsCard data={overview.data} slug={workspaceSlug} />
      <MonthCard key={String(overview.data.usage.total)} data={overview.data} slug={workspaceSlug} />
      <LimitsCard data={overview.data} slug={workspaceSlug} />
      <HowCard />
    </div>
  );
}
