// Cola de subidas (docs/spec/archivos.md): directo a S3 con URL prefirmada, con progreso por archivo
// y global, hasta 3 a la vez, por partes y reanudable (los archivos grandes), y conflictos de
// nombre resueltos por la persona (reemplazar, conservar ambos u omitir). La cola vive en un
// contexto: sigue subiendo aunque se navegue entre carpetas.
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Loader2, RotateCcw, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { overviewKey } from "@/features/home/home-api";
import { filesApi, filesKeys, type ConflictMode, type UploadTicket } from "./api";
import { texts } from "@/i18n";

const CONCURRENCY = 3;

export type UploadStatus =
  "queued" | "uploading" | "processing" | "done" | "error" | "conflict" | "cancelled";

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  spaceId: string;
  parentId: string | null;
  mode: ConflictMode;
  status: UploadStatus;
  /** Bytes subidos. */
  loaded: number;
  error?: string;
  /** Con status "conflict": el nombre que ya existe. */
  existingName?: string;
  ticketId?: string;
  /** Al terminar de subir (por ejemplo, para importar un ZIP recién subido). */
  onDone?: (node: { id: string; name: string }) => void;
}

interface UploadsContextValue {
  items: readonly UploadItem[];
  enqueue: (
    files: readonly File[],
    target: { spaceId: string; parentId: string | null },
    /** Para subir una versión nueva: el nombre del archivo que se reemplaza. */
    replace?: { name: string },
    onDone?: UploadItem["onDone"],
  ) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  resolveConflict: (id: string, mode: ConflictMode | "skip", all: boolean) => void;
  clearFinished: () => void;
}

const UploadsContext = createContext<UploadsContextValue | null>(null);

export function useUploads(): UploadsContextValue {
  const value = useContext(UploadsContext);
  if (value === null) throw new Error("useUploads fuera de UploadsProvider");
  return value;
}

