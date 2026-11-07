// /app/:slug/calidad/productos/:productId — a product's technical sheet, its shelf life studies and its
// labels with their review (docs/spec/calidad.md, «Fase 6b»). quality.manage edits, sends labels to
// review and reviews them; quality.view reads.
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
import { Combobox, useStaticSource } from "@/components/ui/combobox";
import { Badge, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import { allergenList, LabelStateBadge, ProductDialog, useProductFiles } from "./products-page";
import {
  LABEL_CHECKS,
  NUTRITION_FIELDS,
  OPTIONAL_LABEL_CHECKS,
  SEVERITIES,
  productKeys,
  productsApi,
  qualityKeys,
  type LabelCheck,
  type LabelCheckValue,
  type ProductDetail,
  type ProductLabel,
  type Severity,
  type ShelfLifeStudy,
} from "./quality-api";
import { todayDay } from "./quality-common";
import { texts } from "@/i18n";

const t = texts.quality.products;
const studyTone = { PENDING: "neutral", PASSED: "success", FAILED: "danger" } as const;
const labelTone = {
  IN_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUPERSEDED: "neutral",
} as const;

function useRefresh(onClose: () => void) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  return {
    done: async (message: string) => {
      toast.success(message);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error: unknown) => {
      toast.error(adminErrorText(error));
    },
  };
}

function Footer({
  pending,
  ready,
  label,
  onSave,
}: {
  pending: boolean;
  ready: boolean;
  label: string;
  onSave: () => void;
}) {
  return (
    <>
      <DialogClose asChild>
        <Button variant="outline" disabled={pending}>
          {texts.admin.common.cancel}
        </Button>
      </DialogClose>
      <Button disabled={!ready || pending} onClick={onSave}>
        {pending ? texts.admin.common.saving : label}
      </Button>
    </>
  );
}

