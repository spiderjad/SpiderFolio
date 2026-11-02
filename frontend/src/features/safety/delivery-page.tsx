// /app/:slug/seguridad/epis/:deliveryId — one PPE handout (docs/spec/seguridad-salud.md, «EPIs»): what
// was handed out, the replacement days, the recipient's signature, the PDF receipt and, for whoever
// manages the module, voiding it with a reason.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Download, ServerCrash } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Banner, Card, CardTitle, EmptyState, Skeleton } from "@/components/ui/display";
import { FormField, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { formatDateTime, formatUtcDate } from "@/lib/utils";
import { safetyApi, safetyKeys } from "./safety-api";
import { useSafety } from "./safety-common";
import { texts } from "@/i18n";

const t = texts.safety.delivery;

export function DeliveryPage() {
  const { workspaceSlug = "", deliveryId = "" } = useParams();
  const safety = useSafety();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: safetyKeys.delivery(workspaceSlug, deliveryId),
    queryFn: () => safetyApi.delivery(workspaceSlug, deliveryId),
    select: (data) => data.delivery,
  });
  const [signature, setSignature] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void safetyApi.signature(workspaceSlug, deliveryId).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSignature(url);
    });
    return () => {
      cancelled = true;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [workspaceSlug, deliveryId]);
  const pdf = useMutation({
    mutationFn: async () => {
      const blob = await safetyApi.pdf(workspaceSlug, deliveryId);
      const delivery = query.data;
      downloadBlobFile(
        `${t.title(safety.terms.ppe)} ${delivery?.person.name ?? ""}.pdf`.trim(),
        blob,
      );
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const voidIt = useMutation({
    mutationFn: () => safetyApi.voidDelivery(workspaceSlug, deliveryId, reason.trim()),
    onSuccess: async () => {
      toast.success(t.voidedToast);
      setVoiding(false);
      await queryClient.invalidateQueries({ queryKey: safetyKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const base = `/app/${workspaceSlug}/seguridad`;

  if (query.isError) {
    return (
      <Card>
        <EmptyState icon={ServerCrash} title={texts.admin.common.loadError}>
          {adminErrorText(query.error)}
        </EmptyState>
      </Card>
    );
  }
  const delivery = query.data;
  if (delivery === undefined) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4">
      <Link
        to={`${base}/epis`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t.back}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title(safety.terms.ppes)}</h1>
          <p className="mt-1 text-sm">
            <Link
              to={`${base}/personas/${delivery.person.id}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t.to(delivery.person.name)}
            </Link>
          </p>
          <p className="text-xs text-muted-foreground">
            {t.by(delivery.deliveredBy.name, formatDateTime(delivery.deliveredAt))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pdf.isPending}
            onClick={() => {
              pdf.mutate();
            }}
          >
            <Download className="size-4" aria-hidden="true" />
            {t.pdf}
          </Button>
          {safety.canManage && delivery.voided === null && (
            <Button
              variant="outline"
              onClick={() => {
                setReason("");
                setVoiding(true);
              }}
            >
              <Ban className="size-4" aria-hidden="true" />
              {t.void}
            </Button>
          )}
        </div>
      </div>
      {delivery.voided !== null && (
        <Banner tone="warning">
          {t.voidedBy(
            delivery.voided.by.name,
            formatDateTime(delivery.voided.at),
            delivery.voided.reason,
          )}
        </Banner>
      )}
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t.columns.item}</th>
              <th className="px-4 py-3 font-medium">{t.columns.quantity}</th>
              <th className="px-4 py-3 font-medium">{t.columns.size}</th>
              <th className="px-4 py-3 font-medium">{t.columns.replaceOn}</th>
            </tr>
          </thead>
          <tbody>
            {delivery.lines.map((line) => (
              <tr key={line.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{line.item.name}</td>
                <td className="px-4 py-3">{line.quantity}</td>
                <td className="px-4 py-3">{line.size ?? "—"}</td>
                <td className="px-4 py-3">
                  {line.replaceOn === null ? "—" : formatUtcDate(line.replaceOn)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {delivery.note !== null && (
        <Card className="p-4">
          <CardTitle className="text-sm">{t.note}</CardTitle>
          <p className="mt-1 whitespace-pre-wrap text-sm">{delivery.note}</p>
        </Card>
      )}
      <Card className="p-4">
        <CardTitle className="text-sm">{t.signature}</CardTitle>
        {signature === null ? (
          <Skeleton className="mt-2 h-32 w-full" />
        ) : (
          <img
            src={signature}
            alt={`${t.signature}: ${delivery.person.name}`}
            className="mt-2 h-32 w-auto rounded-lg border border-border bg-white"
          />
        )}
      </Card>
      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent
          title={t.voidTitle}
          footer={
            <>
              <DialogClose asChild>
                <Button variant="outline" disabled={voidIt.isPending}>
                  {texts.admin.common.cancel}
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                disabled={voidIt.isPending || reason.trim().length < 3}
                onClick={() => {
                  voidIt.mutate();
                }}
              >
                {voidIt.isPending ? t.voiding : t.void}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">{t.voidText}</p>
          <FormField label={t.reason}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            )}
          </FormField>
        </DialogContent>
      </Dialog>
    </div>
  );
}