/** PUT con progreso (fetch no informa el avance de una subida). */
function putBlob(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      onProgress(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 respondió ${String(xhr.status)}`));
    };
    xhr.onerror = () => {
      reject(new Error("network"));
    };
    xhr.onabort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => {
      xhr.abort();
    });
    xhr.send(body);
  });
}

const PART_URL_BATCH = 10;

export function UploadsProvider({ children }: { children: ReactNode }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const started = useRef(new Set<string>());

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const run = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      let ticket: UploadTicket | null = null;
      try {
        const started = await filesApi.startUpload(workspaceSlug, item.spaceId, {
          parentId: item.parentId,
          name: item.name,
          size: item.file.size,
          onConflict: item.mode,
        });
        ticket = started.upload;
        patch(item.id, { ticketId: ticket.id });
        const total = item.file.size;
        if (ticket.mode === "single") {
          await putBlob(
            ticket.url ?? "",
            item.file,
            { "Content-Type": ticket.contentType },
            (loaded) => {
              patch(item.id, { loaded });
            },
            controller.signal,
          );
        } else {
          const partSize = ticket.partSize ?? total;
          const count = ticket.partCount ?? 1;
          // Reanudación: lo que ya está en S3 no se vuelve a subir.
          const status = await filesApi.uploadStatus(workspaceSlug, ticket.id);
          const done = new Map(status.uploadedParts.map((part) => [part.partNumber, part.size]));
          let uploaded = [...done.values()].reduce((sum, size) => sum + size, 0);
          patch(item.id, { loaded: uploaded });
          const pending = Array.from({ length: count }, (_, index) => index + 1).filter(
            (n) => !done.has(n),
          );
          for (let from = 0; from < pending.length; from += PART_URL_BATCH) {
            const batch = pending.slice(from, from + PART_URL_BATCH);
            const { parts } = await filesApi.partUrls(workspaceSlug, ticket.id, batch);
            for (const part of parts) {
              const start = (part.partNumber - 1) * partSize;
              const blob = item.file.slice(start, Math.min(start + partSize, total));
              const before = uploaded;
              await putBlob(
                part.url,
                blob,
                {},
                (loaded) => {
                  patch(item.id, { loaded: before + loaded });
                },
                controller.signal,
              );
              uploaded += blob.size;
              patch(item.id, { loaded: uploaded });
            }
          }
        }
        patch(item.id, { status: "processing", loaded: total });
        const result = await filesApi.completeUpload(workspaceSlug, ticket.id);
        patch(item.id, { status: "done" });
        item.onDone?.({ id: result.node.id, name: result.node.name });
        if (result.duplicateOf !== null) toast.info(texts.files.uploads.duplicate);
        // Listados, historial de versiones y espacios (el contador de la cuota).
        await queryClient.invalidateQueries({ queryKey: filesKeys.all(workspaceSlug) });
        await queryClient.invalidateQueries({ queryKey: overviewKey(workspaceSlug) });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          patch(item.id, { status: "cancelled" });
          if (ticket !== null)
            void filesApi.abortUpload(workspaceSlug, ticket.id).catch(() => null);
        } else if (error instanceof ApiError && error.code === "CONFLICT" && ticket === null) {
          const existing = (error.details as { existing?: { name?: string } } | undefined)
            ?.existing;
          patch(item.id, { status: "conflict", existingName: existing?.name ?? item.name });
        } else {
          patch(item.id, {
            status: "error",
            error: error instanceof ApiError ? adminErrorText(error) : texts.admin.common.loadError,
          });
        }
      } finally {
        controllers.current.delete(item.id);
      }
    },
    [workspaceSlug, patch, queryClient],
  );

  // Arranca hasta CONCURRENCY subidas a la vez, en el orden en que se pidieron.
  useEffect(() => {
    let active = items.filter((i) => i.status === "uploading" || i.status === "processing").length;
    for (const item of items) {
      if (active >= CONCURRENCY) break;
      if (item.status === "queued" && !started.current.has(item.id)) {
        started.current.add(item.id);
        active++;
        patch(item.id, { status: "uploading", loaded: 0 });
        void run(item);
      }
    }
  }, [items, patch, run]);

  // Avisa antes de cerrar la pestaña con subidas en curso.
  const busy = items.some((i) => i.status === "uploading" || i.status === "processing");
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [busy]);

  const enqueue = useCallback<UploadsContextValue["enqueue"]>((files, target, replace, onDone) => {
    const created: UploadItem[] = files.map((file) => ({
      ...(onDone === undefined ? {} : { onDone }),
      id: crypto.randomUUID(),
      file,
      // Una versión nueva se sube con el nombre del archivo y reemplaza (no pregunta).
      name: replace?.name ?? file.name,
      spaceId: target.spaceId,
      parentId: target.parentId,
      mode: replace === undefined ? "reject" : "replace",
      status: "queued",
      loaded: 0,
    }));
    setItems((current) => [...current, ...created]);
  }, []);

  const requeue = useCallback((id: string, changes: Partial<UploadItem>) => {
    started.current.delete(id);
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        // Sin el error anterior: vuelve a la cola limpio.
        const clean: UploadItem = { ...item, ...changes, status: "queued", loaded: 0 };
        delete clean.error;
        return clean;
      }),
    );
  }, []);

  const value = useMemo<UploadsContextValue>(
    () => ({
      items,
      enqueue,
      cancel: (id) => {
        const controller = controllers.current.get(id);
        if (controller === undefined) patch(id, { status: "cancelled" });
        else controller.abort();
      },
      retry: (id) => {
        requeue(id, {});
      },
      resolveConflict: (id, mode, all) => {
        const waiting = items.filter((item) => item.status === "conflict");
        const targets = all ? waiting : waiting.filter((item) => item.id === id);
        for (const item of targets) {
          if (mode === "skip") patch(item.id, { status: "cancelled" });
          else requeue(item.id, { mode });
        }
      },
      clearFinished: () => {
        setItems((current) =>
          current.filter((item) => item.status !== "done" && item.status !== "cancelled"),
        );
      },
    }),
    [items, enqueue, patch, requeue],
  );

  return (
    <UploadsContext.Provider value={value}>
      {children}
      <UploadPanel />
      <ConflictDialog />
    </UploadsContext.Provider>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────────────────

function UploadPanel() {
  const t = texts.files.uploads;
  const { items, cancel, retry, clearFinished } = useUploads();
  const [minimized, setMinimized] = useState(false);
  if (items.length === 0) return null;
  const finished = items.filter((i) => i.status === "done").length;
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  const doneBytes = items.reduce(
    (sum, item) => sum + (item.status === "done" ? item.file.size : item.loaded),
    0,
  );
  const percent = totalBytes === 0 ? 0 : Math.round((doneBytes / totalBytes) * 100);
  const allFinished = items.every((i) => ["done", "error", "cancelled"].includes(i.status));

  return (
    <section
      aria-label={t.title}
      className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-background shadow-pop"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t.title}</p>
          <p className="text-xs text-muted-foreground">{t.summary(finished, items.length)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={minimized ? t.expand : t.minimize}
          onClick={() => {
            setMinimized((current) => !current);
          }}
        >
          {minimized ? (
            <ChevronUp strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronDown strokeWidth={1.75} aria-hidden="true" />
          )}
        </Button>
        {allFinished && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t.close}
            onClick={clearFinished}
          >
            <X strokeWidth={1.75} aria-hidden="true" />
          </Button>
        )}
      </header>
      <div
        role="progressbar"
        aria-label={t.title}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1 bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      {!minimized && (
        <ul className="m-0 max-h-72 list-none overflow-y-auto p-0">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.name}</p>
                <p
                  className={cn(
                    "truncate text-xs",
                    item.status === "error" ? "text-danger" : "text-muted-foreground",
                  )}
                >
                  {item.status === "error" && item.error !== undefined
                    ? item.error
                    : t.status[item.status]}
                  {item.status === "uploading" && item.file.size > 0
                    ? ` · ${String(Math.round((item.loaded / item.file.size) * 100))} %`
                    : ""}
                </p>
              </div>
              {(item.status === "uploading" || item.status === "processing") && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              )}
              {(item.status === "queued" || item.status === "uploading") && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t.cancel(item.name)}
                  onClick={() => {
                    cancel(item.id);
                  }}
                >
                  <X strokeWidth={1.75} aria-hidden="true" />
                </Button>
              )}
              {(item.status === "error" || item.status === "cancelled") && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t.retry(item.name)}
                  onClick={() => {
                    retry(item.id);
                  }}
                >
                  <RotateCcw strokeWidth={1.75} aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConflictDialog() {
  const t = texts.files.uploads.conflict;
  const { items, resolveConflict } = useUploads();
  const [all, setAll] = useState(false);
  const item = items.find((candidate) => candidate.status === "conflict");
  return (
    <Dialog open={item !== undefined}>
      {item !== undefined && (
        <DialogContent
          title={t.title(item.existingName ?? item.name)}
          description={t.text}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => {
                  resolveConflict(item.id, "skip", all);
                }}
              >
                {t.skip}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  resolveConflict(item.id, "keep_both", all);
                }}
              >
                {t.keepBoth}
              </Button>
              <Button
                onClick={() => {
                  resolveConflict(item.id, "replace", all);
                }}
              >
                {t.replace}
              </Button>
            </>
          }
        >
          <Checkbox
            checked={all}
            label={t.applyToAll}
            onChange={(event) => {
              setAll(event.target.checked);
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
