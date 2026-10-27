// Vista previa en el navegador: PDF (en un iframe del origen de S3), imágenes y texto o CSV. Office
// solo se descarga. La URL es la prefirmada de 60 s con Content-Disposition inline, pedida
// después de resolveAccess; el texto se lee con fetch y se muestra como texto (nunca como HTML).
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/display";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { filesApi, previewKind, type NodeView } from "./api";
import { texts } from "@/i18n";

/** Cuánto texto se muestra como máximo (el resto se descarga). */
const MAX_TEXT_BYTES = 256 * 1024;

async function readText(url: string): Promise<{ text: string; truncated: boolean }> {
  const response = await fetch(url);
  if (!response.ok || response.body === null) throw new Error("preview");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= MAX_TEXT_BYTES) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder("utf-8").decode(bytes), truncated };
}

export function PreviewDialog({
  node,
  onDownload,
  onClose,
}: {
  node: NodeView | null;
  onDownload: (node: NodeView) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={node !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {node !== null && <PreviewBody key={node.id} node={node} onDownload={onDownload} />}
    </Dialog>
  );
}

function PreviewBody({
  node,
  onDownload,
}: {
  node: NodeView;
  onDownload: (node: NodeView) => void;
}) {
  const t = texts.files.explorer.preview;
  const { workspaceSlug = "" } = useParams();
  const kind = previewKind(node.mimeType);
  const ticket = useQuery({
    queryKey: ["w", workspaceSlug, "files", "preview", node.id, node.currentVersion],
    queryFn: () => filesApi.download(workspaceSlug, node.id, { inline: true }),
    // La URL vive 60 s: no se reutiliza.
    gcTime: 0,
    staleTime: 0,
  });
  const text = useQuery({
    queryKey: ["w", workspaceSlug, "files", "preview-text", node.id, node.currentVersion],
    queryFn: () => readText(ticket.data?.url ?? ""),
    enabled: kind === "text" && ticket.data !== undefined,
    gcTime: 0,
  });
  const failed = ticket.isError || text.isError;

  return (
    <DialogContent
      title={t.title(node.name)}
      size="xl"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              onDownload(node);
            }}
          >
            <Download strokeWidth={1.75} aria-hidden="true" />
            {t.download}
          </Button>
          <DialogClose asChild>
            <Button>{t.close}</Button>
          </DialogClose>
        </>
      }
    >
      <div className="min-h-[50dvh]">
        {failed ? (
          <p role="alert" className="py-10 text-center text-xs text-muted-foreground">
            {t.error}
          </p>
        ) : ticket.data === undefined ? (
          <Skeleton className="h-[50dvh] w-full" />
        ) : kind === "image" ? (
          <img
            src={ticket.data.url}
            alt={node.name}
            className="mx-auto max-h-[70dvh] max-w-full rounded-lg object-contain"
          />
        ) : kind === "pdf" ? (
          <iframe
            title={t.title(node.name)}
            src={ticket.data.url}
            className="h-[70dvh] w-full rounded-lg border border-border"
          />
        ) : text.data === undefined ? (
          <Skeleton className="h-[50dvh] w-full" />
        ) : (
          <div className="grid gap-2">
            <pre className="max-h-[65dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-xs">
              {text.data.text}
            </pre>
            {text.data.truncated && <p className="text-xs text-muted-foreground">{t.truncated}</p>}
          </div>
        )}
      </div>
    </DialogContent>
  );
}
