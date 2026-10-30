// How a form runs (docs/spec/formularios.md, phase 3): who's in charge (told about non-conformities and
// periods left without a record, and sees every record) and, for periodic forms, how often and who
// fills it in. Whoever can edit the form changes it here; the rest read a summary. The server checks
// every person and department again.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  COMBO_PAGE_SIZE,
  Combobox,
  useStaticSource,
  type ComboboxSource,
} from "@/components/ui/combobox";
import { Card } from "@/components/ui/display";
import { FormField as LabeledField } from "@/components/ui/form";
import { adminApi } from "@/features/admin/api";
import { adminErrorText } from "@/features/admin/admin-utils";
import { filesApi } from "@/features/files/api";
import { cn } from "@/lib/utils";
import {
  formsApi,
  formsKeys,
  type FormDetail,
  type FormSettingsInput,
  type FormSettingsView,
  type Frequency,
} from "./forms-api";
import { texts } from "@/i18n";

const t = texts.forms.settings;

type ResponsibleType = FormSettingsView["responsible"]["type"];

interface Draft {
  responsibleType: ResponsibleType;
  responsible: { id: string; label: string } | null;
  frequency: Frequency;
  weekdays: number[];
  people: Map<string, string>;
  departments: Map<string, string>;
}

function draftOf(settings: FormSettingsView): Draft {
  const { responsible } = settings;
  return {
    responsibleType: responsible.type,
    responsible:
      responsible.type === "default" ? null : { id: responsible.id, label: responsible.name },
    frequency: settings.frequency,
    weekdays: settings.frequency === "daily" ? settings.weekdays : [1, 2, 3, 4, 5],
    people: new Map(settings.assignees.people.map((p) => [p.id, p.name])),
    departments: new Map(settings.assignees.departments.map((d) => [d.id, d.name])),
  };
}

function inputOf(draft: Draft): FormSettingsInput {
  return {
    responsible:
      draft.responsibleType === "default" || draft.responsible === null
        ? { type: "default" }
        : { type: draft.responsibleType, id: draft.responsible.id },
    frequency: draft.frequency,
    weekdays: draft.frequency === "daily" ? draft.weekdays : [],
    assignees:
      draft.frequency === "none"
        ? { people: [], departments: [] }
        : { people: [...draft.people.keys()], departments: [...draft.departments.keys()] },
  };
}

/** One line on how the form runs, for whoever can't change it. */
function summaryOf(settings: FormSettingsView): string[] {
  const { responsible } = settings;
  const lines = [
    responsible.type === "default"
      ? responsible.people.length > 0
        ? t.responsibleDefaultIs(responsible.people.map((p) => p.name).join(", "))
        : t.responsibleDefaultNone
      : `${t.responsible}: ${responsible.name}.`,
  ];
  if (settings.frequency === "none") lines.push(t.summaryNone);
  else {
    lines.push(
      settings.frequency === "daily"
        ? t.summaryDaily(settings.weekdays.map((d) => t.weekdayFull[d - 1] ?? "").join(", "))
        : settings.frequency === "weekly"
          ? t.summaryWeekly
          : t.summaryMonthly,
    );
    const names = [...settings.assignees.people, ...settings.assignees.departments].map(
      (entry) => entry.name,
    );
    if (names.length > 0) lines.push(t.summaryAssignees(names.join(", ")));
  }
  return lines;
}

