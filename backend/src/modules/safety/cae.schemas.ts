// CAE (docs/spec/cae.md, «API»): request bodies and list queries.
import { z } from "zod";
import { IdsParam, pageShape, SearchParam } from "../../lib/pagination.ts";
import { caeLimits } from "@spiderfolio/limits";
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

/** The gate's search: name, the end of the ID or the company's name. */
export const CheckQuerySchema = z.object({
  ...pageShape(["name"], "name", { defaultPageSize: 10 }),
  q: z.string().trim().min(1).max(100),
});

export const AccessSchema = z.strictObject({
  workerId: Id,
  direction: z.enum(["IN", "OUT"]),
});

export const ListAccessesQuerySchema = z.object({
  ...pageShape(["at"], "at", { defaultPageSize: 50 }),
  /** A company day; today without it. */
  day: Day.optional(),
  companyId: Id.optional(),
});

/** A PNG as a data URL: a signature (up to ~300 KB). */
const Signature = z
  .string()
  .max(400_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u);

// ─── Site information (RD 171/2004, arts. 7 to 9) ────────────────────────────────────────

export const UpdateInfoSchema = NonEmpty(
  z
    .strictObject({
      nodeIds: z.array(Id).max(caeLimits.infoMaxDocuments),
      required: z.boolean(),
    })
    .partial(),
);

/** Controlled documents in force, to choose the information documents. */
export const InfoOptionsQuerySchema = z.object({
  ...pageShape(["code"], "code", { defaultPageSize: 20 }),
  q: SearchParam,
  ids: IdsParam,
});

export const CreateInfoDeliverySchema = z.strictObject({
  /** Some of the information documents; all of them without it. */
  nodeIds: z.array(Id).min(1).max(caeLimits.infoMaxDocuments).optional(),
  /** Today without it. */
  deliveredOn: Day.optional(),
  receivedBy: z.string().trim().min(2).max(120),
  signature: Signature.nullable().optional(),
});

export const ListInfoDeliveriesQuerySchema = z.object({
  ...pageShape(["deliveredOn"], "deliveredOn"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

// ─── Work permits ────────────────────────────────────────────────────────────────────────

export const permitTypes = ["HOT_WORK", "HEIGHT", "CONFINED_SPACE", "ELECTRICAL", "OTHER"] as const;
export const permitStatuses = ["DRAFT", "ACTIVE", "CLOSED", "CANCELLED"] as const;

const Precautions = z
  .array(z.strictObject({ label: z.string().trim().min(1).max(200), done: z.boolean() }))
  .max(caeLimits.permitMaxPrecautions);

const PermitShape = {
  type: z.enum(permitTypes),
  customName: z.string().trim().min(1).max(80).nullable(),
  companyId: Id.nullable(),
  location: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  validFrom: z.iso.datetime({ offset: true }),
  validTo: z.iso.datetime({ offset: true }),
  workerIds: z.array(Id).max(caeLimits.permitMaxPeople),
  membershipIds: z.array(Id).max(caeLimits.permitMaxPeople),
  precautions: Precautions,
};

export const CreatePermitSchema = z.strictObject({
  ...PermitShape,
  customName: PermitShape.customName.optional(),
  companyId: PermitShape.companyId.optional(),
  description: PermitShape.description.default(""),
  workerIds: PermitShape.workerIds.default([]),
  membershipIds: PermitShape.membershipIds.default([]),
  precautions: Precautions.default([]),
});

/** Only while it's a draft. */
export const UpdatePermitSchema = NonEmpty(z.strictObject(PermitShape).partial());

/** Whoever approves signs; the checklist can be ticked at that moment. */
export const ApprovePermitSchema = z.strictObject({
  signature: Signature,
  precautions: Precautions.optional(),
});

export const ClosePermitSchema = z.strictObject({ note: z.string().trim().max(1000).optional() });

export const CancelPermitSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });

export const ListPermitsQuerySchema = z.object({
  ...pageShape(["validFrom"], "validFrom"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(permitStatuses).optional(),
  type: z.enum(permitTypes).optional(),
  companyId: Id.optional(),
  /** Permits valid at some point of that company day. */
  day: Day.optional(),
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
export type CheckQuery = z.infer<typeof CheckQuerySchema>;
export type AccessInput = z.infer<typeof AccessSchema>;
export type ListAccessesQuery = z.infer<typeof ListAccessesQuerySchema>;
export type UpdateInfoInput = z.infer<typeof UpdateInfoSchema>;
export type InfoOptionsQuery = z.infer<typeof InfoOptionsQuerySchema>;
export type CreateInfoDeliveryInput = z.infer<typeof CreateInfoDeliverySchema>;
export type ListInfoDeliveriesQuery = z.infer<typeof ListInfoDeliveriesQuerySchema>;
export type CreatePermitInput = z.infer<typeof CreatePermitSchema>;
export type UpdatePermitInput = z.infer<typeof UpdatePermitSchema>;
export type ApprovePermitInput = z.infer<typeof ApprovePermitSchema>;
export type ListPermitsQuery = z.infer<typeof ListPermitsQuerySchema>;
