// /app/:slug/files/:spaceId/form/:formId — a form's template (docs/spec/formularios.md): its fields,
// edited here and saved as a new version, and the list of versions (any of them can be looked at, read
// only). Whoever can only see it gets the same screen without the editing controls. The server checks
// every field and the permission again.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Hash,
  History,
  ListChecks,
  ListTodo,
  PenLine,
  Plus,
  ServerCrash,
  ToggleLeft,
  Trash2,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { Badge, Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField as LabeledField, Input } from "@/components/ui/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { filesKeys } from "@/features/files/api";
import { ApiError } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import {
  FIELD_TYPES,
  formsApi,
  formsKeys,
  newId,
  type FieldType,
  type FormDetail,
  type FormField,
  type Option,
} from "./forms-api";
import { RecordsList } from "./records";
import { texts } from "@/i18n";

const t = texts.forms;

const ICONS: Record<FieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  yesno: ToggleLeft,
  choice: ListTodo,
  date: CalendarDays,
  checklist: ListChecks,
  photo: Camera,
  signature: PenLine,
};

/** A new field of a type, with what it needs to be valid once it has a label. */
function blankField(type: FieldType): FormField {
  const base = { id: newId("f"), label: "", required: false };
  switch (type) {
    case "text":
      return { ...base, type, multiline: false };
    case "number":
      return { ...base, type };
    case "yesno":
      return { ...base, type, nonConforming: null };
    case "choice":
      return {
        ...base,
        type,
        options: [
          { id: newId("o"), label: "" },
          { id: newId("o"), label: "" },
        ],
        nonConforming: [],
      };
    case "date":
      return { ...base, type };
    case "checklist":
      return { ...base, type, items: [{ id: newId("o"), label: "" }] };
    case "photo":
      return { ...base, type, max: 1 };
    case "signature":
      return { ...base, type };
  }
}

/** What's wrong with a field before saving (the server checks it again). */
function problemsOf(field: FormField): { label?: string; options?: string; range?: string } {
  const problems: { label?: string; options?: string; range?: string } = {};
  if (field.label.trim() === "") problems.label = t.field.labelRequired;
  if (field.type === "choice" && field.options.filter((o) => o.label.trim() !== "").length < 2) {
    problems.options = t.field.optionsRequired;
  }
  if (field.type === "checklist" && field.items.every((o) => o.label.trim() === "")) {
    problems.options = t.field.itemsRequired;
  }
  if (
    field.type === "number" &&
    field.min !== undefined &&
    field.max !== undefined &&
    field.min > field.max
  ) {
    problems.range = t.field.rangeInverted;
  }
  return problems;
}

/** The fields as sent: trimmed texts, empty options and empty help left out. */
function cleaned(fields: FormField[]): FormField[] {
  return fields.map((field) => {
    const label = field.label.trim();
    const help = field.help?.trim() ?? "";
    const common = { ...field, label, ...(help === "" ? {} : { help }) };
    if (help === "") delete (common as { help?: string }).help;
    if (field.type === "choice") {
      const options = field.options
        .map((o) => ({ ...o, label: o.label.trim() }))
        .filter((o) => o.label !== "");
      const kept = new Set(options.map((o) => o.id));
      return {
        ...common,
        type: "choice",
        options,
        nonConforming: field.nonConforming.filter((id) => kept.has(id)),
      };
    }
    if (field.type === "checklist") {
      return {
        ...common,
        type: "checklist",
        items: field.items
          .map((o) => ({ ...o, label: o.label.trim() }))
          .filter((o) => o.label !== ""),
      };
    }
    return common;
  });
}

export function FormEditorPage() {
  const { workspaceSlug = "", formId = "" } = useParams();
  const form = useQuery({
    queryKey: formsKeys.form(workspaceSlug, formId),
    queryFn: () => formsApi.get(workspaceSlug, formId),
    select: (data) => data.form,
  });
  if (form.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={t.editor.loadError}>
          {adminErrorText(form.error)}
        </EmptyState>
      </Card>
    );
  }
  if (form.data === undefined) return <Skeleton className="h-96 w-full" />;
  // A new version loaded from the server starts a fresh draft.
  return <Editor key={form.data.template.version} form={form.data} />;
}