export function FormSettingsCard({ form }: { form: FormDetail }) {
  return (
    <Card className="grid content-start gap-3 p-4">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">{t.title}</h2>
      </div>
      {form.canEdit ? (
        <SettingsEditor key={JSON.stringify(form.settings)} form={form} />
      ) : (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {summaryOf(form.settings).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SettingsEditor({ form }: { form: FormDetail }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const { node, space } = form;
  const initial = useMemo(() => draftOf(form.settings), [form.settings]);
  const [draft, setDraft] = useState<Draft>(initial);
  const set = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const dirty = JSON.stringify(inputOf(draft)) !== JSON.stringify(inputOf(initial));
  const periodic = draft.frequency !== "none";
  const invalid =
    (draft.responsibleType !== "default" && draft.responsible === null) ||
    (draft.frequency === "daily" && draft.weekdays.length === 0) ||
    (periodic && draft.people.size + draft.departments.size === 0);

  const responsibleTypes = useStaticSource("form-responsible", [
    { id: "default", label: t.responsibleDefault },
    { id: "person", label: t.responsiblePerson },
    { id: "department", label: t.responsibleDepartment },
  ]);
  const frequencies = useStaticSource(
    "form-frequency",
    (["none", "daily", "weekly", "monthly"] as const).map((id) => ({
      id,
      label: t.frequencies[id],
    })),
  );
  const departmentSource = useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "files", "department-options", space.id],
      search: async (q, cursor, signal) => {
        const page = await filesApi.departmentOptions(workspaceSlug, space.id, q, cursor, signal);
        return {
          items: page.items.map((d) => ({ id: d.id, label: d.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug, space.id],
  );
  const personSource = useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "files", "person-options"],
      search: async (q, cursor, signal) => {
        const page = await adminApi.directory(
          workspaceSlug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: page.items.map((p) => ({
            id: p.id,
            label: p.name,
            description: p.jobTitle ?? undefined,
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );

  const save = useMutation({
    mutationFn: () => formsApi.saveSettings(workspaceSlug, node.id, inputOf(draft)),
    onSuccess: ({ settings }) => {
      toast.success(t.saved);
      queryClient.setQueryData(formsKeys.form(workspaceSlug, node.id), {
        form: { ...form, settings },
      });
      void queryClient.invalidateQueries({ queryKey: formsKeys.pending(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  const defaultLine =
    form.settings.responsible.type === "default" && form.settings.responsible.people.length > 0
      ? t.responsibleDefaultIs(form.settings.responsible.people.map((p) => p.name).join(", "))
      : t.responsibleDefaultNone;

  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">{t.hint}</p>
      <LabeledField label={t.responsible} hint={t.responsibleHint}>
        {(field) => (
          <div className="grid gap-2">
            <Combobox
              {...field}
              label={t.responsible}
              placeholder={t.responsible}
              source={responsibleTypes}
              searchable={false}
              value={draft.responsibleType}
              onChange={(option) => {
                const next = (option?.id ?? "default") as ResponsibleType;
                set({ responsibleType: next, responsible: null });
              }}
            />
            {draft.responsibleType === "default" && (
              <p className="text-xs text-muted-foreground">{defaultLine}</p>
            )}
            {draft.responsibleType !== "default" && (
              <Combobox
                key={draft.responsibleType}
                label={draft.responsibleType === "person" ? t.choosePerson : t.chooseDepartment}
                placeholder={
                  draft.responsibleType === "person" ? t.choosePerson : t.chooseDepartment
                }
                source={draft.responsibleType === "person" ? personSource : departmentSource}
                value={draft.responsible?.id ?? null}
                valueLabel={draft.responsible?.label}
                onChange={(option) => {
                  set({
                    responsible: option === null ? null : { id: option.id, label: option.label },
                  });
                }}
              />
            )}
          </div>
        )}
      </LabeledField>

      <LabeledField label={t.frequency} hint={t.frequencyHint}>
        {(field) => (
          <Combobox
            {...field}
            label={t.frequency}
            placeholder={t.frequency}
            source={frequencies}
            searchable={false}
            value={draft.frequency}
            onChange={(option) => {
              set({ frequency: (option?.id ?? "none") as Frequency });
            }}
          />
        )}
      </LabeledField>

      {draft.frequency === "daily" && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t.weekdays}</legend>
          <div className="flex flex-wrap gap-1">
            {t.weekdayNames.map((name, index) => {
              const day = index + 1;
              const on = draft.weekdays.includes(day);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  aria-label={t.weekdayFull[index]}
                  className={cn(
                    "h-8 min-w-9 rounded-md border px-2 text-xs font-medium",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => {
                    set({
                      weekdays: on
                        ? draft.weekdays.filter((d) => d !== day)
                        : [...draft.weekdays, day].sort((a, b) => a - b),
                    });
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {periodic && (
        <div className="grid gap-2">
          <div>
            <p className="text-sm font-medium">{t.assignees}</p>
            <p className="text-xs text-muted-foreground">{t.assigneesHint}</p>
          </div>
          <Combobox
            multiple
            label={t.people}
            placeholder={t.people}
            source={personSource}
            values={[...draft.people.keys()]}
            valueLabels={draft.people}
            onChange={(ids, labels) => {
              set({ people: new Map(ids.map((id) => [id, labels.get(id) ?? ""])) });
            }}
          />
          <Combobox
            multiple
            label={t.departments}
            placeholder={t.departments}
            source={departmentSource}
            values={[...draft.departments.keys()]}
            valueLabels={draft.departments}
            onChange={(ids, labels) => {
              set({ departments: new Map(ids.map((id) => [id, labels.get(id) ?? ""])) });
            }}
          />
        </div>
      )}

      <Button
        className="justify-self-end"
        disabled={!dirty || invalid || save.isPending}
        onClick={() => {
          save.mutate();
        }}
      >
        {save.isPending ? t.saving : t.save}
      </Button>
    </div>
  );
}
