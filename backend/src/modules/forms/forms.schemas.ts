// A form's template (docs/spec/formularios.md): the fields people fill in. Each field has its own id
// (made by the app, kept across versions), a label, an optional help text and whether it's required.
// What counts as non-conforming is part of the field: a number out of its range, the «yes» or «no» the
// form marks, the options it marks, a checklist item left unchecked.
import { z } from "zod";
import { formMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
/** A field's or an option's id: made by the app, short and safe in a CSV header or a URL. */
const FieldId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/u);
const Label = z.string().trim().min(1).max(200);
const Option = z.strictObject({ id: FieldId, label: Label });

const base = {
  id: FieldId,
  label: Label,
  help: z.string().trim().max(500).optional(),
  required: z.boolean().default(false),
};

export const FieldSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("text"), multiline: z.boolean().default(false) }),
  z.strictObject({
    ...base,
    type: z.literal("number"),
    unit: z.string().trim().max(20).optional(),
    /** Acceptable range: a value outside it is non-conforming. */
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal("yesno"),
    /** The answer that is non-conforming, if any. */
    nonConforming: z.enum(["yes", "no"]).nullable().default(null),
  }),
  z.strictObject({
    ...base,
    type: z.literal("choice"),
    options: z.array(Option).min(2).max(50),
    /** Ids of the options that are non-conforming. */
    nonConforming: z.array(FieldId).max(50).default([]),
  }),
  z.strictObject({ ...base, type: z.literal("date") }),
  z.strictObject({
    ...base,
    type: z.literal("checklist"),
    /** Every item has to be checked: one left unchecked is non-conforming. */
    items: z.array(Option).min(1).max(50),
  }),
  z.strictObject({
    ...base,
    type: z.literal("photo"),
    max: z.number().int().min(1).max(10).default(1),
  }),
  z.strictObject({ ...base, type: z.literal("signature") }),
]);

export type FormField = z.infer<typeof FieldSchema>;

export const FieldsSchema = z
  .array(FieldSchema)
  .max(100)
  .superRefine((fields, ctx) => {
    const ids = new Set<string>();
    for (const field of fields) {
      if (ids.has(field.id)) ctx.addIssue({ code: "custom", message: formMessages.duplicateId });
      ids.add(field.id);
      const options =
        field.type === "choice" ? field.options : field.type === "checklist" ? field.items : [];
      const optionIds = new Set(options.map((option) => option.id));
      if (optionIds.size !== options.length) {
        ctx.addIssue({ code: "custom", message: formMessages.duplicateId });
      }
      if (field.type === "number" && field.min !== undefined && field.max !== undefined) {
        if (field.min > field.max)
          ctx.addIssue({ code: "custom", message: formMessages.rangeInverted });
      }
      if (field.type === "choice" && field.nonConforming.some((id) => !optionIds.has(id))) {
        ctx.addIssue({ code: "custom", message: formMessages.unknownOption });
      }
    }
  });

export const CreateFormSchema = z.strictObject({
  parentId: Id.nullable().optional(),
  name: z.string().max(255).optional(),
});
export type CreateFormInput = z.infer<typeof CreateFormSchema>;

/** Saving the template: based on the version the editor loaded (a newer one is a conflict). */
export const SaveTemplateSchema = z.strictObject({
  baseVersion: z.number().int().min(1),
  fields: FieldsSchema,
});
export type SaveTemplateInput = z.infer<typeof SaveTemplateSchema>;

export const FormParamsSchema = z.object({ id: Id });
export const FormVersionParamsSchema = z.object({
  id: Id,
  version: z.coerce.number().int().min(1),
});

/** A photo or signature for a field: re-encoded by the browser (JPG, PNG or WebP; the signature PNG). */
export const StartFileSchema = z.strictObject({
  fieldId: FieldId,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});

/** A filled-in form: the version it was filled with and the answers by field id. */
export const SubmitRecordSchema = z.strictObject({
  version: z.number().int().min(1),
  answers: z.record(FieldId, z.unknown()),
  source: z.enum(["app", "qr"]).default("app"),
});

export const FormFileParamsSchema = z.object({ id: Id, fileId: Id });
export const RecordParamsSchema = z.object({ id: Id, recordId: Id });
export const RecordFileParamsSchema = z.object({ id: Id, recordId: Id, fileId: Id });

/**
 * How the form runs: who's in charge and, if it's periodic, how often and who fills it in. A daily form
 * needs at least one weekday; a periodic one at least one person or department.
 */
export const SettingsSchema = z
  .strictObject({
    responsible: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("default") }),
      z.strictObject({ type: z.literal("person"), id: Id }),
      z.strictObject({ type: z.literal("department"), id: Id }),
    ]),
    frequency: z.enum(["none", "daily", "weekly", "monthly"]),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    assignees: z.strictObject({
      people: z.array(Id).max(200).default([]),
      departments: z.array(Id).max(100).default([]),
    }),
  })
  .superRefine((settings, ctx) => {
    if (settings.frequency === "daily" && settings.weekdays.length === 0) {
      ctx.addIssue({ code: "custom", message: formMessages.weekdaysRequired, path: ["weekdays"] });
    }
    if (
      settings.frequency !== "none" &&
      settings.assignees.people.length + settings.assignees.departments.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: formMessages.assigneesRequired,
        path: ["assignees"],
      });
    }
  });
export type SettingsInput = z.infer<typeof SettingsSchema>;
