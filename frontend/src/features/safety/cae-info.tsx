// The site's information for contractors (docs/spec/cae.md, «Información»; RD 171/2004, arts. 7 to 9):
// which controlled documents it is (in the catalog screen) and, in each company's record, what it has
// received in its version in force, the handovers with their signed receipt and a new handover.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Download, Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxSource } from "@/components/ui/combobox";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui/display";
import { Checkbox, FormField, FormGrid, Input } from "@/components/ui/form";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { formatUtcDate } from "@/lib/utils";
import { caeApi, caeKeys, type CaeCompanyInfo, type CaeInfoDelivery } from "./cae-api";
import { dataUrlOf } from "./cae-common";
import { texts } from "@/i18n";

const t = texts.cae.info;

/** Controlled documents in force, by code or title. */
function useControlledSource(): ComboboxSource {
  const { workspaceSlug = "" } = useParams();
  return useMemo<ComboboxSource>(
    () => ({
      key: [...caeKeys.all(workspaceSlug), "info-options"],
      search: async (q, cursor, signal) => {
        const page = await caeApi.infoOptions(workspaceSlug, { q, cursor }, signal);
        return {
          items: page.items.map((doc) => ({ id: doc.id, label: `${doc.code} · ${doc.title}` })),
          nextCursor: page.nextCursor,
        };
      },
      byIds: async (ids) =>
        (await caeApi.infoOptions(workspaceSlug, { ids })).items.map((doc) => ({
          id: doc.id,
          label: `${doc.code} · ${doc.title}`,
        })),
    }),
    [workspaceSlug],
  );
}

/** Which controlled documents are the information for contractors (whoever manages CAE). */
export function InfoSettingsCard() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const source = useControlledSource();
  const info = useQuery({
    queryKey: caeKeys.info(workspaceSlug),
    queryFn: () => caeApi.info(workspaceSlug),
    select: (data) => data.info,
  });
  const save = useMutation({
    mutationFn: (body: { nodeIds?: string[]; required?: boolean }) =>
      caeApi.updateInfo(workspaceSlug, body),
    onSuccess: async () => {
      toast.success(t.saved);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = info.data;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <BookOpen
          className="mt-0.5 size-5 shrink-0 text-primary"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t.text}</p>
        </div>
      </div>
      {data === undefined ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <>
          <FormField label={t.documents}>
            {(control) => (
              <Combobox
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                multiple
                label={t.documents}
                placeholder={t.documentsPlaceholder}
                source={source}
                values={data.documents.map((doc) => doc.nodeId)}
                valueLabels={
                  new Map(data.documents.map((doc) => [doc.nodeId, `${doc.code} · ${doc.title}`]))
                }
                disabled={save.isPending}
                onChange={(ids) => {
                  save.mutate({ nodeIds: ids });
                }}
              />
            )}
          </FormField>
          <Checkbox
            label={t.required}
            checked={data.required}
            disabled={save.isPending}
            onChange={(event) => {
              save.mutate({ required: event.target.checked });
            }}
          />
        </>
      )}
    </Card>
  );
}

