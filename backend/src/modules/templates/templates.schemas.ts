// Company templates (docs/spec/plantillas.md): the stored tree and the request bodies.
import { templateLimits } from "@spiderfolio/limits";
import { z } from "zod";
import { pageShape, SearchParam } from "../../lib/pagination.ts";
import { nameKeyOf } from "../../lib/names.ts";

const NodeName = z.string().trim().min(1).max(255);
const Icon = z.string().max(64).nullable();

/** A page of the tree. Its content is checked again with packages/content when it's used. */
export interface SnapshotPage {
  type: "PAGE";
  name: string;
  icon: string | null;
  cover: string | null;
  content: unknown;
  /** It was a controlled document: its type and responsible department, never its code. */
  controlled: { docType: string; ownerDepartmentId: string | null } | null;
  children: SnapshotNode[];
}

export interface SnapshotFolder {
  type: "FOLDER";
  name: string;
  icon: string | null;
  children: SnapshotNode[];
}

export type SnapshotNode = SnapshotPage | SnapshotFolder;

/** Brothers can't share a name (the same rule as the tree). */
function distinctNames(children: readonly SnapshotNode[]): boolean {
  const keys = children.map((child) => nameKeyOf(child.name));
  return new Set(keys).size === keys.length;
}

export const SnapshotNodeSchema: z.ZodType<SnapshotNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("PAGE"),
      name: NodeName,
      icon: Icon,
      cover: z.string().max(32).nullable(),
      content: z.unknown(),
      controlled: z
        .strictObject({
          docType: z.string().trim().min(1).max(10),
          ownerDepartmentId: z.string().max(40).nullable(),
        })
        .nullable(),
      children: z.array(SnapshotNodeSchema).max(templateLimits.nodesMax).refine(distinctNames),
    }),
    z.strictObject({
      type: z.literal("FOLDER"),
      name: NodeName,
      icon: Icon,
      children: z.array(SnapshotNodeSchema).max(templateLimits.nodesMax).refine(distinctNames),
    }),
  ]),
);

export const SNAPSHOT_FORMAT = 1;

export const TemplateSnapshotSchema = z.strictObject({
  format: z.literal(SNAPSHOT_FORMAT),
  root: SnapshotNodeSchema,
});
export type TemplateSnapshot = z.infer<typeof TemplateSnapshotSchema>;

const TemplateName = z.string().trim().min(1).max(templateLimits.nameMax);
const Description = z.string().trim().max(templateLimits.descriptionMax);
const Category = z.string().trim().max(templateLimits.categoryMax);

export const SaveTemplateSchema = z.strictObject({
  name: TemplateName,
  description: Description.default(""),
  /** Empty: no category. */
  category: Category.default(""),
});
export type SaveTemplateInput = z.infer<typeof SaveTemplateSchema>;

export const UpdateTemplateSchema = z
  .strictObject({
    name: TemplateName.optional(),
    description: Description.optional(),
    category: Category.optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateSchema>;

export const UseTemplateSchema = z.strictObject({
  spaceId: z.string().min(1).max(40),
  /** Folder or page it goes into; null = the space's root. */
  parentId: z.string().min(1).max(40).nullable(),
});
export type UseTemplateInput = z.infer<typeof UseTemplateSchema>;

export const TemplatesQuerySchema = z.strictObject({
  ...pageShape(["name", "createdAt"], "name"),
  q: SearchParam,
  category: Category.optional(),
  kind: z.enum(["PAGE", "FOLDER"]).optional(),
});
export type TemplatesQuery = z.infer<typeof TemplatesQuerySchema>;

export const TemplateParams = z.strictObject({ id: z.string().min(1).max(40) });
