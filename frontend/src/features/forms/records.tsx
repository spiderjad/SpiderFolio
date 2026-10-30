// A form's records (docs/spec/formularios.md): the list on the form's screen (each person's own, or
// all of them for whoever edits the form) and one record, read only, with the fields of the version
// it was filled with, what was non-conforming, its photos and its signature.
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ClipboardCheck, QrCode, ServerCrash } from "lucide-react";
import { Link, useParams } from "react-router";
import { Badge, Banner, Card, EmptyState, Skeleton } from "@/components/ui/display";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { adminErrorText } from "@/features/admin/admin-utils";
import { cn, formatDateTime } from "@/lib/utils";
import {
  formsApi,
  formsKeys,
  recordsApi,
  recordsKeys,
  type Answer,
  type FormField,
} from "./forms-api";
import { locale, texts } from "@/i18n";

const t = texts.forms;

export function RecordsList({
  formId,
  spaceId,
  seesAll,
}: {
  formId: string;
  spaceId: string;
  seesAll: boolean;
}) {
  const { workspaceSlug = "" } = useParams();
  const list = useInfiniteList({
    queryKey: recordsKeys.list(workspaceSlug, formId),
    fetchPage: (cursor, signal) => recordsApi.list(workspaceSlug, formId, cursor, signal),
  });
  const base = `/app/${workspaceSlug}/files/${spaceId}/form/${formId}/r`;
  return (
    <Card className="grid gap-3 p-0">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 font-medium">
          <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden="true" />
          {seesAll ? t.records.title : t.records.mineTitle}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {seesAll ? t.records.hintAll : t.records.hintMine}
        </p>
      </div>
      {list.query.isPending ? (
        <Skeleton className="mx-4 mb-4 h-20" />
      ) : list.items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">{t.records.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.items.map((record) => (
            <li key={record.id}>
              <Link
                to={`${base}/${record.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
              >
                <span className="text-sm font-medium">{formatDateTime(record.submittedAt)}</span>
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {record.submittedBy?.name ?? ""}
                </span>
                <span className="ml-auto flex items-center gap-2">
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
              </Link>
            </li>
          ))}
        </ul>
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
  const { record, fields, files } = detail.data;
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
        <h1 className="break-words text-xl font-semibold tracking-tight">{t.record.title(name)}</h1>
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
          {t.records.voided}: {record.voided.reason}
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
          />
        ))}
      </Card>
      <p className="text-xs text-muted-foreground">{t.record.immutable}</p>
    </div>
  );
}

/** Numbers as the app's language writes them («6,5» in Spanish). */
const numberFormat = () => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });

function answerText(field: FormField, answer: Answer | undefined): string | null {
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
    default:
      return null;
  }
}

function AnswerRow({
  field,
  answer,
  failing,
  fileIds,
}: {
  field: FormField;
  answer: Answer | undefined;
  failing: boolean;
  fileIds: string[];
}) {
  const text = answerText(field, answer);
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
