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
  pageImage: TenantDelegate<PrismaClient["pageImage"], Op>;
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
  pageImage: { model: "PageImage", ops: [...readOps, ...writeOps] },
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
