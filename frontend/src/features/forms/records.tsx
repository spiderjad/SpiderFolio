// A form's records (docs/spec/formularios.md): the list on the form's screen (each person's own, or
// all of them for whoever edits the form) and one record, read only, with the fields of the version
// it was filled with, what was non-conforming, its photos and its signature.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  ClipboardCheck,
  Download,
  ListChecks,
  QrCode,
  ServerCrash,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  COMBO_PAGE_SIZE,
  Combobox,
  useStaticSource,
  type ComboboxSource,
} from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField as LabeledField, Input, Textarea } from "@/components/ui/form";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import {
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { adminApi } from "@/features/admin/api";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { readChoice, useListParams } from "@/features/admin/list-params";
import { ApiError } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import {
  formsApi,
  formsKeys,
  recordsApi,
  recordsKeys,
  type Answer,
  type FormField,
  type RecordFilters,
} from "./forms-api";
import { useMembership } from "@/features/home/workspace-layout";
import { RecordNcButton } from "@/features/quality/record-nc";
import { ActionDialog } from "@/features/safety/action-dialog";
import { locale, texts } from "@/i18n";

const t = texts.forms;

const STATUSES = (["all", "valid", "voided"] as const).map((id) => ({
  id,
  label: t.records.filters.statuses[id],
}));

/** The list's filters, read from the URL (so they survive a reload and can be shared). */
function filtersOf(params: URLSearchParams): RecordFilters {
  const day = (key: string) => {
    const value = params.get(key) ?? "";
    return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined;
  };
  const version = Number(params.get("version") ?? "");
  return {
    from: day("desde"),
    to: day("hasta"),
    person: params.get("persona") ?? undefined,
    version: Number.isInteger(version) && version >= 1 ? version : undefined,
    nonConforming: params.get("noConformes") === "1" ? true : undefined,
    // Voided records are hidden until asked for.
    status: readChoice(params, "estado", ["all", "valid", "voided"] as const, "valid"),
  };
}

export function RecordsList({
  formId,
  formName,
  spaceId,
  seesAll,
  columns = [],
}: {
  formId: string;
  formName: string;
  spaceId: string;
  seesAll: boolean;
  /** The fields shown as columns (their values in each record). */
  columns?: readonly FormField[];
}) {
  const { workspaceSlug = "" } = useParams();
  const { params, patch } = useListParams();
  const filters = useMemo(() => filtersOf(params), [params]);
  const filtered =
    filters.from !== undefined ||
    filters.to !== undefined ||
    filters.person !== undefined ||
    filters.version !== undefined ||
    filters.nonConforming === true ||
    filters.status !== "valid";
  const [personLabel, setPersonLabel] = useState<string | undefined>(undefined);
  const statuses = useStaticSource("form-record-status", STATUSES);
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
          items: page.items.map((p) => ({ id: p.id, label: p.name })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug],
  );
  const versionSource = useMemo<ComboboxSource>(
    () => ({
      key: [...formsKeys.versions(workspaceSlug, formId), "options"],
      search: async (_q, cursor, signal) => {
        const page = await formsApi.versions(workspaceSlug, formId, cursor, signal);
        return {
          items: page.items.map((v) => ({
            id: String(v.version),
            label: t.records.version(v.version),
          })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: () => Promise.resolve([]),
    }),
    [workspaceSlug, formId],
  );
  const list = useInfiniteList({
    queryKey: recordsKeys.list(workspaceSlug, formId, filters),
    fetchPage: (cursor, signal) => recordsApi.list(workspaceSlug, formId, filters, cursor, signal),
  });
  const exportFile = useMutation({
    mutationFn: async (format: "csv" | "pdf") => {
      const blob = await recordsApi.export(workspaceSlug, formId, format, filters);
      downloadBlobFile(t.records.fileName(formName, format), blob);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const base = `/app/${workspaceSlug}/files/${spaceId}/form/${formId}/r`;
  const f = t.records.filters;
  return (
    <Card className="grid gap-3 p-0">
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-medium">
            <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden="true" />
            {seesAll ? t.records.title : t.records.mineTitle}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {seesAll ? t.records.hintAll : t.records.hintMine}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={exportFile.isPending}
              title={t.records.exportHint}
            >
              <Download className="size-4" aria-hidden="true" />
              {exportFile.isPending ? t.records.exporting : t.records.export}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                exportFile.mutate("csv");
              }}
            >
              {t.records.exportCsv}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                exportFile.mutate("pdf");
              }}
            >
              {t.records.exportPdf}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
        <LabeledField label={f.from}>
          {(field) => (
            <Input
              {...field}
              type="date"
              value={filters.from ?? ""}
              onChange={(event) => {
                patch({ desde: event.target.value });
              }}
            />
          )}
        </LabeledField>
        <LabeledField label={f.to}>
          {(field) => (
            <Input
              {...field}
              type="date"
              value={filters.to ?? ""}
              onChange={(event) => {
                patch({ hasta: event.target.value });
              }}
            />
          )}
        </LabeledField>
        {seesAll && (
          <LabeledField label={f.person}>
            {(field) => (
              <Combobox
                {...field}
                compact
                label={f.person}
                placeholder={f.anyPerson}
                source={personSource}
                value={filters.person ?? null}
                valueLabel={personLabel ?? (filters.person === undefined ? undefined : f.person)}
                clearable
                onChange={(option) => {
                  setPersonLabel(option?.label);
                  patch({ persona: option?.id });
                }}
              />
            )}
          </LabeledField>
        )}
        <LabeledField label={f.version}>
          {(field) => (
            <Combobox
              {...field}
              compact
              label={f.version}
              placeholder={f.anyVersion}
              source={versionSource}
              searchable={false}
              value={filters.version === undefined ? null : String(filters.version)}
              valueLabel={
                filters.version === undefined ? undefined : t.records.version(filters.version)
              }
              clearable
              onChange={(option) => {
                patch({ version: option?.id });
              }}
            />
          )}
        </LabeledField>
        <LabeledField label={f.status}>
          {(field) => (
            <Combobox
              {...field}
              compact
              label={f.status}
              placeholder={f.statuses.all}
              source={statuses}
              searchable={false}
              value={filters.status ?? "valid"}
              onChange={(option) => {
                patch({ estado: option === null || option.id === "valid" ? undefined : option.id });
              }}
            />
          )}
        </LabeledField>
        <div className="flex h-9 items-center">
          <Checkbox
            label={f.nonConforming}
            checked={filters.nonConforming === true}
            onChange={(event) => {
              patch({ noConformes: event.target.checked ? "1" : undefined });
            }}
          />
        </div>
      </div>
      {filtered && (
        <div className="px-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPersonLabel(undefined);
              patch({
                desde: undefined,
                hasta: undefined,
                persona: undefined,
                version: undefined,
                estado: undefined,
                noConformes: undefined,
              });
            }}
          >
            <X className="size-4" aria-hidden="true" />
            {f.clear}
          </Button>
        </div>
      )}
      {list.query.isPending ? (
        <Skeleton className="mx-4 mb-4 h-20" />
      ) : list.query.isError ? (
        <p className="px-4 pb-4 text-sm text-danger">{adminErrorText(list.query.error)}</p>
      ) : list.items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">
          {filtered ? t.records.emptyFiltered : t.records.empty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{t.records.columns.date}</th>
                <th className="px-4 py-2 font-medium">{t.records.columns.person}</th>
                {columns.map((field) => (
                  <th key={field.id} className="px-4 py-2 font-medium">
                    {field.label}
                  </th>
                ))}
                <th className="px-4 py-2 font-medium">{t.records.columns.status}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((record) => (
                <tr
                  key={record.id}
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-muted",
                    record.voided !== null && "text-muted-foreground",
                  )}
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`${base}/${record.id}`}
                      className={cn(
                        "font-medium underline-offset-4 hover:underline",
                        record.voided !== null && "line-through",
                      )}
                    >
                      {formatDateTime(record.submittedAt)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {record.submittedBy?.name ?? ""}
                  </td>
                  {columns.map((field) => (
                    <td
                      key={field.id}
                      className={cn(
                        "px-4 py-2.5",
                        record.nonConforming.includes(field.id) && "font-medium text-danger",
                      )}
                    >
                      {answerText(field, record.answers[field.id], record.people) ?? "—"}
                    </td>
                  ))}
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      {record.voided !== null ? (
                        <Badge tone="neutral">{t.records.voided}</Badge>
                      ) : record.nonConforming.length > 0 ? (
                        <Badge tone="warning">
                          {t.records.nonConforming(record.nonConforming.length)}
                        </Badge>
                      ) : (
                        <Badge tone="success">{t.records.conforming}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {t.records.version(record.version)}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.items.length > 0 && (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          {t.records.count(list.items.length, list.total)}
        </p>
      )}
      <LoadMore
        hasNextPage={list.query.hasNextPage}
        isFetching={list.query.isFetchingNextPage}
        onLoadMore={list.loadMore}
      />
    </Card>
  );
}

/** /app/:slug/files/:spaceId/form/:formId/r/:recordId */
export function RecordPage() {
  const { workspaceSlug = "", spaceId = "", formId = "", recordId = "" } = useParams();
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  // A non-conforming inspection gets preventive measures from here (safety module on, safety.manage).
  const membership = useMembership();
  const [planning, setPlanning] = useState(false);
  const canPlan =
    membership.workspace.safety.enabled && membership.capabilities.includes("safety.manage");
  const form = useQuery({
    queryKey: formsKeys.form(workspaceSlug, formId),
    queryFn: () => formsApi.get(workspaceSlug, formId),
    select: (data) => data.form,
  });
  const detail = useQuery({
    queryKey: recordsKeys.record(workspaceSlug, formId, recordId),
    queryFn: () => recordsApi.get(workspaceSlug, formId, recordId),
  });
  if (detail.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={t.record.loadError}>
          {adminErrorText(detail.error)}
        </EmptyState>
      </Card>
    );
  }
  if (detail.data === undefined) return <Skeleton className="mx-auto h-96 w-full max-w-2xl" />;
  const { record, fields, files, canVoid } = detail.data;
  const confirmVoid = async () => {
    // Shown inside the dialog, which stays open (the server checks it again).
    if (reason.trim().length < 3)
      throw new ApiError(400, "VALIDATION_ERROR", t.record.void.tooShort);
    await recordsApi.void(workspaceSlug, formId, recordId, reason.trim());
    toast.success(t.record.void.done);
    setReason("");
    await queryClient.invalidateQueries({ queryKey: recordsKeys.list(workspaceSlug, formId) });
    await queryClient.invalidateQueries({ queryKey: formsKeys.pending(workspaceSlug) });
  };
  const name = form.data?.node.name ?? "";
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-2xl gap-4">
      <div className="grid gap-2">
        <Link
          to={`/app/${workspaceSlug}/files/${spaceId}/form/${formId}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {name}
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="min-w-0 flex-1 break-words text-xl font-semibold tracking-tight">
            {t.record.title(name)}
          </h1>
          {canPlan && record.voided === null && record.nonConforming.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPlanning(true);
              }}
            >
              <ListChecks className="size-4" aria-hidden="true" />
              {texts.safety.planning.fromRecord}
            </Button>
          )}
          <RecordNcButton
            recordId={recordId}
            nonConforming={record.voided === null && record.nonConforming.length > 0}
            canHandle={canVoid}
          />
          {canVoid && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setVoiding(true);
              }}
            >
              <Ban className="size-4" aria-hidden="true" />
              {t.record.void.action}
            </Button>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>
            {t.record.by(record.submittedBy?.name ?? "", formatDateTime(record.submittedAt))}
          </span>
          <span>{t.record.filledWith(record.version)}</span>
          {record.source === "qr" && (
            <span className="inline-flex items-center gap-1">
              <QrCode className="size-3.5" aria-hidden="true" />
              {t.record.fromQr}
            </span>
          )}
        </p>
      </div>
      {record.voided !== null && (
        <Banner tone="warning">
          {t.record.voidedBanner(
            formatDateTime(record.voided.at),
            record.voided.by?.name ?? "",
            record.voided.reason,
          )}
        </Banner>
      )}
      <Card className="divide-y divide-border p-0">
        {fields.map((field) => (
          <AnswerRow
            key={field.id}
            field={field}
            answer={record.answers[field.id]}
            failing={record.nonConforming.includes(field.id)}
            fileIds={files.filter((file) => file.fieldId === field.id).map((file) => file.id)}
            people={record.people}
          />
        ))}
      </Card>
      <p className="text-xs text-muted-foreground">{t.record.immutable}</p>
      <Dialog open={planning} onOpenChange={setPlanning}>
        {planning && (
          <ActionDialog
            from={{
              origin: "INSPECTION",
              recordId,
              label: `${name} · ${formatDateTime(record.submittedAt)}`,
            }}
            onClose={() => {
              setPlanning(false);
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={voiding}
        onOpenChange={setVoiding}
        icon={Ban}
        tone="warning"
        title={t.record.void.title}
        description={
          // The description is a <p>: only phrasing content (a label wrapping the text box) fits.
          <span className="grid gap-3">
            <span>{t.record.void.description}</span>
            <label className="grid gap-1.5 text-foreground">
              <span className="text-sm font-medium">{t.record.void.reason}</span>
              <Textarea
                maxLength={500}
                className="min-h-20"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
              <span className="text-xs text-muted-foreground">{t.record.void.reasonHint}</span>
            </label>
          </span>
        }
        confirmLabel={t.record.void.confirm}
        pendingLabel={t.record.void.pending}
        onConfirm={confirmVoid}
      />
    </div>
  );
}

/** Numbers as the app's language writes them («6,5» in Spanish). */
const numberFormat = () => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });

function answerText(
  field: FormField,
  answer: Answer | undefined,
  people: Record<string, string>,
): string | null {
  if (answer === undefined) return null;
  switch (field.type) {
    case "number":
      return `${typeof answer === "number" ? numberFormat().format(answer) : String(answer)}${field.unit === undefined ? "" : ` ${field.unit}`}`;
    case "yesno":
      return answer === "yes" ? t.fill.yes : t.fill.no;
    case "choice":
      return field.options.find((option) => option.id === answer)?.label ?? String(answer);
    case "text":
    case "date":
      return String(answer);
    case "person":
      return typeof answer === "string" ? (people[answer] ?? null) : null;
    default:
      return null;
  }
}

function AnswerRow({
  field,
  answer,
  failing,
  fileIds,
  people,
}: {
  field: FormField;
  answer: Answer | undefined;
  failing: boolean;
  fileIds: string[];
  people: Record<string, string>;
}) {
  const text = answerText(field, answer, people);
  return (
    <div className={cn("grid gap-1.5 px-4 py-3", failing && "bg-warning-soft/40")}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {field.label}
        {failing && (
          <Badge tone="warning">
            <AlertTriangle className="mr-1 inline size-3" aria-hidden="true" />
            {t.record.nonConforming}
          </Badge>
        )}
      </p>
      {field.type === "checklist" ? (
        <ul className="grid gap-1 text-sm">
          {field.items.map((item) => {
            const done = Array.isArray(answer) && answer.includes(item.id);
            return (
              <li key={item.id} className={cn(!done && "text-danger")}>
                {done ? "✓" : "✗"} {item.label}{" "}
                <span className="text-xs text-muted-foreground">
                  ({done ? t.record.checked : t.record.unchecked})
                </span>
              </li>
            );
          })}
        </ul>
      ) : field.type === "photo" || field.type === "signature" ? (
        fileIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.record.noAnswer}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {fileIds.map((fileId) => (
              <RecordImage key={fileId} fileId={fileId} signature={field.type === "signature"} />
            ))}
          </div>
        )
      ) : (
        <p className={cn("text-sm", text === null && "text-muted-foreground")}>
          {text ?? t.record.noAnswer}
        </p>
      )}
    </div>
  );
}

function RecordImage({ fileId, signature }: { fileId: string; signature: boolean }) {
  const { workspaceSlug = "", formId = "", recordId = "" } = useParams();
  // Short-lived URLs: asked again after a while instead of kept.
  const url = useQuery({
    queryKey: recordsKeys.file(workspaceSlug, formId, recordId, fileId),
    queryFn: () => recordsApi.fileUrl(workspaceSlug, formId, recordId, fileId),
    select: (data) => data.url,
    staleTime: 30_000,
  });
  if (url.data === undefined) return <Skeleton className={signature ? "h-24 w-56" : "size-32"} />;
  return (
    <a href={url.data} target="_blank" rel="noreferrer" className="block">
      <img
        src={url.data}
        alt=""
        className={cn(
          "rounded-lg border border-border bg-white",
          signature ? "h-24 w-auto" : "size-32 object-cover",
        )}
      />
    </a>
  );
}
