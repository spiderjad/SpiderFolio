// Nombres de espacios, carpetas y archivos (docs/spec/archivos.md y la decisión del módulo 3):
// no se repiten entre hermanos, sin distinguir mayúsculas y con normalización Unicode NFC.
import { z } from "zod";
import { validationMessages } from "../i18n/index.ts";

const MAX_NAME_LENGTH = 255;

/** Clave de comparación: NFC, sin espacios en los bordes y en minúsculas. */
export function nameKeyOf(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

/** Nombre limpio para guardar: NFC y sin espacios sobrantes. */
export function cleanName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

// Sin barras ni caracteres de control; ni "." ni ".." (rutas de importación).
// eslint-disable-next-line no-control-regex
const forbidden = /[/\\\x00-\x1f\x7f]/;

export const NodeNameSchema = z
  .string()
  .transform(cleanName)
  .pipe(
    z
      .string()
      .min(1)
      .max(MAX_NAME_LENGTH)
      .refine((value) => !forbidden.test(value) && value !== "." && value !== "..", {
        error: () => validationMessages.invalidName,
      }),
  );

/** Nombre libre de un hermano: "Informe.pdf" → "Informe (2).pdf", "Informe (3).pdf"… */
export function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  const hasExtension = dot > 0 && dot > name.length - 12;
  return hasExtension
    ? `${name.slice(0, dot)} (${String(n)})${name.slice(dot)}`
    : `${name} (${String(n)})`;
}
