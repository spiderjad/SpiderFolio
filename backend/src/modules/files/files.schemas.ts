import { z } from "zod";
import { NodeNameSchema } from "../../lib/names.ts";
import { pageShape } from "../../lib/pagination.ts";

const Id = z.string().min(1).max(64);

export const SpaceParamsSchema = z.object({ id: Id });
export const UploadParamsSchema = z.object({ id: Id });
export const FileParamsSchema = z.object({ id: Id });

/** Un archivo de hasta 1 TiB (el límite real lo pone el plan). */
const MAX_DECLARED_BYTES = 2 ** 40;

export const conflictModes = ["reject", "replace", "keep_both"] as const;

/**
 * Pedir permiso para subir un archivo. `onConflict` dice qué hacer si ya hay algo con ese nombre
 * en la carpeta: rechazar (409), reemplazar (sube una versión nueva) o conservar ambos (" (2)").
 */
export const StartUploadSchema = z.strictObject({
  parentId: Id.nullable().optional(),
  name: NodeNameSchema,
  size: z.number().int().min(1).max(MAX_DECLARED_BYTES),
  onConflict: z.enum(conflictModes).default("reject"),
});

/** URLs de partes de una subida por partes (hasta 50 por pedido). */
export const PartUrlsSchema = z.strictObject({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(50),
});

export const DownloadQuerySchema = z.object({
  version: z.coerce.number().int().min(1).optional(),
  /** "true": para ver en el navegador (solo PDF, imágenes y texto). */
  inline: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export const VersionParamsSchema = z.object({
  id: Id,
  version: z.coerce.number().int().min(1),
});

export const ListVersionsQuerySchema = z.object({ ...pageShape(["version"], "version") });

export type ListVersionsQuery = z.infer<typeof ListVersionsQuerySchema>;
export type StartUploadInput = z.infer<typeof StartUploadSchema>;
export type DownloadQuery = z.infer<typeof DownloadQuerySchema>;
