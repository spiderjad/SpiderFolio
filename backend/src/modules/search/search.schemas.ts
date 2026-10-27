import { z } from "zod";
import { decodeOffsetCursor } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

/** El texto de la paleta: corto, sin espacios sobrantes. */
export const QuickQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  /** writable: solo espacios donde la persona puede crear páginas (para «Nueva página»). */
  spaces: z.enum(["writable"]).optional(),
});
export type QuickQuery = z.infer<typeof QuickQuerySchema>;

/** Búsqueda de texto completo: al menos dos letras, de a páginas (cursor inválido = 400). */
export const FullTextQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  cursor: z
    .string()
    .max(100)
    .refine((value) => decodeOffsetCursor(value) !== null, { error: () => validationMessages.invalidCursor })
    .optional(),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type FullTextQuery = z.infer<typeof FullTextQuerySchema>;
