// Versiones de un archivo: el historial (quién la subió, cuándo y de qué tamaño), descargar una
// versión vieja, volver a una anterior (pasa a ser la vigente) y subir una versión nueva.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, RotateCcw, Upload } from "lucide-react";
import { useRef } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Badge, Skeleton } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { LoadMore, useInfiniteList } from "@/components/ui/infinite";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatBytes, formatDateTime } from "@/lib/utils";
import { canEdit, filesApi, filesKeys, trashApi, type NodeView, type VersionView } from "./api";
import { useUploads } from "./uploads";
import { texts } from "@/i18n";

export function VersionsDialog({
  node,
  writable,
  onClose,
}: {
  node: NodeView | null;
  /** El espacio admite escrituras (no está archivado). */
  writable: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={node !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {node !== null && <VersionsBody key={node.id} node={node} writable={writable} />}
    </Dialog>
  );
}

function VersionsBody({ node, writable }: { node: NodeView; writable: boolean }) {
  const t = texts.files.versions;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const mayEdit = writable && canEdit(node.level);
  const key = [...filesKeys.all(workspaceSlug), "versions", node.id] as const;
  const list = useInfiniteList<VersionView>({
    queryKey: key,
    fetchPage: (cursor) => trashApi.versions(workspaceSlug, node.id, cursor),
  });

  const restore = useMutation({
    mutationFn: (version: number) => trashApi.restoreVersion(workspaceSlug, node.id, version),
    onSuccess: async () => {
      toast.success(t.restored);
      await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });

  const download = async (version: number) => {
    try {
      const ticket = await filesApi.download(workspaceSlug, node.id, { version });
      const link = document.createElement("a");
      link.href = ticket.url;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      toast.error(adminErrorText(error));
    }
  };

  return (
    <DialogContent
      title={t.title(node.name)}
      description={t.description}
      size="lg"
      footer={
        <>
          {mayEdit && (
            <Button
              variant="outline"
              onClick={() => {
                fileInput.current?.click();
              }}
            >
              <Upload strokeWidth={1.75} aria-hidden="true" />
              {t.upload}
            </Button>
          )}
          <DialogClose asChild>
            <Button>{texts.files.uploads.close}</Button>
          </DialogClose>
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        aria-label={t.upload}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file === undefined) return;
          uploads.enqueue(
            [file],
            { spaceId: node.spaceId, parentId: node.parentId },
            { name: node.name },
          );
          toast.info(t.uploading);
        }}
      />
      {list.query.isPending ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        <ul className="m-0 max-h-80 list-none divide-y divide-border overflow-y-auto p-0">
          {list.items.map((version) => (
            <li key={version.version} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {t.version(version.version)}
                  {version.current && <Badge tone="primary">{t.current}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(version.createdAt)} · {formatBytes(version.sizeBytes)} ·{" "}
                  {version.uploadedBy ?? t.unknownUploader}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.download(version.version)}
                onClick={() => {
                  void download(version.version);
                }}
              >
                <Download strokeWidth={1.75} aria-hidden="true" />
              </Button>
              {mayEdit && !version.current && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => {
                    restore.mutate(version.version);
                  }}
                >
                  <RotateCcw strokeWidth={1.75} aria-hidden="true" />
                  {t.restore}
                </Button>
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
