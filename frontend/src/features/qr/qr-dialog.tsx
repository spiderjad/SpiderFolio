// «Generar QR» de un documento: códigos que abren siempre la versión vigente, con el logo al centro.
// Se descargan como PNG o SVG, o como hoja de etiquetas A4 (PDF) en tres tamaños, y se revocan.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, QrCode, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Skeleton } from "@/components/ui/display";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText, downloadBlobFile } from "@/features/admin/admin-utils";
import { formatShortDate } from "@/lib/utils";
import { qrApi, qrKeys, type LabelSize, type QrView } from "./qr-api";
import { texts } from "@/i18n";

export interface QrTarget {
  id: string;
  name: string;
}

export function QrDialog({ target, onClose }: { target: QrTarget | null; onClose: () => void }) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {target !== null && <QrBody key={target.id} target={target} />}
    </Dialog>
  );
}

/** Reads a blob as a data: URL (the CSP allows data: images, not blob:). */
function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("FileReader"));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("FileReader"));
    };
    reader.readAsDataURL(blob);
  });
}

/** The code's image (SVG), fetched with the session and kept only in memory. */
function Preview({ slug, qr }: { slug: string; qr: QrView }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void qrApi
      .image(slug, qr.id, "svg")
      .then(dataUrlOf)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, qr.id]);
  return src === null ? (
    <Skeleton className="size-36 shrink-0" />
  ) : (
    <img
      src={src}
      alt={texts.qr.previewLabel}
      className="size-36 shrink-0 rounded-lg border border-border bg-white"
    />
  );
}

function QrBody({ target }: { target: QrTarget }) {
  const t = texts.qr;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: qrKeys.node(workspaceSlug, target.id),
    queryFn: () => qrApi.list(workspaceSlug, target.id),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: qrKeys.node(workspaceSlug, target.id) });
  const [revoking, setRevoking] = useState<QrView | null>(null);
  const [askingPublic, setAskingPublic] = useState(false);
  const create = useMutation({
    mutationFn: (isPublic: boolean) => qrApi.create(workspaceSlug, target.id, isPublic),
    onSuccess: async () => {
      toast.success(t.created);
      await refresh();
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const download = useMutation({
    mutationFn: async (input: { qr: QrView; what: "png" | "svg" | LabelSize }) => {
      const { qr, what } = input;
      if (what === "png" || what === "svg") {
        downloadBlobFile(
          `QR ${target.name}.${what}`,
          await qrApi.image(workspaceSlug, qr.id, what),
        );
      } else {
        downloadBlobFile(
          `Etiquetas QR ${target.name}.pdf`,
          await qrApi.labels(workspaceSlug, qr.id, what),
        );
      }
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  const active = (list.data?.items ?? []).filter((qr) => qr.revokedAt === null);
  return (
    <DialogContent
      title={t.title(target.name)}
      description={t.text}
      size="lg"
      footer={
        <>
          {list.data?.canPublic === true && (
            <Button
              variant="outline"
              disabled={create.isPending}
              onClick={() => {
                setAskingPublic(true);
              }}
            >
              {t.generatePublic}
            </Button>
          )}
          <Button
            disabled={create.isPending || list.isPending}
            onClick={() => {
              create.mutate(false);
            }}
          >
            <QrCode strokeWidth={1.75} aria-hidden="true" />
            {create.isPending ? t.generating : t.generate}
          </Button>
          <DialogClose asChild>
            <Button variant="outline">{texts.documents.dialog.close}</Button>
          </DialogClose>
        </>
      }
    >
      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t.loadError}
        </p>
      ) : active.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0">
          {active.map((qr) => (
            <li key={qr.id} className="flex flex-wrap gap-4 rounded-xl border border-border p-3">
              <Preview slug={workspaceSlug} qr={qr} />
              <div className="grid min-w-0 flex-1 basis-60 content-start gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={qr.isPublic ? "warning" : "neutral"}>
                    {qr.isPublic ? t.kind.public : t.kind.private}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {[
                      t.scans(qr.scans),
                      qr.lastScanAt === null ? null : t.lastScan(formatShortDate(qr.lastScanAt)),
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </span>
                </div>
                <p className="m-0 break-all text-xs text-muted-foreground">{qr.url}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["png", "svg"] as const).map((format) => (
                    <Button
                      key={format}
                      variant="outline"
                      size="sm"
                      disabled={download.isPending}
                      onClick={() => {
                        download.mutate({ qr, what: format });
                      }}
                    >
                      <Download strokeWidth={1.75} aria-hidden="true" />
                      {format === "png" ? t.downloadPng : t.downloadSvg}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-xs font-medium">
                    <FileText className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    {t.labels}
                  </span>
                  {(["small", "medium", "large"] as const).map((size) => (
                    <Button
                      key={size}
                      variant="outline"
                      size="sm"
                      disabled={download.isPending}
                      onClick={() => {
                        download.mutate({ qr, what: size });
                      }}
                    >
                      {t.labelSizes[size]}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-fit text-danger"
                  onClick={() => {
                    setRevoking(qr);
                  }}
                >
                  <Trash2 strokeWidth={1.75} aria-hidden="true" />
                  {t.revoke}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        icon={Trash2}
        tone="warning"
        title={t.revokeTitle}
        description={t.revokeText}
        confirmLabel={t.revokeConfirm}
        pendingLabel={t.revokePending}
        onConfirm={async () => {
          if (revoking === null) return;
          await qrApi.revoke(workspaceSlug, revoking.id);
          toast.success(t.revoked);
          setRevoking(null);
          await refresh();
        }}
      />
      <ConfirmDialog
        open={askingPublic}
        onOpenChange={setAskingPublic}
        icon={QrCode}
        tone="warning"
        title={t.publicTitle}
        description={t.publicText}
        confirmLabel={t.publicConfirm}
        pendingLabel={t.generating}
        onConfirm={async () => {
          await create.mutateAsync(true);
          setAskingPublic(false);
        }}
      />
    </DialogContent>
  );
}
