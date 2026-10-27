// Texto para mostrar de un error: el mensaje del servidor si lo trae.
import { ApiError, NetworkError } from "@/lib/api";
import { texts } from "@/i18n";

export function errorText(error: unknown): string {
  if (error instanceof NetworkError) return texts.errors.network;
  if (error instanceof ApiError) {
    if (error.code === "RATE_LIMITED") return texts.errors.rateLimited;
    if (error.message !== "") return error.message;
  }
  return texts.errors.generic;
}
