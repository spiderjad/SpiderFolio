import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";

const Id = z.string().min(1).max(64);

export const PageParamsSchema = z.object({ id: Id });
export const ThreadParamsSchema = z.object({ id: Id, threadId: Id });
export const MessageParamsSchema = z.object({ id: Id, threadId: Id, commentId: Id });

const Body = z.string().trim().min(1).max(4000);

export const ListThreadsQuerySchema = z.object({
  /** open (por defecto), resolved o all. */
  status: z.enum(["open", "resolved", "all"]).default("open"),
  /** Solo los hilos que abrí yo. */
  mine: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ...pageShape(["createdAt"], "createdAt"),
});

/** Con `quote` el hilo queda anclado al fragmento elegido; sin `quote` es un comentario general. */
export const CreateThreadSchema = z.strictObject({
  body: Body,
  quote: z.string().trim().min(1).max(300).optional(),
});

export const ReplySchema = z.strictObject({ body: Body });
export const EditCommentSchema = z.strictObject({ body: Body });

export const CandidatesQuerySchema = z.object({ q: z.string().trim().max(80).default("") });

export type ListThreadsQuery = z.infer<typeof ListThreadsQuerySchema>;
export type CreateThreadInput = z.infer<typeof CreateThreadSchema>;
