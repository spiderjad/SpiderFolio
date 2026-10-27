import { z } from "zod";
import { MAX_IMPORT_ENTRIES } from "./import-paths.ts";

const Id = z.string().min(1).max(64);

export const SpaceParamsSchema = z.object({ id: Id });
export const FileParamsSchema = z.object({ id: Id });
export const ImportParamsSchema = z.object({ id: Id });

/**
 * Plan de importación de una carpeta: la estructura y los tamaños que recorrió el navegador. Las
 * rutas son relativas ("Calidad/PR-01.pdf"); el servidor las valida una por una.
 */
export const ImportPlanSchema = z.strictObject({
  parentId: Id.nullable().optional(),
  entries: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(2000),
        size: z
          .number()
          .int()
          .min(0)
          .max(2 ** 40),
      }),
    )
    .min(1)
    .max(MAX_IMPORT_ENTRIES),
});

/** Descomprimir un ZIP ya subido: dentro de una carpeta nueva (por defecto) o en su carpeta. */
export const StartZipImportSchema = z.strictObject({
  newFolder: z.boolean().default(true),
});

export type ImportPlanInput = z.infer<typeof ImportPlanSchema>;
export type StartZipImportInput = z.infer<typeof StartZipImportSchema>;
