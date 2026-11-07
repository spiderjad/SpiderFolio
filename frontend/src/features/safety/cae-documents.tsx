// CAE documents in the records of a company or a worker (docs/spec/cae.md, «Pantallas»): each required
// document with its state, the current file (opened like any file: it needs access to the folder),
// upload with the normal upload queue into the company's (or worker's) folder, accept, reject and the
// history. Plus the «Por revisar» counter.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, History, Upload, XCircle } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { filesApi } from "@/features/files/api";
import { useUploads } from "@/features/files/uploads";
import { formatDateTime, formatUtcDate } from "@/lib/utils";
import {
  caeApi,
  caeKeys,
  type CaeDocument,
  type CaeDocumentRef,
  type CaeRequirementStatus,
} from "./cae-api";
import { RequirementStateBadge } from "./cae-common";
import { texts } from "@/i18n";

const t = texts.cae.documents;

/** Opens the file in a new tab (the server checks access to it). */
export async function openCaeFile(slug: string, nodeId: string): Promise<void> {
  try {
    const ticket = await filesApi.download(slug, nodeId, { inline: true });
    const link = document.createElement("a");
    link.href = ticket.url;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    toast.error(adminErrorText(error));
  }
}

/** «YYYY-MM-DD» today plus some months, in the browser (the server proposes the same). */
function monthsFromToday(months: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), last));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(target.getFullYear())}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

interface Subject {
  companyId: string;
  workerId: string | null;
}

type Action =
  | { kind: "upload"; item: CaeRequirementStatus }
  | { kind: "accept"; item: CaeRequirementStatus; doc: CaeDocumentRef }
  | { kind: "reject"; item: CaeRequirementStatus; doc: CaeDocumentRef }
  | { kind: "history"; item: CaeRequirementStatus }
  | null;

function FileLink({ doc }: { doc: CaeDocumentRef }) {
  const { workspaceSlug = "" } = useParams();
  if (doc.fileName === null) {
    return <span className="text-xs text-muted-foreground">{t.trashed}</span>;
  }
  return (
    <button
      type="button"
      className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
      aria-label={t.view(doc.fileName)}
      onClick={() => {
        void openCaeFile(workspaceSlug, doc.nodeId);
      }}
    >
      <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="truncate">{doc.fileName}</span>
    </button>
  );
}

/** The required documents of a company or a worker, with what can be done with each. */
export function DocumentRequirementsCard({
  title,
  hint,
  empty,
  requirements,
  subject,
  canManage,
}: {
  title: string;
  hint: string;
  empty: string;
  requirements: CaeRequirementStatus[];
  subject: Subject;
  canManage: boolean;
}) {
  const [action, setAction] = useState<Action>(null);
  const company = texts.cae.company;
  const close = () => {
    setAction(null);
  };
  return (
    <Card className="p-4 sm:p-5">
      <CardTitle className="text-base">{title}</CardTitle>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {requirements.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {requirements.map((item) => {
            const { current, latest } = item;
            const pending = latest?.status === "PENDING" ? latest : null;
            return (
              <li key={item.requirement.id} className="grid gap-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.requirement.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        item.requirement.required ? null : company.optional,
                        item.requirement.validityMonths === null
                          ? null
                          : company.validity(item.requirement.validityMonths),
                      ]
                        .filter((value): value is string => value !== null)
                        .join(" · ")}
                    </p>
                  </div>
                  <RequirementStateBadge state={item.state} />
                </div>
                {current !== null && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <FileLink doc={current} />
                    <span className="text-xs text-muted-foreground">
                      {current.validUntil === null
                        ? t.noExpiry
                        : t.validUntilShort(formatUtcDate(current.validUntil))}
                    </span>
                  </div>
                )}
                {latest !== null && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge tone={latest.status === "PENDING" ? "primary" : "danger"}>
                      {t.statuses[latest.status]}
                    </Badge>
                    <FileLink doc={latest} />
                    {latest.status === "REJECTED" && latest.rejectReason !== null && (
                      <span className="text-xs text-muted-foreground">
                        {t.rejectedBecause(latest.rejectReason)}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAction({ kind: "upload", item });
                      }}
                    >
                      <Upload className="size-4" strokeWidth={1.75} aria-hidden="true" />
                      {t.upload}
                    </Button>
                  )}
                  {canManage && pending !== null && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAction({ kind: "accept", item, doc: pending });
                        }}
                      >
                        <CheckCircle2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        {t.accept}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAction({ kind: "reject", item, doc: pending });
                        }}
                      >
                        <XCircle className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        {t.reject}
                      </Button>
                    </>
                  )}
                  {(current !== null || latest !== null) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAction({ kind: "history", item });
                      }}
                    >
                      <History className="size-4" strokeWidth={1.75} aria-hidden="true" />
                      {t.history}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {action?.kind === "upload" && (
          <UploadDocumentDialog item={action.item} subject={subject} onClose={close} />
        )}
        {action?.kind === "accept" && (
          <AcceptDocumentDialog
            documentId={action.doc.id}
            requirement={action.item.requirement.name}
            validUntil={action.doc.validUntil}
            onClose={close}
          />
        )}
        {action?.kind === "reject" && (
          <RejectDocumentDialog
            documentId={action.doc.id}
            requirement={action.item.requirement.name}
            onClose={close}
          />
        )}
        {action?.kind === "history" && (
          <HistoryDialog requirement={action.item.requirement} subject={subject} />
        )}
      </Dialog>
    </Card>
  );
}

/**
 * Picks the file and its validity, uploads it with the normal upload queue to the company's (or the
 * worker's) folder and, once uploaded, gives it for the requirement.
 */
