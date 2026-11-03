// /app/:slug/files/:spaceId/form/:formId/fill — filling in a form, made for the phone (the operator at
// the line; also tablets with PIN accounts and, with ?qr=1, from the form's QR code). One field under
// the other, big controls, photos from the camera (shrunk and re-encoded here, which drops their
// metadata) and a signature drawn with a finger. What's out of range shows as it's typed; the server
// checks everything again and works out what's non-conforming.
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ImagePlus, Loader2, ServerCrash, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, Input, Textarea } from "@/components/ui/form";
import { COMBO_PAGE_SIZE, Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { adminApi } from "@/features/admin/api";
import { adminErrorText } from "@/features/admin/admin-utils";
import { ApiError } from "@/lib/api";
import { loadBitmap, renderCover } from "@/lib/image-crop";
import { cn, formatDateTime } from "@/lib/utils";
import {
  formsApi,
  formsKeys,
  recordsApi,
  uploadFormFile,
  type Answer,
  type AnswerProblem,
  type FormDetail,
  type FormField,
  type RecordView,
} from "./forms-api";
import { SignaturePad } from "@/components/signature-pad";
import { texts } from "@/i18n";

const t = texts.forms.fill;

/**
 * Filling in a form. Embedded elsewhere (reporting an incident in Prevención) it gets the form, the
 * answers it starts with, the text fields that are a time of day, and where to go once it's sent.
 */
export function FormFillPage({
  formId: embeddedForm,
  initial,
  timeFields = [],
  onDone,
}: {
  formId?: string;
  initial?: Record<string, Answer>;
  timeFields?: readonly string[];
  onDone?: (record: RecordView) => void;
} = {}) {
  const { workspaceSlug = "", formId: routeForm = "" } = useParams();
  const formId = embeddedForm ?? routeForm;
  const form = useQuery({
    queryKey: formsKeys.form(workspaceSlug, formId),
    queryFn: () => formsApi.get(workspaceSlug, formId),
    select: (data) => data.form,
  });
  const [sent, setSent] = useState<RecordView | null>(null);
  const [round, setRound] = useState(0);
  if (form.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.forms.editor.loadError}>
          {adminErrorText(form.error)}
        </EmptyState>
      </Card>
    );
  }
  if (form.data === undefined) return <Skeleton className="mx-auto h-96 w-full max-w-xl" />;
  if (sent !== null && onDone === undefined) {
    return (
      <Sent
        form={form.data}
        record={sent}
        onAnother={() => {
          setSent(null);
          setRound((n) => n + 1);
        }}
      />
    );
  }
  // A new round (or a new version of the template) starts from blank answers.
  return (
    <Fill
      key={`${String(form.data.template.version)}-${String(round)}`}
      form={form.data}
      initial={initial ?? {}}
      timeFields={timeFields}
      onSent={onDone ?? setSent}
    />
  );
}

const numberText = (value: number) => String(value);

/** The acceptable range in words, for the hint and the warning. */
function rangeText(field: Extract<FormField, { type: "number" }>): string | null {
  const unit = field.unit === undefined ? "" : ` ${field.unit}`;
  if (field.min !== undefined && field.max !== undefined) {
    return t.range(numberText(field.min), `${numberText(field.max)}${unit}`);
  }
  if (field.min !== undefined) return t.atLeast(`${numberText(field.min)}${unit}`);
  if (field.max !== undefined) return t.atMost(`${numberText(field.max)}${unit}`);
  return null;
}

function outOfRange(field: Extract<FormField, { type: "number" }>, value: Answer | undefined) {
  return (
    typeof value === "number" &&
    ((field.min !== undefined && value < field.min) ||
      (field.max !== undefined && value > field.max))
  );
}

interface PhotoState {
  key: string;
  preview: string;
  fileId: string | null;
  failed: boolean;
}

