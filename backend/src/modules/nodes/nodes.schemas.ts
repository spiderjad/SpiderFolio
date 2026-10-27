import { z } from "zod";
import { NodeNameSchema } from "../../lib/names.ts";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);

/** Portadas disponibles (colores predefinidos; el frontend las dibuja). */
export const COVERS = [
  "violet",
  "sky",
  "emerald",
  "amber",
  "rose",
  "slate",
  "sunset",
  "ocean",
] as const;

export const SpaceParamsSchema = z.object({ id: Id });
export const NodeParamsSchema = z.object({ id: Id });

/** parent: "root" (la raíz del espacio) o el id de una carpeta. */
export const ListNodesQuerySchema = z.object({
  parent: z.union([z.literal("root"), Id]).default("root"),
  /** CONTAINER: carpetas y páginas (lo que puede tener cosas adentro). */
  type: z.enum(["FOLDER", "FILE", "PAGE", "CONTAINER"]).optional(),
  q: SearchParam,
  /** Filtro rápido del explorador: las carpetas siempre se ven (para poder navegar). */
  kind: z.enum(["all", "pages", "files"]).default("all"),
  ...pageShape(["name", "updatedAt"], "name"),
});

export const CreateFolderSchema = z.strictObject({
  parentId: Id.nullable().optional(),
  name: NodeNameSchema,
});

export const UpdateNodeSchema = z.strictObject({
  name: NodeNameSchema.optional(),
  icon: z.string().trim().min(1).max(40).nullable().optional(),
  /** Portada de una página: un color predefinido, o null para quitarla. */
  cover: z.enum(COVERS).nullable().optional(),
});

/** Selección para descargar como ZIP: archivos y carpetas del mismo espacio. */
export const DownloadZipSchema = z.strictObject({ nodeIds: z.array(Id).min(1).max(200) });

/**
 * Mover: a otra carpeta (o a la raíz) de este espacio o de otro donde se pueda editar. Si ya hay algo
 * con ese nombre: FAIL (error), REPLACE (el que está pasa a la papelera) o KEEP_BOTH (se numera).
 */
export const CreatePageSchema = z.strictObject({
  parentId: Id.nullable().optional(),
  name: z.string().max(255).optional(),
  /** Contenido inicial (una plantilla): se valida como cualquier texto de página. */
  content: z.unknown().optional(),
});

/** El contenido se valida a fondo en el servicio (packages/content); acá solo que venga. */
export const SavePageSchema = z.strictObject({
  baseRevision: z.number().int().min(1),
  content: z.custom<unknown>(
    (value) => value !== undefined && value !== null,
    { error: () => validationMessages.contentMissing },
  ),
});

export const PageParamsSchema = z.object({ id: Id });
export const PageImageParamsSchema = z.object({ id: Id, imageId: Id });

/** Las imágenes de una página llegan re-codificadas por el navegador: JPG, PNG o WebP, hasta 10 MB. */
export const UploadImageSchema = z.strictObject({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});

export const MoveNodeSchema = z.strictObject({
  parentId: Id.nullable(),
  spaceId: Id.optional(),
  onConflict: z.enum(["FAIL", "REPLACE", "KEEP_BOTH"]).default("FAIL"),
});

export type ListNodesQuery = z.infer<typeof ListNodesQuerySchema>;
export type CreateFolderInput = z.infer<typeof CreateFolderSchema>;
export type UpdateNodeInput = z.infer<typeof UpdateNodeSchema>;
export type MoveNodeInput = z.infer<typeof MoveNodeSchema>;
export type CreatePageInput = z.infer<typeof CreatePageSchema>;
export type SavePageInput = z.infer<typeof SavePageSchema>;
