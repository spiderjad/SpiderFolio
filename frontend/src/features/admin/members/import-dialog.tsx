// Importar miembros desde CSV (9.3): vista previa con validación por fila y confirmación.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { FormField, FormGrid, Textarea } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminApi, adminKeys, type ImportPreview } from "../api";
import { adminErrorText, limitReachedOf, type LimitReachedDetails } from "../admin-utils";
import { LimitReachedDialog } from "../limit-dialog";
import { texts } from "@/i18n";

/** Tamaño máximo del archivo que se lee en el navegador (el servidor acepta hasta ~200 KB). */
const MAX_FILE_BYTES = 200_000;

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open && <ImportForm onClose={onClose} />}
    </Dialog>
  );
}

const statusTone = { ok: "success", skip: "neutral", error: "danger" } as const;

function ImportForm({ onClose }: { onClose: () => void }) {
  const t = texts.admin.importCsv;
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<LimitReachedDetails | null>(null);

  const previewMutation = useMutation({
    mutationFn: () => adminApi.previewImport(workspaceSlug, csv),
    onSuccess: (result) => {
      setError(null);
      setPreview(result);
    },
    onError: (failure) => {
      setPreview(null);
      setError(adminErrorText(failure));
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () => adminApi.confirmImport(workspaceSlug, csv),
    onSuccess: async (result) => {
      toast.success(t.done(result.invited));
      await queryClient.invalidateQueries({ queryKey: adminKeys.all(workspaceSlug) });
      onClose();
    },
    onError: (failure) => {
      const reached = limitReachedOf(failure);
      if (reached === null) setError(adminErrorText(failure));
      else setLimit(reached);
    },
  });

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(t.tooLarge);
      return;
    }
    setCsv(await file.text());
    setPreview(null);
    setError(null);
  };

  const busy = previewMutation.isPending || confirmMutation.isPending;
  return (
    <>
      <DialogContent
        title={t.title}
        description={t.description}
        size="xl"
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                {texts.admin.common.cancel}
              </Button>
            </DialogClose>
            <Button
              variant="outline"
              disabled={busy || csv.trim() === ""}
              onClick={() => {
                previewMutation.mutate();
              }}
            >
              {previewMutation.isPending ? t.previewing : t.preview}
            </Button>
            <Button
              disabled={busy || preview === null || preview.summary.ok === 0}
              onClick={() => {
                confirmMutation.mutate();
              }}
            >
              {confirmMutation.isPending ? t.confirming : t.confirm}
            </Button>
          </>
        }
      >
        <FormGrid>
          <FormField label={t.file}>
            {(control) => (
              <input
                {...control}
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-input file:bg-background file:px-3 file:py-2 file:text-sm hover:file:bg-muted"
                onChange={(event) => {
                  void onFile(event);
                }}
              />
            )}
          </FormField>
          <FormField label={t.paste} error={error ?? undefined}>
            {(control) => (
              <Textarea
                {...control}
                value={csv}
                rows={5}
                className="font-mono text-sm"
                placeholder={"email,rol,departamentos,plaza\nana@empresa.com,Miembro,Calidad,"}
                onChange={(event) => {
                  setCsv(event.target.value);
                  setPreview(null);
                }}
              />
            )}
          </FormField>

          {preview !== null && (
            <div className="grid gap-3">
              <p className="text-sm font-medium" role="status">
                {t.summary(preview.summary.ok, preview.summary.skip, preview.summary.error)}
              </p>
              <div className="max-h-72 overflow-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm" aria-label={t.preview}>
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t.columns.line}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t.columns.email}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t.columns.role}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t.columns.result}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.line} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.line}</td>
                        <td className="px-3 py-2">{row.email}</td>
                        <td className="px-3 py-2">{row.roleName ?? "—"}</td>
                        <td className="px-3 py-2">
                          <Badge tone={statusTone[row.status]}>{t.status[row.status]}</Badge>
                          {row.reason !== undefined && (
                            <span className="ml-2 text-muted-foreground">
                              {t.reasons[row.reason] ?? row.reason}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </FormGrid>
      </DialogContent>
      <LimitReachedDialog
        limit={limit}
        onClose={() => {
          setLimit(null);
        }}
      />
    </>
  );
}
