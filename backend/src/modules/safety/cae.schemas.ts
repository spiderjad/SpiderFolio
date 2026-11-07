// CAE (docs/spec/cae.md, «API»): request bodies and list queries.
import { z } from "zod";
import { IdsParam, pageShape, SearchParam } from "../../lib/pagination.ts";
import { validationMessages } from "../../i18n/index.ts";

const Id = z.string().min(1).max(64);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const Optional = (max: number) => z.string().trim().max(max).nullable();
const NonEmpty = <T extends object>(schema: z.ZodType<T>) =>
  schema.refine((value) => Object.keys(value).length > 0, {
    error: () => validationMessages.noChanges,
  });

export const companyKinds = ["CONTRACTOR", "SUBCONTRACTOR", "CONCURRENT"] as const;
export const caeStates = ["authorized", "incomplete", "blocked", "archived"] as const;

const CompanyShape = {
  name: z.string().trim().min(1).max(120),
  taxId: Optional(20),
  kind: z.enum(companyKinds),
  parentId: Id.nullable(),
  activity: z.string().trim().max(500),
  contactName: Optional(120),
  contactEmail: z.email().max(254).nullable(),
  contactPhone: Optional(40),
  responsibleId: Id,
  startsOn: Day.nullable(),
  endsOn: Day.nullable(),
};

export const CreateCompanySchema = z.strictObject({
  name: CompanyShape.name,
  taxId: CompanyShape.taxId.optional(),
  kind: CompanyShape.kind,
  parentId: CompanyShape.parentId.optional(),
  activity: CompanyShape.activity.default(""),
  contactName: CompanyShape.contactName.optional(),
  contactEmail: CompanyShape.contactEmail.optional(),
  contactPhone: CompanyShape.contactPhone.optional(),
  responsibleId: CompanyShape.responsibleId,
  startsOn: CompanyShape.startsOn.optional(),
  endsOn: CompanyShape.endsOn.optional(),
});

export const UpdateCompanySchema = NonEmpty(z.strictObject(CompanyShape).partial());

export const ListCompaniesQuerySchema = z.object({
  ...pageShape(["name"], "name"),
  q: SearchParam,
  ids: IdsParam,
  kind: z.enum(companyKinds).optional(),
  /** Without it: everything but archived. */
  status: z.enum(caeStates).optional(),
});

export const BlockSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });

const WorkerShape = {
  name: z.string().trim().min(1).max(120),
  idNumber: Optional(20),
  task: Optional(120),
};

export const CreateWorkerSchema = z.strictObject({
  name: WorkerShape.name,
  idNumber: WorkerShape.idNumber.optional(),
  task: WorkerShape.task.optional(),
});

export const UpdateWorkerSchema = NonEmpty(z.strictObject(WorkerShape).partial());

export const ListWorkersQuerySchema = z.object({
  ...pageShape(["name"], "name"),
  q: SearchParam,
  status: z.enum(caeStates).optional(),
});

const RequirementShape = {
  name: z.string().trim().min(1).max(120),
  scope: z.enum(["COMPANY", "WORKER"]),
  validityMonths: z.number().int().min(1).max(120).nullable(),
  appliesTo: z.enum(["ALL", "CONTRACTOR", "CONCURRENT"]),
  required: z.boolean(),
};

export const CreateRequirementSchema = z.strictObject({
  name: RequirementShape.name,
  scope: RequirementShape.scope,
  validityMonths: RequirementShape.validityMonths.optional(),
  appliesTo: RequirementShape.appliesTo.default("ALL"),
  required: RequirementShape.required.default(true),
});

/** The scope doesn't change: the documents already given are about a company or a worker. */
export const UpdateRequirementSchema = NonEmpty(
  z
    .strictObject({
      name: RequirementShape.name,
      validityMonths: RequirementShape.validityMonths,
      appliesTo: RequirementShape.appliesTo,
      required: RequirementShape.required,
      /** false brings an archived one back. */
      archived: z.literal(false),
    })
    .partial(),
);

export const ListRequirementsQuerySchema = z.object({
  ...pageShape(["position"], "position", { defaultPageSize: 100 }),
  scope: z.enum(["COMPANY", "WORKER"]).optional(),
  status: z.enum(["active", "archived", "all"]).default("active"),
});

/** The active requirements of a scope, in their new order. */
export const OrderRequirementsSchema = z.strictObject({
  scope: z.enum(["COMPANY", "WORKER"]),
  ids: z.array(Id).min(1).max(200),
});

/** A file already uploaded to the company's folder, for one requirement. */
export const CreateDocumentSchema = z.strictObject({
  requirementId: Id,
  companyId: Id,
  workerId: Id.nullable().optional(),
  nodeId: Id,
  /** Without it, proposed from the requirement's validity. */
  validUntil: Day.nullable().optional(),
  /** Whoever manages CAE accepts it right away. */
  accept: z.boolean().default(false),
});

export const AcceptDocumentSchema = z.strictObject({ validUntil: Day.nullable().optional() });

export const RejectDocumentSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });

export const ListDocumentsQuerySchema = z.object({
  ...pageShape(["createdAt"], "createdAt"),
  status: z.enum(["pending", "accepted", "rejected"]).optional(),
  /** A requirement's history: with the company (its own documents) or with the worker. */
  requirementId: Id.optional(),
  companyId: Id.optional(),
  /** Takes precedence over companyId. */
  workerId: Id.optional(),
});

export const IdParamsSchema = z.object({ id: Id });

export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof UpdateCompanySchema>;
export type ListCompaniesQuery = z.infer<typeof ListCompaniesQuerySchema>;
export type CreateWorkerInput = z.infer<typeof CreateWorkerSchema>;
export type UpdateWorkerInput = z.infer<typeof UpdateWorkerSchema>;
export type ListWorkersQuery = z.infer<typeof ListWorkersQuerySchema>;
export type CreateRequirementInput = z.infer<typeof CreateRequirementSchema>;
export type UpdateRequirementInput = z.infer<typeof UpdateRequirementSchema>;
export type ListRequirementsQuery = z.infer<typeof ListRequirementsQuerySchema>;
export type OrderRequirementsInput = z.infer<typeof OrderRequirementsSchema>;
export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>;
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;
