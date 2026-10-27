import { z } from "zod";
import { pageShape, SearchParam } from "../../lib/pagination.ts";

const Id = z.string().min(1).max(64);

export const ExplainParamsSchema = z.object({ id: Id });

/** Personas con acceso: `level` ordena de mayor a menor nivel con `asc`. */
export const ExplainQuerySchema = z.object({
  q: SearchParam,
  ...pageShape(["level", "name"], "level"),
});

export type ExplainQuery = z.infer<typeof ExplainQuerySchema>;
