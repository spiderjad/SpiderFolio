// /app/:slug/calidad/proveedores/:supplierId — one supplier (docs/spec/calidad.md, «Fase 4»): its details,
// risk and fraud assessment, its documents with their expiry, its reviews and its nonconformities.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ClipboardCheck,
  FolderOpen,
  Pencil,
  Plus,
  ServerCrash,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox, useStaticSource, type ComboboxSource } from "@/components/ui/combobox";
import { Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import { CreateDialog } from "./ncs-page";
import {
  SUPPLIER_DOC_KINDS,
  qualityKeys,
  supplierKeys,
  suppliersApi,
  type SupplierDetail,
  type SupplierDocKind,
} from "./quality-api";
import { NcStatusBadge, SeverityBadge, todayDay } from "./quality-common";
import { SupplierDialog } from "./supplier-dialog";
import { DocStateBadge, RiskBadge, SupplierStatusBadge } from "./suppliers-page";
import { texts } from "@/i18n";

const t = texts.quality.suppliers;
const d = t.detail;
const RESULTS = ["APPROVED", "CONDITIONAL", "BLOCKED"] as const;
const SCORES = ["quality", "service", "documents", "incidents"] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{children}</dd>
    </div>
  );
}

function DocDialog({ supplier, onClose }: { supplier: SupplierDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const f = d.docs.form;
  const kinds = useStaticSource(
    "quality-supplier-doc-kinds",
    SUPPLIER_DOC_KINDS.map((id) => ({ id, label: t.docKinds[id] })),
  );
  const files = useQuery({
    queryKey: supplierKeys.files(workspaceSlug, supplier.id),
    queryFn: () => suppliersApi.files(workspaceSlug, supplier.id),
    select: (data) => data.items,
  });
  const fileSource: ComboboxSource = {
    key: [...supplierKeys.files(workspaceSlug, supplier.id), String(files.dataUpdatedAt)],
    search: (q) =>
      Promise.resolve({
        items: (files.data ?? [])
          .filter((file) => file.name.toLowerCase().includes(q.trim().toLowerCase()))
          .map((file) => ({ id: file.id, label: file.name })),
        nextCursor: null,
      }),
    byIds: () => Promise.resolve([]),
  };
  const [kind, setKind] = useState<SupplierDocKind>("CERT_IFS");
  const [name, setName] = useState("");
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [validUntil, setValidUntil] = useState("");
  const save = useMutation({
    mutationFn: () =>
      suppliersApi.addDoc(workspaceSlug, supplier.id, {
        kind,
        name: name.trim(),
        nodeId: file?.id ?? null,
        validUntil: validUntil === "" ? null : validUntil,
      }),
    onSuccess: async () => {
      toast.success(f.created);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={f.title}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={name.trim() === "" || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : texts.admin.common.create}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.kind}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.kind}
                placeholder={f.kind}
                source={kinds}
                value={kind}
                onChange={(option) => {
                  const next = SUPPLIER_DOC_KINDS.find((id) => id === option?.id);
                  if (next !== undefined) setKind(next);
                }}
              />
            )}
          </FormField>
          <FormField label={f.validUntil}>
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
        </div>
        <FormField label={f.name}>
          {(control) => (
            <Input
              {...control}
              maxLength={160}
              placeholder={f.namePlaceholder}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label={f.file}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={f.file}
              placeholder={f.filePlaceholder}
              source={fileSource}
              value={file?.id ?? null}
              valueLabel={file?.name}
              onChange={(option) => {
                setFile(option === null ? null : { id: option.id, name: option.label });
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

function ReviewDialog({ supplier, onClose }: { supplier: SupplierDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const f = d.reviews.form;
  const results = useStaticSource(
    "quality-supplier-results",
    RESULTS.map((id) => ({ id, label: t.statuses[id] })),
  );
  const [reviewedOn, setReviewedOn] = useState(todayDay());
  const [scores, setScores] = useState({ quality: 4, service: 4, documents: 4, incidents: 4 });
  const [result, setResult] = useState<(typeof RESULTS)[number]>("APPROVED");
  const [note, setNote] = useState("");
  const openNcs = supplier.ncs.filter(
    (nc) => nc.status !== "CLOSED" && nc.status !== "CANCELLED",
  ).length;
  const save = useMutation({
    mutationFn: () =>
      suppliersApi.review(workspaceSlug, supplier.id, {
        reviewedOn,
        scores,
        result,
        note: note.trim(),
      }),
    onSuccess: async () => {
      toast.success(f.created);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      title={f.title}
      description={f.ncsHint(openNcs)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={save.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={note.trim() === "" || reviewedOn === "" || save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {save.isPending ? texts.admin.common.saving : d.reviews.add}
          </Button>
        </>
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.reviewedOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={reviewedOn}
                onChange={(event) => {
                  setReviewedOn(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.result}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                searchable={false}
                label={f.result}
                placeholder={f.result}
                source={results}
                value={result}
                onChange={(option) => {
                  const next = RESULTS.find((id) => id === option?.id);
                  if (next !== undefined) setResult(next);
                }}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          {SCORES.map((key) => (
            <FormField key={key} label={d.reviews.scores[key]}>
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={1}
                  max={5}
                  value={scores[key]}
                  onChange={(event) => {
                    const value = Math.min(5, Math.max(1, Number(event.target.value) || 1));
                    setScores({ ...scores, [key]: value });
                  }}
                />
              )}
            </FormField>
          ))}
        </div>
        <FormField label={f.note}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="min-h-16"
              maxLength={1000}
              placeholder={f.notePlaceholder}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          )}
        </FormField>
      </FormGrid>
    </DialogContent>
  );
}

export function SupplierPage() {
  const { workspaceSlug = "", supplierId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: supplierKeys.one(workspaceSlug, supplierId),
    queryFn: () => suppliersApi.get(workspaceSlug, supplierId),
    select: (data) => data.supplier,
  });
  const [dialog, setDialog] = useState<"edit" | "doc" | "review" | "nc" | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
  const archive = useMutation({
    mutationFn: (archived: boolean) => suppliersApi.archive(workspaceSlug, supplierId, archived),
    onSuccess: async (_result, archived) => {
      toast.success(archived ? d.archived : d.restored);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const archiveDoc = useMutation({
    mutationFn: (docId: string) => suppliersApi.archiveDoc(workspaceSlug, docId),
    onSuccess: refresh,
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const folder = useMutation({
    mutationFn: () => suppliersApi.folder(workspaceSlug, supplierId),
    onSuccess: async ({ folder: target }) => {
      await navigate(`/app/${workspaceSlug}/files/${target.spaceId}/f/${target.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const back = (
    <Link
      to={`/app/${workspaceSlug}/calidad/proveedores`}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {d.back}
    </Link>
  );
  if (query.isError) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        {back}
        <Card>
          <EmptyState icon={ServerCrash}>{adminErrorText(query.error)}</EmptyState>
        </Card>
      </div>
    );
  }
  const supplier = query.data;
  if (supplier === undefined) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        {back}
        <Skeleton className="h-40" />
      </div>
    );
  }
  const manage = supplier.access === "manage";
  const canDocs = supplier.access !== "read" && !supplier.archived;
  const activeDocs = supplier.docs.filter((doc) => !doc.archived);
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-4">
      <div className="grid gap-2">
        {back}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{t.categories[supplier.category]}</p>
            <h1 className="break-words text-xl font-semibold tracking-tight">{supplier.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SupplierStatusBadge status={supplier.status} />
              <RiskBadge risk={supplier.risk} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {manage && !supplier.archived && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialog("edit");
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
                {d.edit}
              </Button>
            )}
            {canDocs && (
              <Button
                variant="outline"
                size="sm"
                disabled={folder.isPending}
                onClick={() => {
                  if (supplier.folder !== null) {
                    void navigate(
                      `/app/${workspaceSlug}/files/${supplier.folder.spaceId}/f/${supplier.folder.id}`,
                    );
                  } else folder.mutate();
                }}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                {d.folder}
              </Button>
            )}
            {manage && (
              <Button
                variant="outline"
                size="sm"
                disabled={archive.isPending}
                onClick={() => {
                  archive.mutate(!supplier.archived);
                }}
              >
                {supplier.archived ? (
                  <ArchiveRestore className="size-4" aria-hidden="true" />
                ) : (
                  <Archive className="size-4" aria-hidden="true" />
                )}
                {supplier.archived ? d.restore : d.archive}
              </Button>
            )}
          </div>
        </div>
      </div>
      {supplier.archived && <Banner tone="warning">{d.archivedBanner}</Banner>}
      <Card className="grid gap-3 p-4 sm:p-5">
        <dl className="grid gap-3">
          <Row label={d.supplies}>{supplier.supplies}</Row>
          <Row label={d.taxId}>{supplier.taxId ?? d.none}</Row>
          <Row label={d.contact}>{supplier.contact ?? d.none}</Row>
          <Row label={d.owner}>{supplier.owner?.name ?? d.none}</Row>
          <Row label={d.fraud}>
            <span className="inline-flex flex-wrap items-center gap-2">
              <RiskBadge risk={supplier.fraudRisk} />
              {supplier.fraudNote !== null && <span>{supplier.fraudNote}</span>}
            </span>
          </Row>
          <Row label={d.nextReview}>
            {supplier.nextReviewOn === null ? (
              d.none
            ) : (
              <span className={supplier.reviewDue ? "text-danger" : undefined}>
                {formatUtcDate(supplier.nextReviewOn)}
              </span>
            )}
          </Row>
        </dl>
      </Card>
      <Card className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{d.docs.title}</CardTitle>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">{d.docs.hint}</p>
          </div>
          {canDocs && (
            <Button
              size="sm"
              onClick={() => {
                setDialog("doc");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {d.docs.add}
            </Button>
          )}
        </div>
        {activeDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.docs.empty}</p>
        ) : (
          <ul className="-my-2 divide-y divide-border">
            {activeDocs.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {doc.file === null ? (
                      doc.name
                    ) : (
                      <Link
                        to={`/app/${workspaceSlug}/files/${doc.file.spaceId}${doc.file.parentId === null ? "" : `/f/${doc.file.parentId}`}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {doc.name}
                      </Link>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t.docKinds[doc.kind]}
                    {doc.validUntil !== null && ` · ${d.docs.until(formatUtcDate(doc.validUntil))}`}
                  </p>
                </div>
                <DocStateBadge state={doc.state} />
                {canDocs && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={d.docs.archive(doc.name)}
                    disabled={archiveDoc.isPending}
                    onClick={() => {
                      archiveDoc.mutate(doc.id);
                    }}
                  >
                    <Archive className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{d.reviews.title}</CardTitle>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">{d.reviews.hint}</p>
          </div>
          {manage && !supplier.archived && (
            <Button
              size="sm"
              onClick={() => {
                setDialog("review");
              }}
            >
              <ClipboardCheck className="size-4" aria-hidden="true" />
              {d.reviews.add}
            </Button>
          )}
        </div>
        {supplier.reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.reviews.empty}</p>
        ) : (
          <ul className="grid gap-2">
            {supplier.reviews.map((review) => (
              <li key={review.id} className="rounded-lg bg-muted/50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <SupplierStatusBadge status={review.result} />
                  <span className="text-xs text-muted-foreground">
                    {formatUtcDate(review.reviewedOn)} · {review.by.name}
                  </span>
                </div>
                <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {SCORES.map((key) => (
                    <span key={key}>
                      {d.reviews.scores[key]}: {String(review.scores[key] ?? "—")}/5
                    </span>
                  ))}
                </p>
                <p className="mt-1.5 whitespace-pre-wrap break-words">{review.note}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle>{d.ncs.title}</CardTitle>
          {manage && !supplier.archived && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDialog("nc");
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {d.ncs.open}
            </Button>
          )}
        </div>
        {supplier.ncs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{d.ncs.empty}</p>
        ) : (
          <ul className="-my-2 divide-y divide-border">
            {supplier.ncs.map((nc) => (
              <li key={nc.id}>
                <Link
                  to={`/app/${workspaceSlug}/calidad/no-conformidades/${nc.id}`}
                  className="flex min-h-12 flex-wrap items-center gap-3 py-2 text-sm hover:text-primary"
                >
                  <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {nc.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{nc.title}</span>
                  <SeverityBadge severity={nc.severity} />
                  <NcStatusBadge status={nc.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        {dialog === "edit" && (
          <SupplierDialog
            supplier={supplier}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
        {dialog === "doc" && (
          <DocDialog
            supplier={supplier}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
        {dialog === "review" && (
          <ReviewDialog
            supplier={supplier}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
        {dialog === "nc" && (
          <CreateDialog
            supplier={{ id: supplier.id, name: supplier.name }}
            onClose={() => {
              setDialog(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
