// Importación de carpetas y ZIP (docs/spec/adopcion.md, 9C.2). Una carpeta se valida en el servidor
// (plan) y sus archivos entran por la cola de subidas; un ZIP se sube y lo descomprime el worker, y
// acá se sigue su estado hasta el resumen.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { filesKeys, importsApi, trashApi, type ImportSkipped } from "./api";
import { useUploads } from "./uploads";
import { texts } from "@/i18n";

const t = texts.files.imports;

/** Archivos con su ruta relativa ("Calidad/PR-01.pdf"), venga de soltar o de elegir una carpeta. */
export function relativePathOf(file: File): string {
  const raw =
    (file as File & { path?: string }).path ??
    (file.webkitRelativePath === "" ? file.name : file.webkitRelativePath);
  return raw.replace(/^\.?\/+/, "");
}

export interface ImportReport {
  lines: string[];
  skipped: ImportSkipped[];
  skippedCount: number;
}

const LIST_CAP = 100;

export function ImportReportDialog({
  report,
  onClose,
}: {
  report: ImportReport | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={report !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {report !== null && (
        <DialogContent
          title={t.reportTitle}
          description={report.lines.join(" ")}
          footer={<Button onClick={onClose}>{t.close}</Button>}
        >
          {report.skippedCount > 0 && (
            <div className="grid gap-2">
              <p className="text-sm font-medium">{t.skippedTitle(report.skippedCount)}</p>
              <ul className="m-0 max-h-64 list-none overflow-y-auto rounded-lg border border-border p-0">
                {report.skipped.slice(0, LIST_CAP).map((item) => (
                  <li
                    key={`${item.path}:${item.reason}`}
                    className="grid gap-0.5 border-b border-border px-3 py-2 text-sm last:border-b-0"
                  >
                    <span className="break-all">{item.path}</span>
                    <span className="text-xs text-muted-foreground">{t.reasons[item.reason]}</span>
                  </li>
                ))}
              </ul>
              {report.skippedCount > LIST_CAP && (
                <p className="text-xs text-muted-foreground">
                  {t.skippedMore(report.skippedCount - LIST_CAP)}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

/**
 * Carpetas completas: el servidor valida y crea las carpetas, y cada archivo aceptado se sube por
 * la cola de siempre a la carpeta que le tocó.
 */
export function useFolderImport(spaceId: string, parentId: string | null) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const uploads = useUploads();
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (files: readonly File[]): Promise<void> => {
    const byPath = new Map(files.map((file) => [relativePathOf(file), file]));
    setBusy(true);
    try {
      const plan = await importsApi.plan(workspaceSlug, spaceId, {
        parentId,
        entries: [...byPath].map(([path, file]) => ({ path, size: file.size })),
      });
      const groups = new Map<string | null, File[]>();
      for (const item of plan.accepted) {
        const file = byPath.get(item.path);
        if (file === undefined) continue;
        groups.set(item.parentId, [...(groups.get(item.parentId) ?? []), file]);
      }
      for (const [folderId, group] of groups)
        uploads.enqueue(group, { spaceId, parentId: folderId });
      await queryClient.invalidateQueries({ queryKey: filesKeys.nodes(workspaceSlug, spaceId) });
      if (plan.skipped.length > 0 || plan.accepted.length === 0) {
        setReport({
          lines: [
            plan.accepted.length === 0
              ? t.nothingToImport
              : t.folderSummary(plan.accepted.length, plan.folders.created),
          ],
          skipped: plan.skipped,
          skippedCount: plan.skipped.length,
        });
      } else {
        toast.success(t.folderSummary(plan.accepted.length, plan.folders.created));
      }
    } catch (error) {
      toast.error(adminErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  return {
    start,
    busy,
    report,
    closeReport: () => {
      setReport(null);
    },
  };
}

/** Descomprimir un ZIP que ya está en el árbol: elegir, seguir el avance y ver el resumen. */
export function ZipImportDialog({
  node,
  onClose,
}: {
  node: { id: string; name: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={node !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {node !== null && <ZipImportForm node={node} onClose={onClose} />}
    </Dialog>
  );
}

function ZipImportForm({
  node,
  onClose,
}: {
  node: { id: string; name: string };
  onClose: () => void;
}) {
  const z = t.zip;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [newFolder, setNewFolder] = useState(true);
  const [importId, setImportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingZip, setDeletingZip] = useState(false);
  const [zipDeleted, setZipDeleted] = useState(false);

  const start = useMutation({
    mutationFn: () => importsApi.startZip(workspaceSlug, node.id, newFolder),
    onSuccess: (result) => {
      setImportId(result.import.id);
    },
    onError: (failure) => {
      setError(adminErrorText(failure));
    },
  });
  const status = useQuery({
    queryKey: [...filesKeys.all(workspaceSlug), "import", importId],
    queryFn: () => importsApi.get(workspaceSlug, importId ?? ""),
    enabled: importId !== null,
    select: (data) => data.import,
    refetchInterval: (query) => {
      const current = query.state.data?.import.status;
      return current === "DONE" || current === "FAILED" ? false : 2000;
    },
  });
  const finished = status.data?.status === "DONE" || status.data?.status === "FAILED";
  useEffect(() => {
    if (finished) void queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
  }, [finished, queryClient, workspaceSlug]);

  const summary = status.data?.summary ?? null;
  return (
    <DialogContent
      title={z.title(node.name)}
      description={importId === null ? z.description : ""}
      footer={
        importId === null ? (
          <>
            <Button variant="outline" onClick={onClose}>
              {z.cancel}
            </Button>
            <Button
              disabled={start.isPending}
              onClick={() => {
                setError(null);
                start.mutate();
              }}
            >
              {z.start}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t.close}</Button>
        )
      }
    >
      {importId === null ? (
        <div className="grid gap-3">
          <Checkbox
            checked={newFolder}
            label={z.newFolder}
            onChange={(event) => {
              setNewFolder(event.target.checked);
            }}
          />
          {error !== null && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      ) : status.data?.status === "FAILED" ? (
        <p role="alert" className="text-sm text-danger">
          {status.data.error ?? z.failed}
        </p>
      ) : summary === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
          {z.running}
        </p>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm">{z.done(summary.imported, summary.folders)}</p>
          {summary.duplicates > 0 && (
            <p className="text-xs text-muted-foreground">{z.duplicates(summary.duplicates)}</p>
          )}
          {/* El ZIP original ocupa cuota aunque ya esté descomprimido. */}
          {zipDeleted ? (
            <p className="text-xs text-muted-foreground">{z.zipDeleted}</p>
          ) : (
            <div className="grid gap-1">
              <Button
                variant="outline"
                className="justify-self-start"
                onClick={() => {
                  setDeletingZip(true);
                }}
              >
                <Trash2 strokeWidth={1.75} aria-hidden="true" />
                {z.deleteZip}
              </Button>
              <p className="text-xs text-muted-foreground">{z.deleteZipHint}</p>
            </div>
          )}
          {summary.skippedCount > 0 && (
            <div className="grid gap-2">
              <p className="text-sm font-medium">{t.skippedTitle(summary.skippedCount)}</p>
              <ul className="m-0 max-h-64 list-none overflow-y-auto rounded-lg border border-border p-0">
                {summary.skipped.slice(0, LIST_CAP).map((item) => (
                  <li
                    key={`${item.path}:${item.reason}`}
                    className="grid gap-0.5 border-b border-border px-3 py-2 text-sm last:border-b-0"
                  >
                    <span className="break-all">{item.path}</span>
                    <span className="text-xs text-muted-foreground">{t.reasons[item.reason]}</span>
                  </li>
                ))}
              </ul>
              {summary.skippedCount > LIST_CAP && (
                <p className="text-xs text-muted-foreground">
                  {t.skippedMore(summary.skippedCount - LIST_CAP)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={deletingZip}
        onOpenChange={setDeletingZip}
        icon={Trash2}
        title={z.confirmDelete.title(node.name)}
        description={z.confirmDelete.text}
        confirmLabel={z.confirmDelete.action}
        pendingLabel={z.confirmDelete.pending}
        tone="destructive"
        onConfirm={async () => {
          await trashApi.trashNode(workspaceSlug, node.id);
          await trashApi.purgeNode(workspaceSlug, node.id);
          setZipDeleted(true);
          await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
        }}
      />
    </DialogContent>
  );
}
