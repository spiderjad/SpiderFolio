import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, decodeOffsetCursor } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

export const SharedQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  cursor: z
    .string()
    .max(100)
    .refine((value) => decodeOffsetCursor(value) !== null, { error: () => validationMessages.invalidCursor })
    .optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type SharedQuery = z.infer<typeof SharedQuerySchema>;
