import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, decodeOffsetCursor } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

export const SearchNodesQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  /** link: páginas y archivos para enlazar; embed: archivos que se pueden mostrar dentro de la página. */
  kind: z.enum(["link", "embed"]).default("link"),
  cursor: z
    .string()
    .max(100)
    .refine((value) => decodeOffsetCursor(value) !== null, { error: () => validationMessages.invalidCursor })
    .optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type SearchNodesQuery = z.infer<typeof SearchNodesQuerySchema>;

export const ResolveNodesSchema = z.strictObject({
  ids: z.array(z.string().min(1).max(64)).min(1).max(50),
});
export type ResolveNodesInput = z.infer<typeof ResolveNodesSchema>;
