// forTenant (CLAUDE.md, sección 7.4): acceso a datos de un solo workspace.
//
// Es un envoltorio sobre el cliente base (o sobre una transacción) que expone solo los
// modelos con tenant y solo las operaciones permitidas. A nivel de tipos no existen los
// modelos globales ni $queryRaw/$executeRaw; en ejecución:
// - toda lectura, actualización y borrado agrega la condición del workspace al where;
// - toda creación inyecta workspaceId (y falla si llega otro);
// - ninguna actualización puede cambiar workspaceId;
// - no hay escrituras anidadas: las relaciones se escriben con claves escalares, y las claves
//   foráneas compuestas (id, workspaceId) impiden en la base apuntar a otro tenant;
// - where, select, include y orderBy no pueden recorrer relaciones desde un modelo global
//   (ej. membership → user → memberships expondría otros workspaces);
// - los resultados son promesas comunes: la API fluida de Prisma no está disponible.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { modelMetadata, relationsOf, type ModelName } from "./model-metadata.ts";

type BaseClient = PrismaClient | Prisma.TransactionClient;

const readOps = [
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
] as const;
const writeOps = [
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
] as const;
const workspaceOps = [
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "update",
] as const;
const appendOnlyOps = [...readOps, "create", "createMany"] as const;

type ReadOp = (typeof readOps)[number];
type WriteOp = (typeof writeOps)[number];
type Op = ReadOp | WriteOp;

// Los argumentos son los de Prisma sin workspaceId en los datos (lo pone forTenant) y el
// resultado se calcula con Prisma.Result, así select/include siguen tipando el retorno.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type WithoutTenant<T> = T extends readonly (infer U)[]
  ? DistributiveOmit<U, "workspaceId">[]
  : DistributiveOmit<T, "workspaceId">;
type TenantArgs<A> = {
  [K in keyof A]: K extends "data" | "create" | "update" ? WithoutTenant<A[K]> : A[K];
};
type TenantDelegate<D, Ops extends Op> = {
  [O in Ops]: <A extends TenantArgs<Prisma.Args<D, O>>>(
    args?: A,
  ) => Promise<Prisma.Result<D, A, O>>;
};