function Fill({
  form,
  initial,
  timeFields,
  onSent,
}: {
  form: FormDetail;
  initial: Record<string, Answer>;
  timeFields: readonly string[];
  onSent: (record: RecordView) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const [params] = useSearchParams();
  const fields = form.template.fields;
  const [answers, setAnswers] = useState<Record<string, Answer>>(initial);
  const [photos, setPhotos] = useState<Record<string, PhotoState[]>>({});
  const signatures = useRef<Record<string, () => Promise<Blob | null>>>({});
  const [problems, setProblems] = useState<Record<string, AnswerProblem["reason"]>>({});
  const set = (id: string, value: Answer | undefined) => {
    setAnswers((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== id));
      return value === undefined ? rest : { ...rest, [id]: value };
    });
    setProblems((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
    );
  };

  const submit = useMutation({
    mutationFn: async () => {
      // Signatures are uploaded when sending (they're drawn until then).
      const signed: Record<string, Answer> = {};
      for (const field of fields) {
        if (field.type !== "signature") continue;
        const blob = await signatures.current[field.id]?.();
        if (blob !== null && blob !== undefined) {
          signed[field.id] = await uploadFormFile(
            workspaceSlug,
            form.node.id,
            field.id,
            blob,
            "image/png",
          );
        }
      }
      const photoAnswers: Record<string, Answer> = {};
      for (const [fieldId, list] of Object.entries(photos)) {
        const ids = list.flatMap((photo) => (photo.fileId === null ? [] : [photo.fileId]));
        if (ids.length > 0) photoAnswers[fieldId] = ids;
      }
      return await recordsApi.submit(workspaceSlug, form.node.id, {
        version: form.template.version,
        answers: { ...answers, ...photoAnswers, ...signed },
        source: params.get("qr") === "1" ? "qr" : "app",
      });
    },
    onSuccess: ({ record }) => {
      onSent(record);
    },
    onError: (error) => {
      const details =
        error instanceof ApiError
          ? (error.details as { fields?: AnswerProblem[] } | undefined)
          : undefined;
      if (details?.fields !== undefined) {
        setProblems(Object.fromEntries(details.fields.map((p) => [p.fieldId, p.reason])));
        toast.error(t.fixFirst);
      } else {
        toast.error(adminErrorText(error));
      }
    },
  });

  /** Required fields left empty, checked here before sending (the server checks again). */
  const checkRequired = async () => {
    const missing: Record<string, AnswerProblem["reason"]> = {};
    for (const field of fields) {
      if (!field.required) continue;
      if (field.type === "photo") {
        if ((photos[field.id] ?? []).every((photo) => photo.fileId === null))
          missing[field.id] = "required";
      } else if (field.type === "signature") {
        if ((await signatures.current[field.id]?.()) == null) missing[field.id] = "required";
      } else {
        const value = answers[field.id];
        if (
          value === undefined ||
          value === "" ||
          (Array.isArray(value) && value.length === 0 && field.type !== "checklist")
        ) {
          missing[field.id] = "required";
        }
      }
    }
    return missing;
  };

  const uploading = Object.values(photos).some((list) =>
    list.some((p) => p.fileId === null && !p.failed),
  );

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-xl grid-cols-1 gap-4 pb-28">
      <div>
        <h1 className="break-words text-xl font-semibold tracking-tight">
          {t.title(form.node.name)}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">{t.intro}</p>
      </div>
      {fields.length === 0 && <Card className="p-6 text-sm text-muted-foreground">{t.empty}</Card>}
      {fields.map((field) => (
        <Card
          key={field.id}
          className={cn("grid gap-3 p-4", problems[field.id] !== undefined && "border-danger")}
        >
          <div>
            <p className="font-medium">
              {field.label}
              {field.required && (
                <span className="ml-1 text-danger" aria-label={t.required}>
                  *
                </span>
              )}
            </p>
            {field.help !== undefined && (
              <p className="text-xs text-muted-foreground">{field.help}</p>
            )}
          </div>
          <FieldInput
            field={field}
            time={timeFields.includes(field.id)}
            value={answers[field.id]}
            photos={photos[field.id] ?? []}
            onChange={(value) => {
              set(field.id, value);
            }}
            onPhotos={(update) => {
              setPhotos((current) => ({ ...current, [field.id]: update(current[field.id] ?? []) }));
              set(field.id, undefined);
            }}
            registerSignature={(read) => {
              signatures.current[field.id] = read;
            }}
          />
          {problems[field.id] !== undefined && (
            <p role="alert" className="text-sm text-danger">
              {problems[field.id] === "required" ? t.requiredMissing : t.invalid}
            </p>
          )}
        </Card>
      ))}
      {fields.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 p-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
          <div className="mx-auto max-w-xl">
            <Button
              size="lg"
              className="w-full"
              disabled={submit.isPending || uploading}
              onClick={() => {
                void checkRequired().then((missing) => {
                  if (Object.keys(missing).length > 0) {
                    setProblems(missing);
                    toast.error(t.fixFirst);
                    return;
                  }
                  submit.mutate();
                });
              }}
            >
              {submit.isPending ? t.sending : uploading ? t.uploading : t.send}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldInput({
  field,
  time,
  value,
  photos,
  onChange,
  onPhotos,
  registerSignature,
}: {
  field: FormField;
  /** A text field that is a time of day (a time picker). */
  time: boolean;
  value: Answer | undefined;
  photos: PhotoState[];
  onChange: (value: Answer | undefined) => void;
  onPhotos: (update: (list: PhotoState[]) => PhotoState[]) => void;
  registerSignature: (read: () => Promise<Blob | null>) => void;
}) {
  switch (field.type) {
    case "text":
      return field.multiline ? (
        <Textarea
          aria-label={field.label}
          rows={4}
          maxLength={5000}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => {
            onChange(event.target.value === "" ? undefined : event.target.value);
          }}
        />
      ) : (
        <Input
          aria-label={field.label}
          maxLength={500}
          {...(time ? { type: "time" } : {})}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => {
            onChange(event.target.value === "" ? undefined : event.target.value);
          }}
        />
      );
    case "number": {
      const range = rangeText(field);
      return (
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <NumberInput label={field.label} value={value} onChange={onChange} />
            {field.unit !== undefined && (
              <span className="text-sm text-muted-foreground">{field.unit}</span>
            )}
          </div>
          {outOfRange(field, value) && range !== null ? (
            <p className="text-sm font-medium text-warning-soft-foreground">
              {t.outOfRange(range)}
            </p>
          ) : (
            range !== null && <p className="text-xs text-muted-foreground">{range}</p>
          )}
        </div>
      );
    }
    case "yesno":
      return (
        <div className="grid gap-1">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={field.label}>
            {(["yes", "no"] as const).map((option) => (
              <Choice
                key={option}
                selected={value === option}
                warn={field.nonConforming === option}
                label={option === "yes" ? t.yes : t.no}
                onSelect={() => {
                  onChange(value === option ? undefined : option);
                }}
              />
            ))}
          </div>
          {value !== undefined && value === field.nonConforming && (
            <p className="text-sm font-medium text-warning-soft-foreground">
              {t.nonConformingAnswer}
            </p>
          )}
        </div>
      );
    case "choice":
      return (
        <div className="grid gap-1">
          <div className="grid gap-2" role="radiogroup" aria-label={field.label}>
            {field.options.map((option) => (
              <Choice
                key={option.id}
                selected={value === option.id}
                warn={field.nonConforming.includes(option.id)}
                label={option.label}
                onSelect={() => {
                  onChange(value === option.id ? undefined : option.id);
                }}
              />
            ))}
          </div>
          {typeof value === "string" && field.nonConforming.includes(value) && (
            <p className="text-sm font-medium text-warning-soft-foreground">
              {t.nonConformingAnswer}
            </p>
          )}
        </div>
      );
    case "date":
      return (
        <Input
          type="date"
          aria-label={field.label}
          className="w-fit"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => {
            onChange(event.target.value === "" ? undefined : event.target.value);
          }}
        />
      );
    case "checklist": {
      const checked = new Set(Array.isArray(value) ? value : []);
      return (
        <div className="grid gap-3">
          {field.items.map((item) => (
            <Checkbox
              key={item.id}
              label={item.label}
              className="size-5"
              checked={checked.has(item.id)}
              onChange={(event) => {
                const next = new Set(checked);
                if (event.target.checked) next.add(item.id);
                else next.delete(item.id);
                onChange([...next]);
              }}
            />
          ))}
        </div>
      );
    }
    case "photo":
      return <Photos field={field} photos={photos} onPhotos={onPhotos} />;
    case "signature":
      return <SignaturePad label={field.label} register={registerSignature} />;
    case "person":
      return <PersonPicker label={field.label} value={value} onChange={onChange} />;
  }
}

