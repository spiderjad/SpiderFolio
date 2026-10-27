// Traduce errores de la API a errores de formulario: VALIDATION_ERROR va a cada campo (con
// el mensaje propio de la app, no el del servidor) y el resto a un mensaje general.
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError, NetworkError } from "@/lib/api";
import { texts } from "@/i18n";

interface ValidationDetails {
  issues?: { path?: string }[];
}

/** Devuelve el mensaje general a mostrar, o null si el error quedó asignado a campos. */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  messages: Partial<Record<string, string>> = {},
): string | null {
  if (error instanceof NetworkError) return texts.errors.network;
  if (!(error instanceof ApiError)) return texts.errors.generic;

  if (error.code === "VALIDATION_ERROR") {
    const issues = (error.details as ValidationDetails | undefined)?.issues ?? [];
    let assigned = false;
    for (const issue of issues) {
      const field = fields.find((f) => f === issue.path);
      if (field !== undefined) {
        setError(field, { type: "server", message: texts.errors.required });
        assigned = true;
      }
    }
    if (assigned) return null;
  }
  if (error.code === "RATE_LIMITED") return texts.errors.rateLimited;
  return messages[error.code] ?? (error.message === "" ? texts.errors.generic : error.message);
}
