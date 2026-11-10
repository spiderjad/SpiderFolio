// How a saved «Suggest a resolution» reads (docs/spec/mantenimiento.md, section 4). Kept apart so the
// work order's screen can show the latest one without depending on the AI service.
import { z } from "zod";

export const LIKELIHOODS = ["high", "medium", "low"] as const;

const SourceSchema = z.object({
  ref: z.string(),
  kind: z.enum(["work_order", "document"]),
  id: z.string(),
  label: z.string(),
  /** A document's space, to link it. */
  spaceId: z.string().nullable(),
  nodeType: z.string().nullable(),
  /** A file's folder, to open it there. */
  parentId: z.string().nullable().default(null),
});

export const SuggestionContentSchema = z.object({
  causes: z.array(
    z.object({
      cause: z.string(),
      likelihood: z.enum(LIKELIHOODS),
      steps: z.array(z.string()),
      sources: z.array(z.string()),
    }),
  ),
  note: z.string(),
  sources: z.array(SourceSchema),
});
export type SuggestionContent = z.infer<typeof SuggestionContentSchema>;

export interface SuggestionView extends SuggestionContent {
  id: string;
  useful: boolean | null;
  by: string;
  createdAt: Date;
}

export function suggestionView(
  row: { id: string; content: unknown; useful: boolean | null; createdAt: Date },
  by: string,
): SuggestionView | null {
  const parsed = SuggestionContentSchema.safeParse(row.content);
  if (!parsed.success) return null;
  return { id: row.id, ...parsed.data, useful: row.useful, by, createdAt: row.createdAt };
}
