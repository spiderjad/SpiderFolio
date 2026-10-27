// Ícono por tipo de archivo y utilidades de arrastre del explorador.
import {
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  NotebookText,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NodeView, SpaceReason, SpaceView } from "./api";
import { texts } from "@/i18n";

/** El motivo del acceso en palabras: "Jefe de Finanzas", "Miembro de Contabilidad"… */
export function spaceReasonText(reason: SpaceReason): string {
  const t = texts.files.spaces.reason;
  switch (reason.kind) {
    case "leader":
      return t.leader(reason.rank, reason.department.name, reason.superior);
    case "member":
      return t.member(reason.department.name, reason.subareas);
    case "visible":
      return t.visible(reason.department.name);
    default:
      return t[reason.kind];
  }
}

/** "Tu acceso: Gestiona · por ser Propietario". */
export function spaceAccessText(space: Pick<SpaceView, "level" | "reason">): string {
  const because = texts.files.spaces.because;
  const { reason } = space;
  let why: string | null = null;
  if (reason !== null) {
    if (reason.kind === "leader")
      why = because.leader(reason.rank, reason.department.name, reason.superior);
    else if (reason.kind === "member")
      why = because.member(reason.department.name, reason.subareas);
    else if (reason.kind === "visible") why = because.visible(reason.department.name);
    else why = because[reason.kind];
  }
  return texts.files.spaces.yourAccess(texts.files.levels[space.level], why);
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function iconOf(node: Pick<NodeView, "type" | "name">): LucideIcon {
  if (node.type === "FOLDER") return Folder;
  if (node.type === "PAGE") return NotebookText;
  switch (extensionOf(node.name)) {
    case "pdf":
    case "doc":
    case "docx":
    case "odt":
    case "txt":
      return FileText;
    case "xls":
    case "xlsx":
    case "ods":
    case "csv":
      return FileSpreadsheet;
    case "ppt":
    case "pptx":
      return Presentation;
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
      return FileImage;
    case "zip":
      return FileArchive;
    default:
      return FileIcon;
  }
}

export function NodeIcon({
  node,
  className,
}: {
  node: Pick<NodeView, "type" | "name">;
  className?: string;
}) {
  const Icon = iconOf(node);
  return (
    <Icon
      className={cn(
        "size-5 shrink-0",
        node.type === "FOLDER" || node.type === "PAGE" ? "text-primary" : "text-muted-foreground",
        className,
      )}
      strokeWidth={1.75}
      aria-hidden="true"
    />
  );
}

/** Tipo de dato con que se arrastra un nodo para moverlo a otra carpeta. */
export const NODE_DRAG_TYPE = "application/x-spiderfolio-node";

/** ¿El arrastre trae un nodo propio (y no, por ejemplo, archivos del sistema)? */
export function isNodeDrag(event: { dataTransfer: DataTransfer }): boolean {
  return event.dataTransfer.types.includes(NODE_DRAG_TYPE);
}