export interface TenantDb {
  readonly workspaceId: string;
  workspace: TenantDelegate<PrismaClient["workspace"], (typeof workspaceOps)[number]>;
  role: TenantDelegate<PrismaClient["role"], Op>;
  membership: TenantDelegate<PrismaClient["membership"], Op>;
  department: TenantDelegate<PrismaClient["department"], Op>;
  departmentMember: TenantDelegate<PrismaClient["departmentMember"], Op>;
  invitation: TenantDelegate<PrismaClient["invitation"], Op>;
  space: TenantDelegate<PrismaClient["space"], Op>;
  node: TenantDelegate<PrismaClient["node"], Op>;
  permission: TenantDelegate<PrismaClient["permission"], Op>;
  fileVersion: TenantDelegate<PrismaClient["fileVersion"], Op>;
  uploadReservation: TenantDelegate<PrismaClient["uploadReservation"], Op>;
  importJob: TenantDelegate<PrismaClient["importJob"], Op>;
  spaceUserState: TenantDelegate<PrismaClient["spaceUserState"], Op>;
  downloadToken: TenantDelegate<PrismaClient["downloadToken"], Op>;
  zipExport: TenantDelegate<PrismaClient["zipExport"], Op>;
  pageContent: TenantDelegate<PrismaClient["pageContent"], Op>;
  formVersion: TenantDelegate<
    PrismaClient["formVersion"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  formRecord: TenantDelegate<
    PrismaClient["formRecord"],
    "findFirst" | "findMany" | "count" | "groupBy" | "create" | "updateMany"
  >;
  formFile: TenantDelegate<PrismaClient["formFile"], Op>;
  formSettings: TenantDelegate<PrismaClient["formSettings"], Op>;
  position: TenantDelegate<PrismaClient["position"], Op>;
  expiry: TenantDelegate<PrismaClient["expiry"], Op>;
  safetyItem: TenantDelegate<PrismaClient["safetyItem"], Op>;
  // Handouts are never deleted here: added, read and voided (an update).
  safetyDelivery: TenantDelegate<
    PrismaClient["safetyDelivery"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "updateMany"
  >;
  safetyDeliveryLine: TenantDelegate<
    PrismaClient["safetyDeliveryLine"],
    "findFirst" | "findMany" | "count" | "createMany" | "createManyAndReturn"
  >;
  // Incidents are never deleted here (their record is evidence); their measures are.
  safetyIncident: TenantDelegate<
    PrismaClient["safetyIncident"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "updateMany"
  >;
  safetyAction: TenantDelegate<PrismaClient["safetyAction"], Op>;
  safetyCourse: TenantDelegate<PrismaClient["safetyCourse"], Op>;
  safetySignSession: TenantDelegate<PrismaClient["safetySignSession"], Op>;
  auditRoom: TenantDelegate<PrismaClient["auditRoom"], Op>;
  auditRoomItem: TenantDelegate<PrismaClient["auditRoomItem"], Op>;
  auditRoomCode: TenantDelegate<PrismaClient["auditRoomCode"], Op>;
  auditRoomSession: TenantDelegate<PrismaClient["auditRoomSession"], Op>;
  // The auditor's accesses are evidence: added and read, never changed.
  auditRoomAccess: TenantDelegate<
    PrismaClient["auditRoomAccess"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  // Fitness records are history: added and read only.
  safetyFitness: TenantDelegate<
    PrismaClient["safetyFitness"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  // Training records are evidence: added and read, never changed nor deleted.
  safetyTraining: TenantDelegate<
    PrismaClient["safetyTraining"],
    "findFirst" | "findMany" | "count" | "create" | "createManyAndReturn"
  >;
  // CAE (docs/spec/cae.md): companies and workers are archived, never deleted here.
  caeCompany: TenantDelegate<
    PrismaClient["caeCompany"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "updateMany"
  >;
  caeWorker: TenantDelegate<
    PrismaClient["caeWorker"],
    "findFirst" | "findMany" | "count" | "groupBy" | "create" | "update" | "updateMany"
  >;
  caeRequirement: TenantDelegate<
    PrismaClient["caeRequirement"],
    "findFirst" | "findMany" | "count" | "create" | "createMany" | "update" | "updateMany"
  >;
  // Documents are evidence: added, reviewed (an update) and read; never deleted.
  caeDocument: TenantDelegate<
    PrismaClient["caeDocument"],
    "findFirst" | "findMany" | "count" | "groupBy" | "create" | "update" | "updateMany"
  >;
  // The gatehouse log is evidence: added and read, never changed.
  caeAccess: TenantDelegate<
    PrismaClient["caeAccess"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  // Information deliveries are evidence: added and read, never changed.
  caeInfoDelivery: TenantDelegate<
    PrismaClient["caeInfoDelivery"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  // Work permits are evidence: issued, approved, closed or cancelled (updates); never deleted.
  caeWorkPermit: TenantDelegate<
    PrismaClient["caeWorkPermit"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  // The contractors' portal: accesses are revoked (an update), sessions ended; nothing is deleted.
  caePortalAccess: TenantDelegate<
    PrismaClient["caePortalAccess"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "updateMany"
  >;
  caePortalSession: TenantDelegate<
    PrismaClient["caePortalSession"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "updateMany"
  >;
  caePortalUpload: TenantDelegate<
    PrismaClient["caePortalUpload"],
    "findFirst" | "count" | "create" | "updateMany"
  >;
  // Monthly hours and headcount: entered and corrected, never deleted.
  safetyMonthStat: TenantDelegate<
    PrismaClient["safetyMonthStat"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  safetyEmergencyRole: TenantDelegate<
    PrismaClient["safetyEmergencyRole"],
    "findFirst" | "findMany" | "count" | "create" | "createMany" | "update"
  >;
  // Team membership is configuration: added and removed.
  safetyEmergencyMember: TenantDelegate<PrismaClient["safetyEmergencyMember"], Op>;
  // Drills are a record: added and corrected, never deleted.
  safetyDrill: TenantDelegate<
    PrismaClient["safetyDrill"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  // The committee's history: a term is ended, never deleted.
  safetyCommitteeMember: TenantDelegate<
    PrismaClient["safetyCommitteeMember"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  // Meetings are a record: added and corrected, never deleted.
  safetyMeeting: TenantDelegate<
    PrismaClient["safetyMeeting"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  // Food quality (docs/spec/calidad.md): a nonconformity is cancelled, never deleted; its history and
  // effectiveness checks are only added.
  qualityNc: TenantDelegate<
    PrismaClient["qualityNc"],
    "findFirst" | "findMany" | "count" | "groupBy" | "create" | "update" | "updateMany"
  >;
  qualityNcCounter: TenantDelegate<PrismaClient["qualityNcCounter"], "upsert">;
  qualityAction: TenantDelegate<
    PrismaClient["qualityAction"],
    "findFirst" | "findMany" | "count" | "groupBy" | "create" | "update"
  >;
  qualityVerification: TenantDelegate<
    PrismaClient["qualityVerification"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  qualityNcEvent: TenantDelegate<
    PrismaClient["qualityNcEvent"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  // HACCP critical control points are archived, never deleted; a hold's decision is never undone.
  qualityCcp: TenantDelegate<
    PrismaClient["qualityCcp"],
    "findFirst" | "findMany" | "count" | "create" | "createMany" | "update"
  >;
  // Audits are cancelled, never deleted; findings are only added (and given their NC).
  qualityAudit: TenantDelegate<
    PrismaClient["qualityAudit"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualityFinding: TenantDelegate<
    PrismaClient["qualityFinding"],
    "findFirst" | "findMany" | "count" | "groupBy" | "create" | "update"
  >;
  // Suppliers and their documents are archived, never deleted; reviews are only added.
  qualitySupplier: TenantDelegate<
    PrismaClient["qualitySupplier"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualitySupplierDoc: TenantDelegate<
    PrismaClient["qualitySupplierDoc"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualitySupplierReview: TenantDelegate<
    PrismaClient["qualitySupplierReview"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  // Complaints are closed, never deleted; recall tests are only added; the crisis team and the units
  // sold are configuration.
  qualityComplaint: TenantDelegate<
    PrismaClient["qualityComplaint"],
    "findFirst" | "findMany" | "count" | "groupBy" | "create" | "update"
  >;
  qualityMonthUnits: TenantDelegate<PrismaClient["qualityMonthUnits"], "findMany" | "upsert">;
  qualityCrisisMember: TenantDelegate<
    PrismaClient["qualityCrisisMember"],
    "findFirst" | "findMany" | "count" | "create" | "deleteMany"
  >;
  qualityCrisisContact: TenantDelegate<
    PrismaClient["qualityCrisisContact"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualityRecallTest: TenantDelegate<
    PrismaClient["qualityRecallTest"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  // Prerequisite controls are archived, never deleted; their checks are only added.
  qualityPrp: TenantDelegate<
    PrismaClient["qualityPrp"],
    "findFirst" | "findMany" | "count" | "groupBy" | "create" | "update"
  >;
  qualityPrpCheck: TenantDelegate<
    PrismaClient["qualityPrpCheck"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  // Products and sampling points are archived, never deleted; studies are closed once, labels
  // reviewed once (and superseded), lab results only added.
  qualityProduct: TenantDelegate<
    PrismaClient["qualityProduct"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualityShelfLifeStudy: TenantDelegate<
    PrismaClient["qualityShelfLifeStudy"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualityLabel: TenantDelegate<
    PrismaClient["qualityLabel"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "updateMany"
  >;
  qualitySamplingPoint: TenantDelegate<
    PrismaClient["qualitySamplingPoint"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualityLabResult: TenantDelegate<
    PrismaClient["qualityLabResult"],
    "findFirst" | "findMany" | "count" | "create"
  >;
  // Culture: activities archived, surveys closed, never deleted. Answers and voters are only added,
  // and an answer is never read one by one (no findFirst): only aggregated.
  qualityCulturePlan: TenantDelegate<PrismaClient["qualityCulturePlan"], "findFirst" | "upsert">;
  qualityCultureActivity: TenantDelegate<
    PrismaClient["qualityCultureActivity"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualityCultureSurvey: TenantDelegate<
    PrismaClient["qualityCultureSurvey"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualityCultureAnswer: TenantDelegate<
    PrismaClient["qualityCultureAnswer"],
    "findMany" | "count" | "create"
  >;
  qualityCultureVoter: TenantDelegate<
    PrismaClient["qualityCultureVoter"],
    "findMany" | "count" | "create"
  >;
  qualityChange: TenantDelegate<
    PrismaClient["qualityChange"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  qualityChangeCounter: TenantDelegate<PrismaClient["qualityChangeCounter"], "upsert">;
  // Whistleblowing channel (docs/spec/canal-denuncias.md): cases are never deleted here (the purge only
  // empties their content); messages, notes, exclusions and the module's log are only added.
  whistleblowingManager: TenantDelegate<
    PrismaClient["whistleblowingManager"],
    "findFirst" | "findMany" | "deleteMany" | "upsert"
  >;
  whistleblowingCounter: TenantDelegate<PrismaClient["whistleblowingCounter"], "upsert">;
  whistleblowingCase: TenantDelegate<
    PrismaClient["whistleblowingCase"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  whistleblowingExclusion: TenantDelegate<
    PrismaClient["whistleblowingExclusion"],
    "findMany" | "create"
  >;
  whistleblowingMessage: TenantDelegate<
    PrismaClient["whistleblowingMessage"],
    "findMany" | "create"
  >;
  whistleblowingNote: TenantDelegate<PrismaClient["whistleblowingNote"], "findMany" | "create">;
  whistleblowingEvent: TenantDelegate<
    PrismaClient["whistleblowingEvent"],
    "findFirst" | "findMany" | "create"
  >;
  whistleblowingSession: TenantDelegate<PrismaClient["whistleblowingSession"], "create" | "update">;
  // Environment (docs/spec/medio-ambiente.md): catalogs are archived, never deleted; a waste
  // collection can be deleted to correct a mistake (it's audited).
  envPermit: TenantDelegate<
    PrismaClient["envPermit"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  envObligation: TenantDelegate<
    PrismaClient["envObligation"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  envObligationDone: TenantDelegate<PrismaClient["envObligationDone"], "findMany" | "create">;
  envContractor: TenantDelegate<
    PrismaClient["envContractor"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  envWaste: TenantDelegate<
    PrismaClient["envWaste"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  envWasteMovement: TenantDelegate<
    PrismaClient["envWasteMovement"],
    "findFirst" | "findMany" | "count" | "create" | "delete"
  >;
  envDischargeLimit: TenantDelegate<
    PrismaClient["envDischargeLimit"],
    "findMany" | "create" | "deleteMany"
  >;
  envDischargeSample: TenantDelegate<
    PrismaClient["envDischargeSample"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "delete"
  >;
  envMeter: TenantDelegate<
    PrismaClient["envMeter"],
    "findFirst" | "findMany" | "create" | "update"
  >;
  envReading: TenantDelegate<
    PrismaClient["envReading"],
    "findFirst" | "findMany" | "upsert" | "delete"
  >;
  envProduction: TenantDelegate<PrismaClient["envProduction"], "findMany" | "upsert">;
  envTarget: TenantDelegate<PrismaClient["envTarget"], "findMany" | "upsert" | "deleteMany">;
  envCoolingUnit: TenantDelegate<
    PrismaClient["envCoolingUnit"],
    "findFirst" | "findMany" | "create" | "update"
  >;
  // Maintenance (docs/spec/mantenimiento.md): assets are archived; work orders are never deleted
  // (cancelled); a part or a stretch of work entered by mistake can be removed (audited).
  maintAsset: TenantDelegate<
    PrismaClient["maintAsset"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  maintCounter: TenantDelegate<PrismaClient["maintCounter"], "upsert">;
  maintWorkOrder: TenantDelegate<
    PrismaClient["maintWorkOrder"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  maintLabor: TenantDelegate<
    PrismaClient["maintLabor"],
    "findFirst" | "findMany" | "create" | "update" | "delete"
  >;
  maintPartUse: TenantDelegate<
    PrismaClient["maintPartUse"],
    "findFirst" | "findMany" | "create" | "delete"
  >;
  maintEvent: TenantDelegate<PrismaClient["maintEvent"], "findMany" | "create">;
  maintRecording: TenantDelegate<
    PrismaClient["maintRecording"],
    "findFirst" | "findMany" | "create" | "updateMany"
  >;
  maintPlan: TenantDelegate<
    PrismaClient["maintPlan"],
    "findFirst" | "findMany" | "count" | "create" | "update"
  >;
  maintMeter: TenantDelegate<
    PrismaClient["maintMeter"],
    "findFirst" | "findMany" | "create" | "update"
  >;
  maintMeterReading: TenantDelegate<PrismaClient["maintMeterReading"], "findMany" | "create">;
  maintPart: TenantDelegate<
    PrismaClient["maintPart"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "updateMany"
  >;
  maintIntegrationToken: TenantDelegate<
    PrismaClient["maintIntegrationToken"],
    "findFirst" | "findMany" | "create" | "update"
  >;
  maintSuggestion: TenantDelegate<
    PrismaClient["maintSuggestion"],
    "findFirst" | "create" | "update"
  >;
  envCoolingEvent: TenantDelegate<
    PrismaClient["envCoolingEvent"],
    "findFirst" | "findMany" | "create" | "delete"
  >;
  // Traceability: manual and imported lots are corrected or deleted; what a plugin loaded is only
  // changed by that plugin.
  qualityLot: TenantDelegate<
    PrismaClient["qualityLot"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "delete"
  >;
  qualityLotLink: TenantDelegate<
    PrismaClient["qualityLotLink"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "delete"
  >;
  qualityShipment: TenantDelegate<
    PrismaClient["qualityShipment"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "delete"
  >;
  qualityHold: TenantDelegate<
    PrismaClient["qualityHold"],
    "findFirst" | "findMany" | "count" | "groupBy" | "create" | "update" | "updateMany"
  >;
  pageImage: TenantDelegate<PrismaClient["pageImage"], Op>;
  template: TenantDelegate<
    PrismaClient["template"],
    "findFirst" | "findMany" | "count" | "create" | "update" | "delete"
  >;
  templateImage: TenantDelegate<
    PrismaClient["templateImage"],
    "findMany" | "aggregate" | "createMany"
  >;
  commentThread: TenantDelegate<PrismaClient["commentThread"], Op>;
  comment: TenantDelegate<PrismaClient["comment"], Op>;
  mention: TenantDelegate<PrismaClient["mention"], Op>;
  sharedSeen: TenantDelegate<PrismaClient["sharedSeen"], Op>;
  notification: TenantDelegate<PrismaClient["notification"], Op>;
  documentType: TenantDelegate<PrismaClient["documentType"], Op>;
  approval: TenantDelegate<PrismaClient["approval"], Op>;
  readRequirement: TenantDelegate<PrismaClient["readRequirement"], Op>;
  documentVisit: TenantDelegate<PrismaClient["documentVisit"], Op>;
  qrCode: TenantDelegate<PrismaClient["qrCode"], Op>;
  workspaceEmail: TenantDelegate<PrismaClient["workspaceEmail"], Op>;
  contentChunk: TenantDelegate<PrismaClient["contentChunk"], Op>;
  contentChunkDirty: TenantDelegate<PrismaClient["contentChunkDirty"], Op>;
  usageCounter: TenantDelegate<PrismaClient["usageCounter"], Op>;
  usageCounterMember: TenantDelegate<PrismaClient["usageCounterMember"], Op>;
  bianLimit: TenantDelegate<PrismaClient["bianLimit"], Op>;
  bianFeedback: TenantDelegate<PrismaClient["bianFeedback"], Op>;
  fileText: TenantDelegate<PrismaClient["fileText"], Op>;
  readAcknowledgment: TenantDelegate<PrismaClient["readAcknowledgment"], Op>;
  controlledDocument: TenantDelegate<PrismaClient["controlledDocument"], Op>;
  documentVersion: TenantDelegate<PrismaClient["documentVersion"], Op>;
  pinLogin: TenantDelegate<PrismaClient["pinLogin"], Op>;
  workspaceLicense: TenantDelegate<PrismaClient["workspaceLicense"], Op>;
  pluginSetting: TenantDelegate<PrismaClient["pluginSetting"], Op>;
  pluginSecret: TenantDelegate<PrismaClient["pluginSecret"], Op>;
  externalIdentity: TenantDelegate<PrismaClient["externalIdentity"], Op>;
  oAuthGrant: TenantDelegate<PrismaClient["oAuthGrant"], Op>;
  ssoFlow: TenantDelegate<PrismaClient["ssoFlow"], Op>;
  /** Append-only: sin update ni delete (la retención la hace un job con el cliente base). */
  auditLog: TenantDelegate<PrismaClient["auditLog"], (typeof appendOnlyOps)[number]>;
  /** Transacción interactiva; el callback recibe otro TenantDb del mismo workspace. */
  $transaction<T>(
    fn: (db: TenantDb) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}

// TenantDb de una transacción → su cliente de transacción base. Privado: solo lo lee
// transactionClientOf, que únicamente puede importar backend/src/jobs (regla de ESLint) para
// encolar en la misma transacción. Ni req.db ni el callback de $transaction lo exponen.
const transactionClients = new WeakMap<TenantDb, Prisma.TransactionClient>();

/**
 * Solo para jobs/boss.ts (enqueue): el cliente de transacción detrás de un TenantDb recibido
 * en db.$transaction. Fuera de una transacción falla.
 */
export function transactionClientOf(db: TenantDb): Prisma.TransactionClient {
  const tx = transactionClients.get(db);
  if (tx === undefined) {
    throw new TenantViolation("enqueue con un TenantDb solo dentro de db.$transaction");
  }
  return tx;
}

/** Uso indebido de forTenant: es un error de programación, no del usuario. */
export class TenantViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantViolation";
  }
}

const delegates = {
  workspace: { model: "Workspace", ops: workspaceOps },
  role: { model: "Role", ops: [...readOps, ...writeOps] },
  membership: { model: "Membership", ops: [...readOps, ...writeOps] },
  department: { model: "Department", ops: [...readOps, ...writeOps] },
  departmentMember: { model: "DepartmentMember", ops: [...readOps, ...writeOps] },
  invitation: { model: "Invitation", ops: [...readOps, ...writeOps] },
  space: { model: "Space", ops: [...readOps, ...writeOps] },
  node: { model: "Node", ops: [...readOps, ...writeOps] },
  permission: { model: "Permission", ops: [...readOps, ...writeOps] },
  fileVersion: { model: "FileVersion", ops: [...readOps, ...writeOps] },
  uploadReservation: { model: "UploadReservation", ops: [...readOps, ...writeOps] },
  importJob: { model: "ImportJob", ops: [...readOps, ...writeOps] },
  spaceUserState: { model: "SpaceUserState", ops: [...readOps, ...writeOps] },
  downloadToken: { model: "DownloadToken", ops: [...readOps, ...writeOps] },
  zipExport: { model: "ZipExport", ops: [...readOps, ...writeOps] },
  pageContent: { model: "PageContent", ops: [...readOps, ...writeOps] },
  // Versions are never edited or deleted: only read and added.
  formVersion: { model: "FormVersion", ops: ["findFirst", "findMany", "count", "create"] },
  // Records are never deleted, and their answers never change: updateMany is only for voiding one.
  formRecord: {
    model: "FormRecord",
    ops: ["findFirst", "findMany", "count", "groupBy", "create", "updateMany"],
  },
  formFile: { model: "FormFile", ops: [...readOps, ...writeOps] },
  formSettings: { model: "FormSettings", ops: [...readOps, ...writeOps] },
  position: { model: "Position", ops: [...readOps, ...writeOps] },
  expiry: { model: "Expiry", ops: [...readOps, ...writeOps] },
  safetyItem: { model: "SafetyItem", ops: [...readOps, ...writeOps] },
  safetyDelivery: {
    model: "SafetyDelivery",
    ops: ["findFirst", "findMany", "count", "create", "update", "updateMany"],
  },
  safetyDeliveryLine: {
    model: "SafetyDeliveryLine",
    ops: ["findFirst", "findMany", "count", "createMany", "createManyAndReturn"],
  },
  safetyIncident: {
    model: "SafetyIncident",
    ops: ["findFirst", "findMany", "count", "create", "update", "updateMany"],
  },
  safetyAction: { model: "SafetyAction", ops: [...readOps, ...writeOps] },
  safetyCourse: { model: "SafetyCourse", ops: [...readOps, ...writeOps] },
  safetySignSession: { model: "SafetySignSession", ops: [...readOps, ...writeOps] },
  auditRoom: { model: "AuditRoom", ops: [...readOps, ...writeOps] },
  auditRoomItem: { model: "AuditRoomItem", ops: [...readOps, ...writeOps] },
  auditRoomCode: { model: "AuditRoomCode", ops: [...readOps, ...writeOps] },
  auditRoomSession: { model: "AuditRoomSession", ops: [...readOps, ...writeOps] },
  auditRoomAccess: { model: "AuditRoomAccess", ops: ["findFirst", "findMany", "count", "create"] },
  safetyFitness: { model: "SafetyFitness", ops: ["findFirst", "findMany", "count", "create"] },
  safetyTraining: {
    model: "SafetyTraining",
    ops: ["findFirst", "findMany", "count", "create", "createManyAndReturn"],
  },
  caeCompany: {
    model: "CaeCompany",
    ops: ["findFirst", "findMany", "count", "create", "update", "updateMany"],
  },
  caeWorker: {
    model: "CaeWorker",
    ops: ["findFirst", "findMany", "count", "groupBy", "create", "update", "updateMany"],
  },
  caeRequirement: {
    model: "CaeRequirement",
    ops: ["findFirst", "findMany", "count", "create", "createMany", "update", "updateMany"],
  },
  caeDocument: {
    model: "CaeDocument",
    ops: ["findFirst", "findMany", "count", "groupBy", "create", "update", "updateMany"],
  },
  caeAccess: { model: "CaeAccess", ops: ["findFirst", "findMany", "count", "create"] },
  caeInfoDelivery: {
    model: "CaeInfoDelivery",
    ops: ["findFirst", "findMany", "count", "create"],
  },
  caeWorkPermit: {
    model: "CaeWorkPermit",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  caePortalAccess: {
    model: "CaePortalAccess",
    ops: ["findFirst", "findMany", "count", "create", "update", "updateMany"],
  },
  caePortalSession: {
    model: "CaePortalSession",
    ops: ["findFirst", "findMany", "count", "create", "update", "updateMany"],
  },
  caePortalUpload: {
    model: "CaePortalUpload",
    ops: ["findFirst", "count", "create", "updateMany"],
  },
  safetyMonthStat: {
    model: "SafetyMonthStat",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  safetyEmergencyRole: {
    model: "SafetyEmergencyRole",
    ops: ["findFirst", "findMany", "count", "create", "createMany", "update"],
  },
  safetyEmergencyMember: { model: "SafetyEmergencyMember", ops: [...readOps, ...writeOps] },
  safetyDrill: {
    model: "SafetyDrill",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  safetyCommitteeMember: {
    model: "SafetyCommitteeMember",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  safetyMeeting: {
    model: "SafetyMeeting",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualityNc: {
    model: "QualityNc",
    ops: ["findFirst", "findMany", "count", "groupBy", "create", "update", "updateMany"],
  },
  qualityNcCounter: { model: "QualityNcCounter", ops: ["upsert"] },
  qualityAction: {
    model: "QualityAction",
    ops: ["findFirst", "findMany", "count", "groupBy", "create", "update"],
  },
  qualityVerification: {
    model: "QualityVerification",
    ops: ["findFirst", "findMany", "count", "create"],
  },
  qualityNcEvent: { model: "QualityNcEvent", ops: ["findFirst", "findMany", "count", "create"] },
  qualityCcp: {
    model: "QualityCcp",
    ops: ["findFirst", "findMany", "count", "create", "createMany", "update"],
  },
  qualityAudit: {
    model: "QualityAudit",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualityFinding: {
    model: "QualityFinding",
    ops: ["findFirst", "findMany", "count", "groupBy", "create", "update"],
  },
  qualitySupplier: {
    model: "QualitySupplier",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualitySupplierDoc: {
    model: "QualitySupplierDoc",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualitySupplierReview: {
    model: "QualitySupplierReview",
    ops: ["findFirst", "findMany", "count", "create"],
  },
  qualityComplaint: {
    model: "QualityComplaint",
    ops: ["findFirst", "findMany", "count", "groupBy", "create", "update"],
  },
  qualityMonthUnits: { model: "QualityMonthUnits", ops: ["findMany", "upsert"] },
  qualityCrisisMember: {
    model: "QualityCrisisMember",
    ops: ["findFirst", "findMany", "count", "create", "deleteMany"],
  },
  qualityCrisisContact: {
    model: "QualityCrisisContact",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualityRecallTest: {
    model: "QualityRecallTest",
    ops: ["findFirst", "findMany", "count", "create"],
  },
  qualityPrp: {
    model: "QualityPrp",
    ops: ["findFirst", "findMany", "count", "groupBy", "create", "update"],
  },
  qualityPrpCheck: { model: "QualityPrpCheck", ops: ["findFirst", "findMany", "count", "create"] },
  qualityProduct: {
    model: "QualityProduct",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualityShelfLifeStudy: {
    model: "QualityShelfLifeStudy",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualityLabel: {
    model: "QualityLabel",
    ops: ["findFirst", "findMany", "count", "create", "update", "updateMany"],
  },
  qualitySamplingPoint: {
    model: "QualitySamplingPoint",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualityLabResult: {
    model: "QualityLabResult",
    ops: ["findFirst", "findMany", "count", "create"],
  },
  qualityCulturePlan: { model: "QualityCulturePlan", ops: ["findFirst", "upsert"] },
  qualityCultureActivity: {
    model: "QualityCultureActivity",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualityCultureSurvey: {
    model: "QualityCultureSurvey",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualityCultureAnswer: { model: "QualityCultureAnswer", ops: ["findMany", "count", "create"] },
  qualityCultureVoter: { model: "QualityCultureVoter", ops: ["findMany", "count", "create"] },
  qualityChange: {
    model: "QualityChange",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  qualityChangeCounter: { model: "QualityChangeCounter", ops: ["upsert"] },
  whistleblowingManager: {
    model: "WhistleblowingManager",
    ops: ["findFirst", "findMany", "deleteMany", "upsert"],
  },
  whistleblowingCounter: { model: "WhistleblowingCounter", ops: ["upsert"] },
  whistleblowingCase: {
    model: "WhistleblowingCase",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  whistleblowingExclusion: { model: "WhistleblowingExclusion", ops: ["findMany", "create"] },
  whistleblowingMessage: { model: "WhistleblowingMessage", ops: ["findMany", "create"] },
  whistleblowingNote: { model: "WhistleblowingNote", ops: ["findMany", "create"] },
  whistleblowingEvent: { model: "WhistleblowingEvent", ops: ["findFirst", "findMany", "create"] },
  whistleblowingSession: { model: "WhistleblowingSession", ops: ["create", "update"] },
  envPermit: { model: "EnvPermit", ops: ["findFirst", "findMany", "count", "create", "update"] },
  envObligation: {
    model: "EnvObligation",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  envObligationDone: { model: "EnvObligationDone", ops: ["findMany", "create"] },
  envContractor: {
    model: "EnvContractor",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  envWaste: { model: "EnvWaste", ops: ["findFirst", "findMany", "count", "create", "update"] },
  envWasteMovement: {
    model: "EnvWasteMovement",
    ops: ["findFirst", "findMany", "count", "create", "delete"],
  },
  envDischargeLimit: { model: "EnvDischargeLimit", ops: ["findMany", "create", "deleteMany"] },
  envDischargeSample: {
    model: "EnvDischargeSample",
    ops: ["findFirst", "findMany", "count", "create", "update", "delete"],
  },
  envMeter: { model: "EnvMeter", ops: ["findFirst", "findMany", "create", "update"] },
  envReading: { model: "EnvReading", ops: ["findFirst", "findMany", "upsert", "delete"] },
  envProduction: { model: "EnvProduction", ops: ["findMany", "upsert"] },
  envTarget: { model: "EnvTarget", ops: ["findMany", "upsert", "deleteMany"] },
  envCoolingUnit: { model: "EnvCoolingUnit", ops: ["findFirst", "findMany", "create", "update"] },
  envCoolingEvent: { model: "EnvCoolingEvent", ops: ["findFirst", "findMany", "create", "delete"] },
  maintAsset: { model: "MaintAsset", ops: ["findFirst", "findMany", "count", "create", "update"] },
  maintCounter: { model: "MaintCounter", ops: ["upsert"] },
  maintWorkOrder: {
    model: "MaintWorkOrder",
    ops: ["findFirst", "findMany", "count", "create", "update"],
  },
  maintLabor: { model: "MaintLabor", ops: ["findFirst", "findMany", "create", "update", "delete"] },
  maintPartUse: { model: "MaintPartUse", ops: ["findFirst", "findMany", "create", "delete"] },
  maintEvent: { model: "MaintEvent", ops: ["findMany", "create"] },
  maintRecording: {
    model: "MaintRecording",
    ops: ["findFirst", "findMany", "create", "updateMany"],
  },
  maintPlan: { model: "MaintPlan", ops: ["findFirst", "findMany", "count", "create", "update"] },
  maintMeter: { model: "MaintMeter", ops: ["findFirst", "findMany", "create", "update"] },
  maintMeterReading: { model: "MaintMeterReading", ops: ["findMany", "create"] },
  maintSuggestion: { model: "MaintSuggestion", ops: ["findFirst", "create", "update"] },
  maintPart: {
    model: "MaintPart",
    ops: ["findFirst", "findMany", "count", "create", "update", "updateMany"],
  },
  maintIntegrationToken: {
    model: "MaintIntegrationToken",
    ops: ["findFirst", "findMany", "create", "update"],
  },
  qualityLot: {
    model: "QualityLot",
    ops: ["findFirst", "findMany", "count", "create", "update", "delete"],
  },
  qualityLotLink: {
    model: "QualityLotLink",
    ops: ["findFirst", "findMany", "count", "create", "update", "delete"],
  },
  qualityShipment: {
    model: "QualityShipment",
    ops: ["findFirst", "findMany", "count", "create", "update", "delete"],
  },
  qualityHold: {
    model: "QualityHold",
    ops: ["findFirst", "findMany", "count", "groupBy", "create", "update", "updateMany"],
  },
  pageImage: { model: "PageImage", ops: [...readOps, ...writeOps] },
  template: {
    model: "Template",
    ops: ["findFirst", "findMany", "count", "create", "update", "delete"],
  },
  templateImage: { model: "TemplateImage", ops: ["findMany", "aggregate", "createMany"] },
  commentThread: { model: "CommentThread", ops: [...readOps, ...writeOps] },
  comment: { model: "Comment", ops: [...readOps, ...writeOps] },
  mention: { model: "Mention", ops: [...readOps, ...writeOps] },
  sharedSeen: { model: "SharedSeen", ops: [...readOps, ...writeOps] },
  notification: { model: "Notification", ops: [...readOps, ...writeOps] },
  documentType: { model: "DocumentType", ops: [...readOps, ...writeOps] },
  approval: { model: "Approval", ops: [...readOps, ...writeOps] },
  readRequirement: { model: "ReadRequirement", ops: [...readOps, ...writeOps] },
  documentVisit: { model: "DocumentVisit", ops: [...readOps, ...writeOps] },
  qrCode: { model: "QrCode", ops: [...readOps, ...writeOps] },
  workspaceEmail: { model: "WorkspaceEmail", ops: [...readOps, ...writeOps] },
  contentChunk: { model: "ContentChunk", ops: [...readOps, ...writeOps] },
  contentChunkDirty: { model: "ContentChunkDirty", ops: [...readOps, ...writeOps] },
  usageCounter: { model: "UsageCounter", ops: [...readOps, ...writeOps] },
  usageCounterMember: { model: "UsageCounterMember", ops: [...readOps, ...writeOps] },
  bianLimit: { model: "BianLimit", ops: [...readOps, ...writeOps] },
  bianFeedback: { model: "BianFeedback", ops: [...readOps, ...writeOps] },
  fileText: { model: "FileText", ops: [...readOps, ...writeOps] },
  readAcknowledgment: { model: "ReadAcknowledgment", ops: [...readOps, ...writeOps] },
  controlledDocument: { model: "ControlledDocument", ops: [...readOps, ...writeOps] },
  documentVersion: { model: "DocumentVersion", ops: [...readOps, ...writeOps] },
  pinLogin: { model: "PinLogin", ops: [...readOps, ...writeOps] },
  workspaceLicense: { model: "WorkspaceLicense", ops: [...readOps, ...writeOps] },
  pluginSetting: { model: "PluginSetting", ops: [...readOps, ...writeOps] },
  pluginSecret: { model: "PluginSecret", ops: [...readOps, ...writeOps] },
  externalIdentity: { model: "ExternalIdentity", ops: [...readOps, ...writeOps] },
  oAuthGrant: { model: "OAuthGrant", ops: [...readOps, ...writeOps] },
  ssoFlow: { model: "SsoFlow", ops: [...readOps, ...writeOps] },
  auditLog: { model: "AuditLog", ops: appendOnlyOps },
} as const satisfies Partial<Record<keyof TenantDb, { model: ModelName; ops: readonly Op[] }>>;

/** Modelos con tenant que cubre forTenant (un test lo compara con schema.prisma). */
export const tenantModels: readonly ModelName[] = Object.values(delegates).map((d) => d.model);

const uniqueWhereOps = new Set<string>([
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "upsert",
  "delete",
]);
const createOps = new Set<string>(["create", "createMany", "createManyAndReturn"]);
const updateOps = new Set<string>(["update", "updateMany", "updateManyAndReturn"]);

// Claves que no son campos pero contienen filtros o selecciones del mismo modelo.
const passThroughKeys = new Set([
  "AND",
  "OR",
  "NOT",
  "some",
  "every",
  "none",
  "is",
  "isNot",
  "where",
  "select",
  "include",
  "omit",
  "orderBy",
  "_count",
  "having",
]);

type Args = Record<string, unknown>;

function isPlainObject(value: unknown): value is Args {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Recorre where/select/include/orderBy: nunca se sigue una relación desde un modelo global. */
function assertSafeTraversal(value: unknown, model: ModelName): void {
  if (Array.isArray(value)) {
    for (const item of value) assertSafeTraversal(item, model);
    return;
  }
  if (!isPlainObject(value)) return;
  const relations = relationsOf(model);
  for (const [key, child] of Object.entries(value)) {
    const target = relations[key];
    if (target !== undefined) {
      if (modelMetadata[model].scope === "global") {
        throw new TenantViolation(
          `No se puede recorrer ${model}.${key} desde un acceso de tenant: ${model} es global`,
        );
      }
      assertSafeTraversal(child, target);
    } else if (passThroughKeys.has(key)) {
      assertSafeTraversal(child, model);
    }
  }
}

function assertNoNestedWrites(data: unknown, model: ModelName): void {
  for (const item of asArray(data)) {
    if (!isPlainObject(item)) continue;
    for (const key of Object.keys(item)) {
      if (key in relationsOf(model)) {
        throw new TenantViolation(
          `Escritura anidada en ${model}.${key}: usá claves foráneas escalares`,
        );
      }
    }
  }
}

export function forTenant(client: BaseClient, workspaceId: string): TenantDb {
  if (workspaceId === "") throw new TenantViolation("workspaceId vacío");

  const scopeFilter = (model: ModelName): Args =>
    modelMetadata[model].scope === "workspace" ? { id: workspaceId } : { workspaceId };

  const scopeWhere = (op: string, model: ModelName, where: unknown): Args => {
    const filter = scopeFilter(model);
    if (uniqueWhereOps.has(op)) {
      if (!isPlainObject(where)) throw new TenantViolation(`${op} sin where único en ${model}`);
      return { ...where, AND: [...asArray(where.AND), filter] };
    }
    return where === undefined ? filter : { AND: [where, filter] };
  };

  const withTenant = (data: unknown, model: ModelName): Args => {
    if (!isPlainObject(data)) throw new TenantViolation(`Datos inválidos para ${model}`);
    if (data.workspaceId !== undefined && data.workspaceId !== workspaceId) {
      throw new TenantViolation(`Creación en ${model} con otro workspaceId`);
    }
    return { ...data, workspaceId };
  };

  const assertNoTenantChange = (data: unknown, model: ModelName) => {
    const key = modelMetadata[model].scope === "workspace" ? "id" : "workspaceId";
    if (isPlainObject(data) && data[key] !== undefined) {
      throw new TenantViolation(`No se puede cambiar ${model}.${key}`);
    }
  };

  const rewrite = (model: ModelName, op: string, input: unknown): Args => {
    const args: Args = isPlainObject(input) ? { ...input } : {};
    assertSafeTraversal(args, model);

    if (createOps.has(op)) {
      assertNoNestedWrites(args.data, model);
      args.data = Array.isArray(args.data)
        ? args.data.map((item) => withTenant(item, model))
        : withTenant(args.data, model);
      return args;
    }

    if (op === "upsert") {
      assertNoNestedWrites(args.create, model);
      assertNoNestedWrites(args.update, model);
      assertNoTenantChange(args.update, model);
      args.create = withTenant(args.create, model);
    }
    if (updateOps.has(op)) {
      assertNoNestedWrites(args.data, model);
      assertNoTenantChange(args.data, model);
    }

    args.where = scopeWhere(op, model, args.where);
    return args;
  };

  const db: Record<string, unknown> = { workspaceId };

  for (const [key, { model, ops }] of Object.entries(delegates)) {
    const delegate: unknown = Reflect.get(client, key);
    const wrapped: Record<string, (args?: unknown) => Promise<unknown>> = {};
    for (const op of ops) {
      wrapped[op] = async (args?: unknown) => {
        const method = Reflect.get(delegate as object, op) as (a: Args) => PromiseLike<unknown>;
        return await method.call(delegate, rewrite(model, op, args));
      };
    }
    db[key] = Object.freeze(wrapped);
  }

  db.$transaction = async <T>(
    fn: (tenantDb: TenantDb) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> => {
    if (!("$transaction" in client) || typeof client.$transaction !== "function") {
      throw new TenantViolation("Transacciones anidadas no soportadas");
    }
    return await client.$transaction((tx) => {
      const txDb = forTenant(tx, workspaceId);
      transactionClients.set(txDb, tx);
      return fn(txDb);
    }, options);
  };

  return Object.freeze(db) as unknown as TenantDb;
}
