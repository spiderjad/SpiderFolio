// Utilidades del panel: texto de errores, error de límite de plan y capacidades de quien mira.
import { ServerCrash, WifiOff, type LucideIcon } from "lucide-react";
import { ApiError, NetworkError } from "@/lib/api";
import { errorText } from "@/lib/error-text";
import { texts } from "@/i18n";

/** Texto para mostrar de un error de la API: el mensaje del servidor si lo trae. */
export const adminErrorText = errorText;

/** Texto de «no pudimos cargar»: la conexión solo se menciona si fue un error de red. */
export function loadErrorText(error: unknown): string {
  return error instanceof NetworkError
    ? texts.admin.common.loadErrorText
    : texts.admin.common.loadErrorServer;
}

/** Ícono de «no pudimos cargar»: sin conexión solo para un error de red. */
export function loadErrorIcon(error: unknown): LucideIcon {
  return error instanceof NetworkError ? WifiOff : ServerCrash;
}

export interface LimitReachedDetails {
  limit: string;
  used: number;
  max: number;
}

/** Detalles de un LIMIT_REACHED (9A.5) o null si el error es otro. */
export function limitReachedOf(error: unknown): LimitReachedDetails | null {
  if (!(error instanceof ApiError) || error.code !== "LIMIT_REACHED") return null;
  const details = error.details as Partial<LimitReachedDetails> | undefined;
  if (
    details === undefined ||
    typeof details.limit !== "string" ||
    typeof details.used !== "number" ||
    typeof details.max !== "number"
  ) {
    return null;
  }
  return { limit: details.limit, used: details.used, max: details.max };
}

/** Problemas de validación (VALIDATION_ERROR): ruta y código de cada campo con error. */
export function validationIssues(error: unknown): { path: string; code: string }[] {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_ERROR") return [];
  const details = error.details as { issues?: { path: string; code: string }[] } | undefined;
  return details?.issues ?? [];
}

/** Descarga un archivo (blob) desde el navegador. */
export function downloadBlobFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Descarga un texto como archivo desde el navegador (blob: no pasa por la red ni por la CSP). */
export function downloadTextFile(filename: string, content: string, type = "text/csv"): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
