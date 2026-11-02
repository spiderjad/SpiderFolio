// PPE (docs/spec/seguridad-salud.md, «EPIs»): request bodies and list queries.
import { z } from "zod";
import { IdsParam, pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const ItemShape = {
  name: z.string().trim().min(2).max(80),
  category: z.string().trim().max(60).nullable(),
  hasSizes: z.boolean(),
  lifeMonths: z.number().int().min(1).max(120).nullable(),
  positionIds: z.array(Id).max(100),
};

export const CreateItemSchema = z.strictObject({
  name: ItemShape.name,
  category: ItemShape.category.optional(),
  hasSizes: ItemShape.hasSizes.default(false),
  lifeMonths: ItemShape.lifeMonths.optional(),
  positionIds: ItemShape.positionIds.default([]),
});

export const UpdateItemSchema = z
  .strictObject({ ...ItemShape, archived: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    error: () => validationMessages.noChanges,
  });

export const ListItemsQuerySchema = z.object({
  ...pageShape(["name"], "name", { defaultPageSize: 50 }),
  q: SearchParam,
  ids: IdsParam,
  /** active (default), archived or all. */
  status: z.enum(["active", "archived", "all"]).default("active"),
});

/** A PNG as a data URL: the recipient's signature (up to ~300 KB). */
const Signature = z
  .string()
  .max(400_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u);

export const CreateDeliverySchema = z.strictObject({
  membershipId: Id,
  lines: z
    .array(
      z.strictObject({
        itemId: Id,
        quantity: z.number().int().min(1).max(100),
        size: z.string().trim().min(1).max(20).nullable().optional(),
      }),
    )
    .min(1)
    .max(30),
  note: z.string().trim().max(500).nullable().optional(),
  signature: Signature,
});

export const ListDeliveriesQuerySchema = z.object({
  ...pageShape(["deliveredAt"], "deliveredAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  person: Id.optional(),
  item: Id.optional(),
  from: Day.optional(),
  to: Day.optional(),
  status: z.enum(["all", "valid", "voided"]).default("all"),
});

export const VoidDeliverySchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });

export const IdParamsSchema = z.object({ id: Id });

export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
export type ListItemsQuery = z.infer<typeof ListItemsQuerySchema>;
export type CreateDeliveryInput = z.infer<typeof CreateDeliverySchema>;
export type ListDeliveriesQuery = z.infer<typeof ListDeliveriesQuerySchema>;
