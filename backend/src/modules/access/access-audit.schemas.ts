import { z } from "zod";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import { ExplainQuerySchema } from "./access-explain.schemas.ts";

const Id = z.string().min(1).max(64);

export const ReportKindSchema = z.enum(["cut-inheritance", "direct-people", "guests", "expiring"]);
export type ReportKind = z.infer<typeof ReportKindSchema>;

export const ReportParamsSchema = z.object({ kind: ReportKindSchema });

/** Matriz: los departamentos van por `cursor` y los espacios (columnas) por `spaceCursor`. */
export const MatrixQuerySchema = z.object({
  q: SearchParam,
  spaceCursor: z.string().max(100).optional(),
  ...pageShape(["name"], "name"),
});
export type MatrixQuery = z.infer<typeof MatrixQuerySchema>;

/** Espacios con sus personas agrupadas por nivel (pocos por página: cada uno trae sus grupos). */
export const SpacesOverviewQuerySchema = z.object({
  q: SearchParam,
  ...pageShape(["name"], "name", { defaultPageSize: 10 }),
});
export type SpacesOverviewQuery = z.infer<typeof SpacesOverviewQuerySchema>;

/** El detalle de una celda de la matriz: un departamento en un espacio. */
export const MatrixCellQuerySchema = z.object({
  departmentId: Id,
  spaceId: Id,
  ...pageShape(["name"], "name"),
});
export type MatrixCellQuery = z.infer<typeof MatrixCellQuerySchema>;

/** Buscar un espacio o un elemento por nombre, para preguntar «¿quién puede ver esto?». */
export const FindTargetQuerySchema = z.object({
  q: SearchParam,
  kind: z.enum(["space", "node"]).default("space"),
  ...pageShape(["name"], "name"),
});
export type FindTargetQuery = z.infer<typeof FindTargetQuerySchema>;

export const WhoQuerySchema = ExplainQuerySchema.extend({
  type: z.enum(["space", "node"]),
  id: Id,
});
export type WhoQuery = z.infer<typeof WhoQuerySchema>;

export const PersonParamsSchema = z.object({ membershipId: Id });

export const PersonQuerySchema = z.object({
  q: SearchParam,
  ...pageShape(["name"], "name"),
});
export type PersonQuery = z.infer<typeof PersonQuerySchema>;

export const ReportQuerySchema = z.object({
  /** Solo el informe de accesos directos a personas: de una sola persona. */
  membershipId: Id.optional(),
  ...pageShape(["createdAt"], "createdAt"),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;