/** In a company's record: what it has received and its handovers. */
export function CompanyInfoCard({
  companyId,
  canManage,
}: {
  companyId: string;
  canManage: boolean;
}) {
  const { workspaceSlug = "" } = useParams();
  const [delivering, setDelivering] = useState(false);
  const info = useQuery({
    queryKey: caeKeys.companyInfo(workspaceSlug, companyId),
    queryFn: () => caeApi.companyInfo(workspaceSlug, companyId),
    select: (data) => data.info,
  });
  const deliveries = useInfiniteList<CaeInfoDelivery>({
    queryKey: caeKeys.infoDeliveries(workspaceSlug, companyId),
    fetchPage: (cursor, signal) => caeApi.infoDeliveries(workspaceSlug, companyId, cursor, signal),
  });
  const pdf = useMutation({
    mutationFn: async (delivery: CaeInfoDelivery) => {
      downloadBlobFile(
        `${t.pdf} ${delivery.deliveredOn}.pdf`,
        await caeApi.infoDeliveryPdf(workspaceSlug, delivery.id),
      );
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const data = info.data;
  return (
    <Card className="grid gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{t.companyTitle}</CardTitle>
        {canManage && data !== undefined && data.documents.length > 0 && (
          <Button
            size="sm"
            onClick={() => {
              setDelivering(true);
            }}
          >
            <Send className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {t.deliver}
          </Button>
        )}
      </div>
      {data === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : data.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.companyNone}</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.documents.map((doc) => (
            <li key={doc.nodeId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0 text-sm">
                <span className="font-medium">{doc.code}</span> · {doc.title}{" "}
                <span className="text-xs text-muted-foreground">({t.version(doc.version)})</span>
              </span>
              <Badge tone={doc.delivered ? "success" : data.required ? "danger" : "warning"}>
                {doc.delivered ? t.delivered : t.pending}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2">
        <p className="text-sm font-medium">{t.history}</p>
        {!deliveries.query.isPending && deliveries.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.historyEmpty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {deliveries.items.map((delivery) => (
              <li
                key={delivery.id}
                className="flex flex-wrap items-start justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm">
                    {delivery.items.map((item) => item.code).join(", ")}
                    {delivery.signed && (
                      <Badge tone="primary" className="ml-2">
                        {t.signed}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.receivedByLabel(delivery.receivedBy)} ·{" "}
                    {t.deliveredBy(delivery.createdBy.name, formatUtcDate(delivery.deliveredOn))}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pdf.isPending}
                  onClick={() => {
                    pdf.mutate(delivery);
                  }}
                >
                  <Download className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  {t.pdf}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <LoadMore
          hasNextPage={deliveries.query.hasNextPage}
          isFetching={deliveries.query.isFetchingNextPage}
          onLoadMore={deliveries.loadMore}
        />
      </div>
      <Dialog open={delivering} onOpenChange={setDelivering}>
        {delivering && data !== undefined && (
          <DeliverDialog
            companyId={companyId}
            info={data}
            onClose={() => {
              setDelivering(false);
            }}
          />
        )}
      </Dialog>
    </Card>
  );
}

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function DeliverDialog({
  companyId,
  info,
  onClose,
}: {
  companyId: string;
  info: CaeCompanyInfo;
  onClose: () => void;
}) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  // What it's missing comes ticked; everything, if it has it all.
  const pendingIds = info.documents.filter((doc) => !doc.delivered).map((doc) => doc.nodeId);
  const [chosen, setChosen] = useState<string[]>(
    pendingIds.length > 0 ? pendingIds : info.documents.map((doc) => doc.nodeId),
  );
  const [receivedBy, setReceivedBy] = useState("");
  const [deliveredOn, setDeliveredOn] = useState(today());
  const readSignature = useRef<() => Promise<Blob | null>>(() => Promise.resolve(null));
  const deliver = useMutation({
    mutationFn: async () => {
      const blob = await readSignature.current();
      return await caeApi.deliverInfo(workspaceSlug, companyId, {
        nodeIds: chosen,
        deliveredOn,
        receivedBy: receivedBy.trim(),
        signature: blob === null ? null : await dataUrlOf(blob),
      });
    },
    onSuccess: async () => {
      toast.success(t.deliveredToast);
      await queryClient.invalidateQueries({ queryKey: caeKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <DialogContent
      size="lg"
      title={t.deliverTitle}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" disabled={deliver.isPending}>
              {texts.admin.common.cancel}
            </Button>
          </DialogClose>
          <Button
            disabled={deliver.isPending || chosen.length === 0 || receivedBy.trim().length < 2}
            onClick={() => {
              deliver.mutate();
            }}
          >
            {t.deliver}
          </Button>
        </>
      }
    >
      <FormGrid>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t.deliverDocs}</legend>
          {info.documents.map((doc) => (
            <Checkbox
              key={doc.nodeId}
              label={`${doc.code} · ${doc.title} (${t.version(doc.version)})`}
              checked={chosen.includes(doc.nodeId)}
              onChange={(event) => {
                setChosen((current) =>
                  event.target.checked
                    ? [...current, doc.nodeId]
                    : current.filter((id) => id !== doc.nodeId),
                );
              }}
            />
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <FormField label={t.receivedBy}>
            {(control) => (
              <Input
                {...control}
                value={receivedBy}
                maxLength={120}
                onChange={(event) => {
                  setReceivedBy(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label={t.deliveredOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={deliveredOn}
                onChange={(event) => {
                  setDeliveredOn(event.target.value);
                }}
              />
            )}
          </FormField>
        </div>
        <p className="text-sm text-muted-foreground">{t.statement}</p>
        <SignaturePad
          label={t.signature}
          signer={receivedBy.trim() === "" ? undefined : receivedBy.trim()}
          register={(read) => {
            readSignature.current = read;
          }}
        />
      </FormGrid>
    </DialogContent>
  );
}
