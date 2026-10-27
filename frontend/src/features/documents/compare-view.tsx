// Comparación de versiones de un documento controlado: lo agregado en verde suave, lo quitado en
// rojo tachado, por bloque y por palabra. En archivos, los datos de cada versión (el texto se
// compara más adelante). La pantalla de aprobación la muestra por defecto.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { Skeleton } from "@/components/ui/display";
import { Checkbox } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { cn, formatBytes, formatShortDate } from "@/lib/utils";
import {
  documentsApi,
  documentsKeys,
  type Comparison,
  type DiffBlock,
  type DocumentVersionView,
  type FileSide,
} from "./documents-api";
import { StatusBadge } from "./control-dialog";
import { texts } from "@/i18n";

const ADDED = "rounded bg-success-soft px-0.5 text-success-soft-foreground";
const REMOVED = "rounded bg-danger-soft px-0.5 text-danger-soft-foreground line-through";

function Block({ block }: { block: DiffBlock }) {
  if (block.kind === "same") {
    return <p className="m-0 py-0.5 text-xs text-muted-foreground">{block.text}</p>;
  }
  if (block.kind === "added") {
    return <p className={cn("m-0 py-0.5 text-sm", ADDED)}>{block.text}</p>;
  }
  if (block.kind === "removed") {
    return <p className={cn("m-0 py-0.5 text-sm", REMOVED)}>{block.text}</p>;
  }
  return (
    <p className="m-0 py-0.5 text-sm">
      {block.words.map((word, index) => (
        <span
          key={index}
          className={word.op === "add" ? ADDED : word.op === "remove" ? REMOVED : undefined}
        >
          {word.text}
        </span>
      ))}
    </p>
  );
}

function FileColumn({ side, title }: { side: FileSide | null; title: string }) {
  const t = texts.documents.compare;
  return (
    <div className="grid gap-1 rounded-lg border border-border p-3 text-sm">
      <p className="font-medium">{title}</p>
      {side === null ? (
        <p className="text-muted-foreground">{t.noFile}</p>
      ) : (
        <>
          <p className="break-all">{side.fileName}</p>
          <p className="text-xs text-muted-foreground">
            {formatBytes(side.sizeBytes)} · {formatShortDate(side.uploadedAt)}
          </p>
          <p className="break-all text-xs text-muted-foreground">{`SHA-256 ${side.checksum.slice(0, 16)}…`}</p>
        </>
      )}
    </div>
  );
}

/** El resultado de comparar; se usa en el diálogo «Comparar» y en la aprobación. */
export function ComparisonView({ comparison }: { comparison: Comparison }) {
  const t = texts.documents.compare;
  const [onlyChanges, setOnlyChanges] = useState(true);
  const { stats } = comparison;
  const total = stats.added + stats.removed + stats.changed;
  if (comparison.files !== null) {
    return (
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FileColumn
            side={comparison.files.from}
            title={comparison.from === null ? t.before : t.versionLabel(comparison.from.version)}
          />
          <FileColumn side={comparison.files.to} title={t.versionLabel(comparison.to.version)} />
        </div>
        <p className="text-xs text-muted-foreground">{t.filesNote}</p>
      </div>
    );
  }
  // Con «solo cambios» se muestra cada bloque cambiado con uno de contexto a cada lado.
  const shown = comparison.blocks.filter((block, index, all) => {
    if (!onlyChanges || block.kind !== "same") return true;
    return [all[index - 1], all[index + 1]].some(
      (near) => near !== undefined && near.kind !== "same",
    );
  });
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={ADDED}>{t.added(stats.added)}</span>
        <span className={REMOVED}>{t.removed(stats.removed)}</span>
        <span className="rounded bg-warning-soft px-0.5 text-warning-soft-foreground">
          {t.changed(stats.changed)}
        </span>
        <span className="ml-auto">
          <Checkbox
            checked={onlyChanges}
            label={t.onlyChanges}
            onChange={(event) => {
              setOnlyChanges(event.target.checked);
            }}
          />
        </span>
      </div>
      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          {t.noChanges}
        </p>
      ) : (
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border p-3">
          {shown.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </div>
      )}
      {comparison.truncated && <p className="text-xs text-muted-foreground">{t.truncated}</p>}
    </div>
  );
}

/** Pide y muestra la comparación entre dos versiones (por defecto, la última contra la vigente). */
export function ComparisonLoader({
  nodeId,
  from,
  to,
  since,
}: {
  nodeId: string;
  from?: number | undefined;
  to?: number | undefined;
  since?: "review" | undefined;
}) {
  const { workspaceSlug = "" } = useParams();
  const query = useQuery({
    queryKey: [
      ...documentsKeys.node(workspaceSlug, nodeId),
      "compare",
      from ?? 0,
      to ?? 0,
      since ?? "",
    ],
    queryFn: () => documentsApi.compare(workspaceSlug, nodeId, { from, to, since }),
  });
  if (query.isPending) return <Skeleton className="h-32 w-full" />;
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {texts.documents.compare.loadError}
      </p>
    );
  }
  return <ComparisonView comparison={query.data} />;
}

export function CompareDialog({
  open,
  nodeId,
  versions,
  onClose,
}: {
  open: boolean;
  nodeId: string;
  versions: DocumentVersionView[];
  onClose: () => void;
}) {
  const t = texts.documents.compare;
  // Por defecto, la más nueva contra la vigente (o la anterior).
  const [from, setFrom] = useState<number | undefined>(undefined);
  const [to, setTo] = useState<number | undefined>(undefined);
  const pick = (value: string): number | undefined => (value === "" ? undefined : Number(value));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        title={t.title}
        description={t.description}
        size="lg"
        footer={
          <DialogClose asChild>
            <Button variant="outline">{texts.documents.dialog.close}</Button>
          </DialogClose>
        }
      >
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["from", t.from, from, setFrom],
                ["to", t.to, to, setTo],
              ] as const
            ).map(([key, label, value, set]) => (
              <label key={key} className="grid gap-1 text-sm">
                <span className="font-medium">{label}</span>
                <select
                  value={value === undefined ? "" : String(value)}
                  onChange={(event) => {
                    set(pick(event.target.value));
                  }}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <option value="">{key === "from" ? t.automaticFrom : t.automaticTo}</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.version}>
                      {`v${String(version.version)} · ${texts.documents.status[version.status]}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {open && <ComparisonLoader nodeId={nodeId} from={from} to={to} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { StatusBadge as CompareStatusBadge };
