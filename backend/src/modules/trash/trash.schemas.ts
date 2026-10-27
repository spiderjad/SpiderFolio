import { z } from "zod";
import { pageShape } from "../../lib/pagination.ts";

const Id = z.string().min(1).max(64);

export const SpaceParamsSchema = z.object({ id: Id });
export const NodeParamsSchema = z.object({ id: Id });

export const ListTrashQuerySchema = z.object({ ...pageShape(["name"], "name") });

export type ListTrashQuery = z.infer<typeof ListTrashQuerySchema>;