/** Someone of the company, searched in the people directory (the answer is their membership id). */
function PersonPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Answer | undefined;
  onChange: (value: Answer | undefined) => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const [name, setName] = useState<string | undefined>(undefined);
  const source = useMemo<ComboboxSource>(
    () => ({
      key: ["w", workspaceSlug, "forms", "person-options"],
      search: async (q, cursor, signal) => {
        const page = await adminApi.directory(
          workspaceSlug,
          { q, cursor, pageSize: COMBO_PAGE_SIZE },
          signal,
        );
        return {
          items: page.items.map((person) => ({ id: person.id, label: person.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
  return (
    <Combobox
      label={label}
      placeholder={t.choosePerson}
      source={source}
      value={typeof value === "string" ? value : null}
      valueLabel={name}
      clearable
      onChange={(option) => {
        setName(option?.label);
        onChange(option?.id);
      }}
    />
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Answer | undefined;
  onChange: (value: Answer | undefined) => void;
}) {
  const [text, setText] = useState(typeof value === "number" ? String(value) : "");
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      className="max-w-[10rem] text-lg"
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const parsed = Number(raw.replace(",", "."));
        onChange(raw.trim() === "" || !Number.isFinite(parsed) ? undefined : parsed);
      }}
    />
  );
}

function Choice({
  selected,
  warn,
  label,
  onSelect,
}: {
  selected: boolean;
  warn: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(
        "min-h-12 rounded-xl border px-4 py-2 text-left text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        selected
          ? warn
            ? "border-warning bg-warning-soft text-warning-soft-foreground"
            : "border-primary bg-primary-soft text-primary-soft-foreground"
          : "border-border bg-background hover:bg-muted",
      )}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

function Photos({
  field,
  photos,
  onPhotos,
}: {
  field: Extract<FormField, { type: "photo" }>;
  photos: PhotoState[];
  onPhotos: (update: (list: PhotoState[]) => PhotoState[]) => void;
}) {
  const { workspaceSlug = "", formId = "" } = useParams();
  const input = useRef<HTMLInputElement>(null);
  const add = async (file: File) => {
    const key = `${String(Date.now())}-${file.name}`;
    let blob: Blob;
    try {
      blob = await renderCover(await loadBitmap(file));
    } catch {
      toast.error(t.uploadFailed);
      return;
    }
    // A data: URL (the app's CSP allows data: images, not blob:); the shrunk photo is small.
    const preview = await dataUrlOf(blob);
    onPhotos((list) => [...list, { key, preview, fileId: null, failed: false }]);
    try {
      const fileId = await uploadFormFile(workspaceSlug, formId, field.id, blob, "image/webp");
      onPhotos((list) => list.map((p) => (p.key === key ? { ...p, fileId } : p)));
    } catch {
      toast.error(t.uploadFailed);
      onPhotos((list) => list.map((p) => (p.key === key ? { ...p, failed: true } : p)));
    }
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {photos.map((photo) => (
          <div
            key={photo.key}
            className="relative size-24 overflow-hidden rounded-lg border border-border"
          >
            <img
              src={photo.preview}
              alt=""
              className={cn("size-full object-cover", photo.failed && "opacity-40")}
            />
            {photo.fileId === null && !photo.failed && (
              <span className="absolute inset-0 grid place-items-center bg-background/50">
                <Loader2 className="size-5 animate-spin" aria-label={t.uploading} />
              </span>
            )}
            <button
              type="button"
              className="absolute right-1 top-1 rounded-full bg-background/90 p-1 shadow"
              aria-label={t.removePhoto}
              onClick={() => {
                onPhotos((list) => list.filter((p) => p.key !== photo.key));
              }}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file !== undefined) void add(file);
        }}
      />
      {photos.length < field.max && (
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => {
            input.current?.click();
          }}
        >
          <ImagePlus className="size-4" aria-hidden="true" />
          {t.takePhoto}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t.photos(photos.length, field.max)}</p>
    </div>
  );
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => {
      reject(new Error("preview"));
    };
    reader.readAsDataURL(blob);
  });
}

function Sent({
  form,
  record,
  onAnother,
}: {
  form: FormDetail;
  record: RecordView;
  onAnother: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const base = `/app/${workspaceSlug}/files/${form.space.id}/form/${form.node.id}`;
  const failing = form.template.fields.filter((field) => record.nonConforming.includes(field.id));
  return (
    <div className="mx-auto grid w-full max-w-xl gap-4">
      <Card className="grid justify-items-center gap-2 p-6 text-center">
        <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{t.sent}</h1>
        <p className="text-sm text-muted-foreground">
          {t.sentText(formatDateTime(record.submittedAt))}
        </p>
      </Card>
      {failing.length > 0 && (
        <Banner tone="warning">
          {t.sentNonConforming} {failing.map((field) => field.label).join(", ")}.
        </Banner>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <Button size="lg" onClick={onAnother}>
          {t.another}
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link to={`${base}/r/${record.id}`}>{t.seeRecord}</Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link to={base}>{t.backToForm}</Link>
        </Button>
      </div>
    </div>
  );
}
