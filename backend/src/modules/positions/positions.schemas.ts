// Job positions (docs/spec/seguridad-salud.md, «Puestos»): request bodies and the list query.
import { z } from "zod";
import { IdsParam, pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Name = z.string().trim().min(2).max(80);
const Description = z.string().trim().max(200).nullable();

export const CreatePositionSchema = z.strictObject({
  name: Name,
  description: Description.optional(),
});

export const UpdatePositionSchema = z
  .strictObject({ name: Name, description: Description })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    error: () => validationMessages.noChanges,
  });

export const ListPositionsQuerySchema = z.object({
  ...pageShape(["name", "people"], "name"),
  q: SearchParam,
  /** Only these (a combobox showing what's already chosen). */
  ids: IdsParam,
});

export const PositionParamsSchema = z.object({ id: z.string().min(1).max(64) });

export type CreatePositionInput = z.infer<typeof CreatePositionSchema>;
export type UpdatePositionInput = z.infer<typeof UpdatePositionSchema>;
export type ListPositionsQuery = z.infer<typeof ListPositionsQuerySchema>;