function Editor({ form }: { form: FormDetail }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const saved = form.template.fields;
  const [draft, setDraft] = useState<FormField[]>(saved);
  const [viewing, setViewing] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const dirty = JSON.stringify(cleaned(draft)) !== JSON.stringify(saved);
  const problems = useMemo(() => draft.map(problemsOf), [draft]);
  const invalid = problems.some((p) => Object.keys(p).length > 0);
  const { node, space } = form;
  const back = `/app/${workspaceSlug}/files/${space.id}${node.parentId === null ? "" : `/f/${node.parentId}`}`;
  const parentName = form.ancestors.at(-1)?.name ?? space.name;

  const save = useMutation({
    mutationFn: () =>
      formsApi.saveTemplate(workspaceSlug, node.id, {
        baseVersion: form.template.version,
        fields: cleaned(draft),
      }),
    onSuccess: async ({ form: next }) => {
      if (next.template.version === form.template.version) toast(t.editor.noChanges);
      else toast.success(t.editor.saved(next.template.version));
      queryClient.setQueryData(formsKeys.form(workspaceSlug, node.id), { form: next });
      await queryClient.invalidateQueries({ queryKey: formsKeys.versions(workspaceSlug, node.id) });
      await queryClient.invalidateQueries({ queryKey: filesKeys.nodes(workspaceSlug, space.id) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else toast.error(adminErrorText(error));
    },
  });

  const change = (index: number, next: FormField) => {
    setDraft((current) => current.map((field, i) => (i === index ? next : field)));
  };
  const move = (index: number, by: -1 | 1) => {
    setDraft((current) => {
      const next = [...current];
      const [field] = next.splice(index, 1);
      if (field !== undefined) next.splice(index + by, 0, field);
      return next;
    });
  };
  const editable = form.canEdit && viewing === null;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-6xl grid-cols-1 gap-4">
      <div className="grid gap-2">
        <Link
          to={back}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {parentName}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <ClipboardList className="size-6 text-primary" strokeWidth={1.75} aria-hidden="true" />
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{node.name}</h1>
          <Badge tone="primary">{t.editor.version(form.template.version)}</Badge>
          {editable && dirty && <Badge tone="warning">{t.editor.unsaved}</Badge>}
          {form.template.fields.length > 0 && (
            <Button asChild className="ml-auto">
              <Link to={`/app/${workspaceSlug}/files/${space.id}/form/${node.id}/fill`}>
                <ClipboardList className="size-4" aria-hidden="true" />
                {t.fill.open}
              </Link>
            </Button>
          )}
        </div>
        <p className="max-w-3xl text-xs text-muted-foreground">
          {form.canEdit ? t.editor.intro : t.editor.readOnly}
        </p>
      </div>

      {conflict && (
        <Banner
          tone="warning"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void queryClient.invalidateQueries({
                  queryKey: formsKeys.form(workspaceSlug, node.id),
                });
              }}
            >
              {t.editor.reload}
            </Button>
          }
        >
          {t.editor.conflict}
        </Banner>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid min-w-0 content-start gap-3">
          {viewing !== null ? (
            <OldVersion
              formId={node.id}
              version={viewing}
              onBack={() => {
                setViewing(null);
              }}
            />
          ) : (
            <>
              {draft.length === 0 && (
                <Card className="p-6 text-sm text-muted-foreground">{t.editor.empty}</Card>
              )}
              {draft.map((field, index) => (
                <FieldCard
                  key={field.id}
                  field={field}
                  problems={problems[index] ?? {}}
                  editable={editable}
                  first={index === 0}
                  last={index === draft.length - 1}
                  onChange={(next) => {
                    change(index, next);
                  }}
                  onMove={(by) => {
                    move(index, by);
                  }}
                  onRemove={() => {
                    setDraft((current) => current.filter((_, i) => i !== index));
                  }}
                />
              ))}
              {editable && (
                <div className="flex flex-wrap items-center gap-2">
                  <AddField
                    onAdd={(type) => {
                      setDraft((current) => [...current, blankField(type)]);
                    }}
                  />
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {dirty && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDraft(saved);
                        }}
                      >
                        {t.editor.discard}
                      </Button>
                    )}
                    <Button
                      disabled={!dirty || invalid || save.isPending}
                      title={invalid ? t.editor.invalid : undefined}
                      onClick={() => {
                        save.mutate();
                      }}
                    >
                      {save.isPending ? t.editor.saving : t.editor.save}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <Versions
          formId={node.id}
          current={form.template.version}
          viewing={viewing}
          onView={setViewing}
        />
      </div>
      <RecordsList formId={node.id} spaceId={space.id} seesAll={form.canEdit} />
    </div>
  );
}

function AddField({ onAdd }: { onAdd: (type: FieldType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Plus className="size-4" aria-hidden="true" />
          {t.editor.addField}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {FIELD_TYPES.map((type) => {
          const Icon = ICONS[type];
          return (
            <DropdownMenuItem
              key={type}
              className="h-auto items-start py-2"
              onSelect={() => {
                onAdd(type);
              }}
            >
              <Icon className="mt-0.5" aria-hidden="true" />
              <span className="grid">
                <span className="font-medium">{t.types[type]}</span>
                <span className="text-xs text-muted-foreground">{t.typeHelp[type]}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const numberOrUndefined = (value: string): number | undefined => {
  if (value.trim() === "") return undefined;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
};

function FieldCard({
  field,
  problems,
  editable,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  field: FormField;
  problems: { label?: string; options?: string; range?: string };
  editable: boolean;
  first: boolean;
  last: boolean;
  onChange: (field: FormField) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const f = t.field;
  const Icon = ICONS[field.type];
  const name = field.label.trim() === "" ? t.editor.untitled : field.label;
  if (!editable) return <FieldPreview field={field} />;
  return (
    <Card className="grid gap-4 p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {t.types[field.type]}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={first}
            aria-label={t.editor.moveUp(name)}
            onClick={() => {
              onMove(-1);
            }}
          >
            <ChevronUp className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={last}
            aria-label={t.editor.moveDown(name)}
            onClick={() => {
              onMove(1);
            }}
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-danger"
            aria-label={t.editor.remove(name)}
            onClick={onRemove}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledField label={f.label} hint={f.labelHint} error={problems.label}>
          {(control) => (
            <Input
              {...control}
              value={field.label}
              maxLength={200}
              onChange={(event) => {
                onChange({ ...field, label: event.target.value });
              }}
            />
          )}
        </LabeledField>
        <LabeledField label={f.help} hint={f.helpHint}>
          {(control) => (
            <Input
              {...control}
              value={field.help ?? ""}
              maxLength={500}
              onChange={(event) => {
                onChange({ ...field, help: event.target.value });
              }}
            />
          )}
        </LabeledField>
      </div>
      <div className="grid gap-1">
        <Checkbox
          label={f.required}
          checked={field.required}
          onChange={(event) => {
            onChange({ ...field, required: event.target.checked });
          }}
        />
        <p className="pl-6 text-xs text-muted-foreground">{f.requiredHint}</p>
      </div>
      <TypeSettings field={field} problems={problems} onChange={onChange} />
    </Card>
  );
}

function TypeSettings({
  field,
  problems,
  onChange,
}: {
  field: FormField;
  problems: { options?: string; range?: string };
  onChange: (field: FormField) => void;
}) {
  const f = t.field;
  switch (field.type) {
    case "text":
      return (
        <Checkbox
          label={f.multiline}
          checked={field.multiline}
          onChange={(event) => {
            onChange({ ...field, multiline: event.target.checked });
          }}
        />
      );
    case "number":
      return (
        <div className="grid gap-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <LabeledField label={f.unit} hint={f.unitHint}>
              {(control) => (
                <Input
                  {...control}
                  value={field.unit ?? ""}
                  maxLength={20}
                  onChange={(event) => {
                    const unit = event.target.value;
                    const next = { ...field };
                    delete next.unit;
                    onChange(unit === "" ? next : { ...next, unit });
                  }}
                />
              )}
            </LabeledField>
            {(["min", "max"] as const).map((key) => (
              <LabeledField key={key} label={key === "min" ? f.min : f.max}>
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={field[key] ?? ""}
                    onChange={(event) => {
                      const value = numberOrUndefined(event.target.value);
                      const next = { ...field };
                      if (key === "min") delete next.min;
                      else delete next.max;
                      onChange(value === undefined ? next : { ...next, [key]: value });
                    }}
                  />
                )}
              </LabeledField>
            ))}
          </div>
          <p
            className={cn(
              "text-xs",
              problems.range === undefined ? "text-muted-foreground" : "text-danger",
            )}
          >
            {problems.range ?? f.rangeHint}
          </p>
        </div>
      );
    case "yesno":
      return (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">{f.nonConforming}</legend>
          <div className="flex flex-wrap gap-4">
            {([null, "yes", "no"] as const).map((value) => (
              <label key={String(value)} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`nc-${field.id}`}
                  className="accent-primary"
                  checked={field.nonConforming === value}
                  onChange={() => {
                    onChange({ ...field, nonConforming: value });
                  }}
                />
                {value === null ? f.none : value === "yes" ? f.yes : f.no}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{f.nonConformingHint}</p>
        </fieldset>
      );
    case "choice":
      return (
        <OptionsEditor
          title={f.options}
          hint={f.optionsHint}
          placeholder={f.option}
          add={f.addOption}
          options={field.options}
          problem={problems.options}
          nonConforming={field.nonConforming}
          onChange={(options, nonConforming) => {
            onChange({ ...field, options, nonConforming: nonConforming ?? field.nonConforming });
          }}
        />
      );
    case "checklist":
      return (
        <OptionsEditor
          title={f.items}
          hint={f.itemsHint}
          placeholder={f.item}
          add={f.addItem}
          options={field.items}
          problem={problems.options}
          onChange={(items) => {
            onChange({ ...field, items });
          }}
        />
      );
    case "photo":
      return (
        <div className="max-w-[12rem]">
          <LabeledField label={f.photos} hint={f.photosHint}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                max={10}
                value={field.max}
                onChange={(event) => {
                  const value = Math.min(
                    10,
                    Math.max(1, Math.round(Number(event.target.value) || 1)),
                  );
                  onChange({ ...field, max: value });
                }}
              />
            )}
          </LabeledField>
        </div>
      );
    case "date":
    case "signature":
      return <p className="text-xs text-muted-foreground">{t.typeHelp[field.type]}</p>;
  }
}

function OptionsEditor({
  title,
  hint,
  placeholder,
  add,
  options,
  problem,
  nonConforming,
  onChange,
}: {
  title: string;
  hint: string;
  placeholder: (n: number) => string;
  add: string;
  options: Option[];
  problem: string | undefined;
  /** Only for choices: which options are non-conforming. */
  nonConforming?: string[];
  onChange: (options: Option[], nonConforming?: string[]) => void;
}) {
  const f = t.field;
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{title}</legend>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <ul className="grid gap-2">
        {options.map((option, index) => (
          <li key={option.id} className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-0 flex-1"
              value={option.label}
              maxLength={200}
              aria-label={placeholder(index + 1)}
              placeholder={placeholder(index + 1)}
              onChange={(event) => {
                onChange(
                  options.map((o) =>
                    o.id === option.id ? { ...o, label: event.target.value } : o,
                  ),
                );
              }}
            />
            {nonConforming !== undefined && (
              <Checkbox
                label={f.optionNonConforming}
                checked={nonConforming.includes(option.id)}
                onChange={(event) => {
                  onChange(
                    options,
                    event.target.checked
                      ? [...nonConforming, option.id]
                      : nonConforming.filter((id) => id !== option.id),
                  );
                }}
              />
            )}
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={f.removeOption(
                option.label === "" ? placeholder(index + 1) : option.label,
              )}
              onClick={() => {
                onChange(
                  options.filter((o) => o.id !== option.id),
                  nonConforming?.filter((id) => id !== option.id),
                );
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {problem !== undefined && <p className="text-xs text-danger">{problem}</p>}
      <Button
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => {
          onChange([...options, { id: newId("o"), label: "" }]);
        }}
      >
        <Plus className="size-4" aria-hidden="true" />
        {add}
      </Button>
    </fieldset>
  );
}

/** A field as people will see it, read only (an old version, or for whoever can't edit). */
function FieldPreview({ field }: { field: FormField }) {
  const f = t.field;
  const Icon = ICONS[field.type];
  const rule =
    field.type === "number"
      ? [
          field.min === undefined ? null : `≥ ${String(field.min)}`,
          field.max === undefined ? null : `≤ ${String(field.max)}`,
        ]
          .filter((part) => part !== null)
          .join(" · ")
      : field.type === "yesno" && field.nonConforming !== null
        ? `${f.nonConforming}: ${field.nonConforming === "yes" ? f.yes : f.no}`
        : "";
  return (
    <Card className="grid gap-1 p-4">
      <p className="flex flex-wrap items-center gap-2">
        <Icon className="size-4 text-primary" aria-hidden="true" />
        <span className="font-medium">{field.label}</span>
        {field.required && <Badge tone="neutral">{f.required}</Badge>}
        <span className="text-xs text-muted-foreground">
          {t.types[field.type]}
          {field.type === "number" && field.unit !== undefined ? ` (${field.unit})` : ""}
        </span>
      </p>
      {field.help !== undefined && <p className="text-xs text-muted-foreground">{field.help}</p>}
      {rule !== "" && <p className="text-xs text-muted-foreground">{rule}</p>}
      {(field.type === "choice" || field.type === "checklist") && (
        <ul className="ml-6 list-disc text-sm">
          {(field.type === "choice" ? field.options : field.items).map((option) => (
            <li key={option.id}>
              {option.label}
              {field.type === "choice" && field.nonConforming.includes(option.id) && (
                <span className="text-xs text-danger"> · {f.optionNonConforming}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OldVersion({
  formId,
  version,
  onBack,
}: {
  formId: string;
  version: number;
  onBack: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const old = useQuery({
    queryKey: formsKeys.version(workspaceSlug, formId, version),
    queryFn: () => formsApi.version(workspaceSlug, formId, version),
    select: (data) => data.version,
  });
  return (
    <>
      <Banner
        tone="info"
        icon={History}
        action={
          <Button size="sm" variant="outline" onClick={onBack}>
            {t.versions.back}
          </Button>
        }
      >
        {t.versions.viewing(version)}
      </Banner>
      {old.data === undefined ? (
        <Skeleton className="h-40 w-full" />
      ) : old.data.fields.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">{t.editor.empty}</Card>
      ) : (
        old.data.fields.map((field) => <FieldPreview key={field.id} field={field} />)
      )}
    </>
  );
}

function Versions({
  formId,
  current,
  viewing,
  onView,
}: {
  formId: string;
  current: number;
  viewing: number | null;
  onView: (version: number | null) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const list = useInfiniteList({
    queryKey: formsKeys.versions(workspaceSlug, formId),
    fetchPage: (cursor, signal) => formsApi.versions(workspaceSlug, formId, cursor, signal),
  });
  return (
    <Card className="grid content-start gap-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 font-medium">
          <History className="size-4 text-muted-foreground" aria-hidden="true" />
          {t.versions.title}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t.versions.hint}</p>
      </div>
      <ul className="grid gap-1">
        {list.items.map((item) => {
          const active = viewing === null ? item.version === current : item.version === viewing;
          return (
            <li key={item.version}>
              <button
                type="button"
                className={cn(
                  "grid w-full gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  active && "bg-primary-soft",
                )}
                onClick={() => {
                  onView(item.version === current ? null : item.version);
                }}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {t.editor.version(item.version)}
                  {item.version === current && <Badge tone="primary">{t.versions.current}</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.versions.fields(item.fieldCount)} · {formatDateTime(item.createdAt)}
                  {item.createdBy === null ? "" : ` · ${item.createdBy.name}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <LoadMore
        hasNextPage={list.query.hasNextPage}
        isFetching={list.query.isFetchingNextPage}
        onLoadMore={list.loadMore}
      />
    </Card>
  );
}