function UploadDocumentDialog({
  item,
  subject,
  onClose,
}: {
  item: CaeRequirementStatus;
  subject: Subject;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const uploads = useUploads();
  const [file, setFile] = useState<File | null>(null);
  const [validUntil, setValidUntil] = useState(
    item.requirement.validityMonths === null
      ? ""
      : monthsFromToday(item.requirement.validityMonths),
  );
  const [accept, setAccept] = useState(false);
  const start = useMutation({
    mutationFn: async () => {
      const { target } =
        subject.workerId === null
          ? await caeApi.companyFolder(workspaceSlug, subject.companyId)
          : await caeApi.workerFolder(workspaceSlug, subject.workerId);
      return target;
    },
    onSuccess: (target) => {
      if (file === null) return;
      const body = {
        requirementId: item.requirement.id,
        companyId: subject.companyId,
        workerId: subject.workerId,
        validUntil: validUntil === "" ? null : validUntil,
        accept,
      };
      uploads.enqueue(
        [file],
        { spaceId: target.spaceId, parentId: target.folderId },
        undefined,
        (node) => {
          caeApi
            .createDocument(workspaceSlug, { ...body, nodeId: node.id })
            .then(async () => {
              toast.success(accept ? t.uploadedAccepted : t.uploaded);
              await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
            })
            .catch((error: unknown) => {
              toast.error(adminErrorText(error));
            });
        },
      );
      toast(t.uploading);
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={t.uploadTitle(item.requirement.name)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={start.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={file === null || start.isPending}
            onClick={() => {
              start.mutate();
            }}
          >
            {t.upload}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.file} hint={t.fileHint}>
          {(control) => (
            <Input
              {...control}
              type="file"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
            />
          )}
        </FormField>
        <FormField label={t.validUntil} hint={t.validUntilHint}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={validUntil}
              onChange={(event) => {
                setValidUntil(event.target.value);
              }}
            />
          )}
        </FormField>
        <Checkbox
          label={t.acceptNow}
          checked={accept}
          onChange={(event) => {
            setAccept(event.target.checked);
          }}
        />
      </FormGrid>
    </DialogContent>
  );
}

export function AcceptDocumentDialog({
  documentId,
  requirement,
  validUntil: proposed,
  onClose,
}: {
  documentId: string;
  requirement: string;
  validUntil: string | null;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [validUntil, setValidUntil] = useState(proposed ?? "");
  const accept = useMutation({
    mutationFn: () =>
      caeApi.acceptDocument(workspaceSlug, documentId, validUntil === "" ? null : validUntil),
    onSuccess: async () => {
      toast.success(t.accepted);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={t.acceptTitle(requirement)}
      description={t.acceptHint}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={accept.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate();
            }}
          >
            {t.accept}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.validUntil} hint={t.validUntilHint}>
          {(control) => (
            <Input
              {...control}
              type="date"
              value={validUntil}
              onChange={(event) => {
                setValidUntil(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

export function RejectDocumentDialog({
  documentId,
  requirement,
  onClose,
}: {
  documentId: string;
  requirement: string;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const reject = useMutation({
    mutationFn: () => caeApi.rejectDocument(workspaceSlug, documentId, reason.trim()),
    onSuccess: async () => {
      toast.success(t.rejected);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={t.rejectTitle(requirement)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={reject.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={reject.isPending || reason.trim().length < 3}
            onClick={() => {
              reject.mutate();
            }}
          >
            {t.reject}
          </Button>
        </>
      }
    >
      <FormGrid>
        <FormField label={t.reason} hint={t.reasonHint}>
          {(control) => (
            <Textarea
              {...control}
              value={reason}
              rows={3}
              maxLength={500}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

function HistoryDialog({
  requirement,
  subject,
}: {
  requirement: CaeRequirementStatus["requirement"];
  subject: Subject;
}) {
  const { workspaceSlug = "" } = useParams();
  const filters =
    subject.workerId === null
      ? { requirementId: requirement.id, companyId: subject.companyId }
      : { requirementId: requirement.id, workerId: subject.workerId };
  const list = useInfiniteList<CaeDocument>({
    queryKey: caeKeys.documents(workspaceSlug, filters),
    fetchPage: (cursor, signal) => caeApi.documents(workspaceSlug, filters, cursor, signal),
  });
  return (
    <DialogContent title={t.historyTitle(requirement.name)} size="lg">
      {!list.query.isPending && list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.items.map((doc) => (
            <li key={doc.id} className="grid gap-1 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    doc.status === "ACCEPTED" && !doc.superseded
                      ? "success"
                      : doc.status === "PENDING"
                        ? "primary"
                        : doc.status === "REJECTED"
                          ? "danger"
                          : "neutral"
                  }
                >
                  {doc.superseded ? t.superseded : t.statuses[doc.status]}
                </Badge>
                <FileLink
                  doc={{
                    id: doc.id,
                    nodeId: doc.file.id,
                    fileName: doc.file.name,
                    status: doc.status,
                    validUntil: doc.validUntil,
                    rejectReason: doc.rejectReason,
                    createdAt: doc.createdAt,
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {doc.validUntil === null
                    ? t.noExpiry
                    : t.validUntilShort(formatUtcDate(doc.validUntil))}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t.givenBy(doc.createdBy.name, formatDateTime(doc.createdAt))}
                {doc.reviewed !== null &&
                  ` · ${t.reviewedBy(doc.reviewed.by.name, formatDateTime(doc.reviewed.at))}`}
              </p>
              {doc.rejectReason !== null && (
                <p className="text-xs text-muted-foreground">
                  {t.rejectedBecause(doc.rejectReason)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={list.query.hasNextPage}
        isFetching={list.query.isFetchingNextPage}
        onLoadMore={list.loadMore}
      />
    </DialogContent>
  );
}