function StudyDialog({ product, onClose }: { product: ProductDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const f = t.studies.form;
  const [startedOn, setStartedOn] = useState(todayDay());
  const [targetDays, setTargetDays] = useState(String(product.shelfLifeDays ?? 30));
  const [listeria, setListeria] = useState(product.readyToEat);
  const refresh = useRefresh(onClose);
  const save = useMutation({
    mutationFn: () =>
      productsApi.addStudy(workspaceSlug, product.id, {
        startedOn,
        targetDays: Number(targetDays),
        listeria,
      }),
    onSuccess: () => refresh.done(f.created),
    onError: refresh.onError,
  });
  const days = Number(targetDays);
  return (
    <DialogContent
      title={f.title}
      footer={
        <Footer
          pending={save.isPending}
          ready={startedOn !== "" && Number.isInteger(days) && days >= 1 && days <= 3650}
          label={texts.admin.common.create}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={f.startedOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={startedOn}
                onChange={(event) => {
                  setStartedOn(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={f.targetDays}>
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                max={3650}
                value={targetDays}
                onChange={(event) => {
                  setTargetDays(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        <Checkbox
          label={f.listeria}
          checked={listeria}
          onChange={(event) => {
            setListeria(event.target.checked);
          }}
        />
      </FormGrid>
    </DialogContent>
  );
}

function StudyResultDialog({
  product,
  study,
  onClose,
}: {
  product: ProductDetail;
  study: ShelfLifeStudy;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const f = t.studies.result;
  const files = useProductFiles(product.id);
  const results = useStaticSource("quality-study-results", [
    { id: "PASSED", label: t.studies.results.PASSED },
    { id: "FAILED", label: t.studies.results.FAILED },
  ]);
  const severities = useStaticSource(
    "quality-study-severities",
    SEVERITIES.map((id) => ({ id, label: texts.quality.severities[id] })),
  );
  const [result, setResult] = useState<"PASSED" | "FAILED">("PASSED");
  const [resultOn, setResultOn] = useState(todayDay());
  const [conclusion, setConclusion] = useState("");
  const [report, setReport] = useState<{ id: string; name: string } | null>(null);
  const [openNc, setOpenNc] = useState(true);
  const [severity, setSeverity] = useState<Severity>("MAJOR");
  const refresh = useRefresh(onClose);
  const save = useMutation({
    mutationFn: () =>
      productsApi.studyResult(workspaceSlug, study.id, {
        result,
        resultOn,
        conclusion: conclusion.trim() === "" ? null : conclusion.trim(),
        reportNodeId: report?.id ?? null,
        openNc: result === "FAILED" && openNc,
        severity,
      }),
    onSuccess: () => refresh.done(f.done),
    onError: refresh.onError,
  });
  return (
    <DialogContent
      title={f.title}
      footer={
        <Footer
          pending={save.isPending}
          ready={resultOn !== ""}
          label={texts.admin.common.save}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <div className="grid gap-4 sm:grid-cols-2">
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
                  if (option !== null) setResult(option.id === "FAILED" ? "FAILED" : "PASSED");
                }}
              />
            )}
          </FormField>
          <FormField label={f.resultOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={resultOn}
                onChange={(event) => {
                  setResultOn(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        <FormField label={f.report}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={f.report}
              placeholder={f.reportPlaceholder}
              source={files}
              value={report?.id ?? null}
              valueLabel={report?.name}
              onChange={(option) => {
                setReport(option === null ? null : { id: option.id, name: option.label });
              }}
            />
          )}
        </FormField>
        <FormField label={f.conclusion}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={1000}
              value={conclusion}
              onChange={(event) => {
                setConclusion(event.target.value);
              }}
            />
          )}
        </FormField>
        {result === "FAILED" && (
          <>
            <Checkbox
              label={f.openNc}
              checked={openNc}
              onChange={(event) => {
                setOpenNc(event.target.checked);
              }}
            />
            {openNc && (
              <FormField label={f.severity}>
                {(control) => (
                  <Combobox
                    id={control.id}
                    aria-describedby={control["aria-describedby"]}
                    searchable={false}
                    label={f.severity}
                    placeholder={f.severity}
                    source={severities}
                    value={severity}
                    onChange={(option) => {
                      const next = SEVERITIES.find((id) => id === option?.id);
                      if (next !== undefined) setSeverity(next);
                    }}
                  />
                )}
              </FormField>
            )}
          </>
        )}
      </FormGrid>
    </DialogContent>
  );
}

function LabelDialog({ product, onClose }: { product: ProductDetail; onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const f = t.labels.form;
  const files = useProductFiles(product.id);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState("");
  const refresh = useRefresh(onClose);
  const save = useMutation({
    mutationFn: () =>
      productsApi.submitLabel(workspaceSlug, product.id, {
        nodeId: file?.id ?? null,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => refresh.done(f.done),
    onError: refresh.onError,
  });
  return (
    <DialogContent
      title={f.title}
      footer={
        <Footer
          pending={save.isPending}
          ready
          label={t.labels.submit}
          onSave={() => {
            save.mutate();
          }}
        />
      }
    >
      <FormGrid>
        <FormField label={f.file}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              clearable
              label={f.file}
              placeholder={f.filePlaceholder}
              source={files}
              value={file?.id ?? null}
              valueLabel={file?.name}
              onChange={(option) => {
                setFile(option === null ? null : { id: option.id, name: option.label });
              }}
            />
          )}
        </FormField>
        <FormField label={f.note}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={1000}
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

/** Where a file of the product lives: its folder (or the space, if the folder is gone). */
function fileHref(slug: string, product: ProductDetail, file: { spaceId: string }): string {
  return product.folder === null
    ? `/app/${slug}/files/${file.spaceId}`
    : `/app/${slug}/files/${product.folder.spaceId}/f/${product.folder.id}`;
}

function SheetSummary({ product }: { product: ProductDetail }) {
  const d = t.detail;
  return (
    <dl className="grid gap-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">{d.ingredients}</dt>
        <dd className="whitespace-pre-wrap break-words">{product.ingredients || "—"}</dd>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{d.allergens}</dt>
          <dd className="font-medium">
            {product.allergens.length === 0 ? d.none : allergenList(product.allergens)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{d.mayContain}</dt>
          <dd>{product.mayContain.length === 0 ? d.none : allergenList(product.mayContain)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{d.shelfLife}</dt>
          <dd className="tabular-nums">
            {product.shelfLifeDays === null ? "—" : t.days(product.shelfLifeDays)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{d.storage}</dt>
          <dd>{product.storage ?? "—"}</dd>
        </div>
      </div>
    </dl>
  );
}

const fullChecks = (
  checks: Partial<Record<LabelCheck, LabelCheckValue>> | null,
): Record<LabelCheck, LabelCheckValue> =>
  Object.fromEntries(LABEL_CHECKS.map((check) => [check, checks?.[check] ?? "missing"])) as Record<
    LabelCheck,
    LabelCheckValue
  >;

function ReviewDialog({
  product,
  label,
  onClose,
}: {
  product: ProductDetail;
  label: ProductLabel;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const f = t.labels.reviewForm;
  const [checks, setChecks] = useState(fullChecks(null));
  const [note, setNote] = useState("");
  const refresh = useRefresh(onClose);
  const review = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") =>
      productsApi.reviewLabel(workspaceSlug, label.id, {
        decision,
        checks,
        reviewNote: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: (_data, decision) => refresh.done(decision === "APPROVE" ? f.approved : f.rejected),
    onError: refresh.onError,
  });
  const complete = LABEL_CHECKS.every(
    (check) =>
      checks[check] === "ok" || (checks[check] === "na" && OPTIONAL_LABEL_CHECKS.includes(check)),
  );
  return (
    <DialogContent
      size="lg"
      title={f.title(label.version)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={review.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            variant="outline"
            disabled={note.trim() === "" || review.isPending}
            onClick={() => {
              review.mutate("REJECT");
            }}
          >
            {f.reject}
          </Button>
          <Button
            disabled={!complete || review.isPending}
            onClick={() => {
              review.mutate("APPROVE");
            }}
          >
            {f.approve}
          </Button>
        </>
      }
    >
      <FormGrid>
        <p className="text-xs text-muted-foreground">{f.intro}</p>
        {label.file !== null && (
          <Link
            to={fileHref(workspaceSlug, product, label.file)}
            className="text-sm underline-offset-4 hover:underline"
          >
            {t.labels.file}: {label.file.name}
          </Link>
        )}
        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <fieldset className="grid gap-2">
            <legend className="sr-only">{f.title(label.version)}</legend>
            {LABEL_CHECKS.map((check) => (
              <div
                key={check}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-b-0"
              >
                <span id={`check-${check}`}>{f.checks[check]}</span>
                <div role="radiogroup" aria-labelledby={`check-${check}`} className="flex gap-1">
                  {(OPTIONAL_LABEL_CHECKS.includes(check)
                    ? (["ok", "missing", "na"] as const)
                    : (["ok", "missing"] as const)
                  ).map((value) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      role="radio"
                      aria-checked={checks[check] === value}
                      variant={checks[check] === value ? "primary" : "outline"}
                      onClick={() => {
                        setChecks({ ...checks, [check]: value });
                      }}
                    >
                      {f.values[value]}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <Card className="grid content-start gap-2 p-3">
            <CardTitle>{f.sheet}</CardTitle>
            <p className="text-xs text-muted-foreground">{t.detail.version(product.specVersion)}</p>
            <SheetSummary product={product} />
          </Card>
        </div>
        <FormField label={f.reviewNote}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              className="min-h-16"
              maxLength={1000}
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

type DialogState =
  | { kind: "edit" }
  | { kind: "study" }
  | { kind: "result"; study: ShelfLifeStudy }
  | { kind: "label" }
  | { kind: "review"; label: ProductLabel }
  | null;

export function ProductPage() {
  const { workspaceSlug = "", productId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const d = t.detail;
  const [dialog, setDialog] = useState<DialogState>(null);
  const query = useQuery({
    queryKey: productKeys.one(workspaceSlug, productId),
    queryFn: () => productsApi.get(workspaceSlug, productId),
    select: (data) => data.product,
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => productsApi.archive(workspaceSlug, productId, archived),
    onSuccess: async (_data, archived) => {
      toast.success(archived ? d.archivedDone : d.restoredDone);
      await queryClient.invalidateQueries({ queryKey: qualityKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const folder = useMutation({
    mutationFn: () => productsApi.folder(workspaceSlug, productId),
    onSuccess: async ({ folder: target }) => {
      await navigate(`/app/${workspaceSlug}/files/${target.spaceId}/f/${target.id}`);
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const close = () => {
    setDialog(null);
  };
  const back = (
    <Link
      to={`/app/${workspaceSlug}/calidad/productos`}
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
  const product = query.data;
  if (product === undefined) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        {back}
        <Skeleton className="h-40" />
      </div>
    );
  }
  const manage = product.canManage && !product.archived;
  const nutrition = product.nutrition;
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-4">
      <div className="grid gap-2">
        {back}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">
              {[product.code, product.family].filter((part) => part !== null).join(" · ") || "—"}
            </p>
            <h1 className="break-words text-xl font-semibold tracking-tight">{product.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <LabelStateBadge state={product.labelState} />
              {product.readyToEat && <Badge tone="neutral">{t.readyToEat}</Badge>}
              {product.needsStudy && <Badge tone="danger">{t.needsStudy}</Badge>}
              {product.archived && <Badge tone="neutral">{t.archived}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {manage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialog({ kind: "edit" });
                }}
              >
                <Pencil className="size-4" aria-hidden="true" />
                {d.edit}
              </Button>
            )}
            {manage && (
              <Button
                variant="outline"
                size="sm"
                disabled={folder.isPending}
                onClick={() => {
                  if (product.folder !== null) {
                    void navigate(
                      `/app/${workspaceSlug}/files/${product.folder.spaceId}/f/${product.folder.id}`,
                    );
                  } else folder.mutate();
                }}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                {d.folder}
              </Button>
            )}
            {product.canManage && (
              <Button
                variant="outline"
                size="sm"
                disabled={archive.isPending}
                onClick={() => {
                  archive.mutate(!product.archived);
                }}
              >
                {product.archived ? (
                  <ArchiveRestore className="size-4" aria-hidden="true" />
                ) : (
                  <Archive className="size-4" aria-hidden="true" />
                )}
                {product.archived ? d.restore : d.archive}
              </Button>
            )}
          </div>
        </div>
      </div>
      <Card className="grid gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>{d.sheet}</CardTitle>
          <span className="text-xs text-muted-foreground">{d.version(product.specVersion)}</span>
        </div>
        <SheetSummary product={product} />
        <div>
          <p className="text-xs text-muted-foreground">{d.nutrition}</p>
          {nutrition === null ? (
            <p className="text-sm">{d.noNutrition}</p>
          ) : (
            <dl className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {NUTRITION_FIELDS.map((field) => (
                <div key={field} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t.nutrition[field]}</dt>
                  <dd className="tabular-nums">{nutrition[field] ?? "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {product.spec !== null && (
          <p className="text-sm">
            <span className="text-xs text-muted-foreground">{d.spec}: </span>
            <Link
              to={fileHref(workspaceSlug, product, product.spec)}
              className="underline-offset-4 hover:underline"
            >
              {product.spec.name}
            </Link>
          </p>
        )}
        {product.notes !== null && (
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {product.notes}
          </p>
        )}
      </Card>
      <Card className="grid gap-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t.labels.title}</CardTitle>
          {manage && (
            <Button
              size="sm"
              onClick={() => {
                setDialog({ kind: "label" });
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.labels.submit}
            </Button>
          )}
        </div>
        {product.labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.labels.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {product.labels.map((label) => (
              <li key={label.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-56 text-sm">
                  <p className="font-medium">
                    {t.labels.version(label.version)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {t.labels.against(label.specVersion)}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      t.labels.sent(label.submittedBy.name),
                      label.reviewedBy === null ? null : t.labels.reviewed(label.reviewedBy.name),
                      label.reviewedAt === null ? null : formatUtcDate(label.reviewedAt),
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </p>
                  {label.file !== null && (
                    <Link
                      to={fileHref(workspaceSlug, product, label.file)}
                      className="text-xs underline-offset-4 hover:underline"
                    >
                      {label.file.name}
                    </Link>
                  )}
                  {label.note !== null && (
                    <p className="whitespace-pre-wrap break-words text-xs">{label.note}</p>
                  )}
                  {label.reviewNote !== null && (
                    <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {label.reviewNote}
                    </p>
                  )}
                  {label.status === "APPROVED" && label.specVersion < product.specVersion && (
                    <p className="text-xs text-danger">{t.labels.outdated}</p>
                  )}
                </div>
                <Badge tone={labelTone[label.status]}>{t.labels.statuses[label.status]}</Badge>
                {manage && label.status === "IN_REVIEW" && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setDialog({ kind: "review", label });
                    }}
                  >
                    <ClipboardCheck className="size-4" aria-hidden="true" />
                    {t.labels.review}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="grid gap-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t.studies.title}</CardTitle>
          {manage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDialog({ kind: "study" });
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t.studies.add}
            </Button>
          )}
        </div>
        {product.studies.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.studies.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {product.studies.map((study) => (
              <li key={study.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-56 text-sm">
                  <p className="font-medium">
                    {t.studies.target(study.targetDays)}
                    {study.listeria && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {" "}
                        · {t.studies.listeria}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.studies.started(formatUtcDate(study.startedOn))}
                    {study.resultOn !== null && ` → ${formatUtcDate(study.resultOn)}`}
                  </p>
                  {study.conclusion !== null && (
                    <p className="whitespace-pre-wrap break-words text-xs">{study.conclusion}</p>
                  )}
                  <div className="flex flex-wrap gap-3 text-xs">
                    {study.report !== null && (
                      <Link
                        to={fileHref(workspaceSlug, product, study.report)}
                        className="underline-offset-4 hover:underline"
                      >
                        {t.studies.report}: {study.report.name}
                      </Link>
                    )}
                    {study.nc !== null && (
                      <Link
                        to={`/app/${workspaceSlug}/calidad/no-conformidades/${study.nc.id}`}
                        className="tabular-nums underline-offset-4 hover:underline"
                      >
                        {study.nc.code}
                      </Link>
                    )}
                  </div>
                </div>
                <Badge tone={studyTone[study.result]}>{t.studies.results[study.result]}</Badge>
                {manage && study.result === "PENDING" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDialog({ kind: "result", study });
                    }}
                  >
                    {t.studies.record}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {dialog?.kind === "edit" && <ProductDialog product={product} onClose={close} />}
        {dialog?.kind === "study" && <StudyDialog product={product} onClose={close} />}
        {dialog?.kind === "result" && (
          <StudyResultDialog product={product} study={dialog.study} onClose={close} />
        )}
        {dialog?.kind === "label" && <LabelDialog product={product} onClose={close} />}
        {dialog?.kind === "review" && (
          <ReviewDialog product={product} label={dialog.label} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}
