// pg-boss sobre el mismo Postgres (esquema "pgboss", fuera de Prisma). La API solo encola; el
// worker procesa y programa. Ver jobs/queues.ts.
import { PgBoss, fromPrisma } from "pg-boss";
import { transactionClientOf, type TenantDb } from "../db/tenant.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { queues, type QueueName, type QueuePayload } from "./queues.ts";

export type BossRole = "api" | "worker";

export function createBoss(connectionString: string, role: BossRole): PgBoss {
  return new PgBoss({
    connectionString,
    schema: "pgboss",
    application_name: `spiderfolio-${role}`,
    // Mantenimiento, cron y LISTEN/NOTIFY solo en el worker.
    supervise: role === "worker",
    schedule: role === "worker",
    useListenNotify: role === "worker",
  });
}

/** Crea o actualiza las colas declaradas. Idempotente. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  // Primero las colas destino de deadLetter.
  const names = (Object.keys(queues) as QueueName[]).sort((a, b) =>
    a === "email-failed" ? -1 : b === "email-failed" ? 1 : 0,
  );
  for (const name of names) {
    const { options } = queues[name];
    if ((await boss.getQueue(name)) === null) await boss.createQueue(name, options);
    else await boss.updateQueue(name, options);
  }
}

export interface EnqueueOptions {
  /**
   * Encola dentro de esta transacción: si se revierte, el job no existe. Puede ser el TenantDb
   * que recibe db.$transaction (servicios de tenant) o la transacción base de prisma.$transaction
   * (servicios de modelos globales, ej. auth). El SQL en crudo sobre la transacción lo usa solo
   * pg-boss, acá adentro.
   */
  tx?: TenantDb | Prisma.TransactionClient;
  singletonKey?: string;
}

function baseTransaction(tx: TenantDb | Prisma.TransactionClient): Prisma.TransactionClient {
  return "$queryRawUnsafe" in tx ? tx : transactionClientOf(tx);
}

export interface Jobs {
  enqueue<Q extends QueueName>(
    queue: Q,
    payload: QueuePayload<Q>,
    options?: EnqueueOptions,
  ): Promise<void>;
}

export function createJobs(boss: PgBoss): Jobs {
  return {
    async enqueue(queue, payload, options = {}) {
      const data = queues[queue].schema.parse(payload);
      await boss.send(queue, data, {
        ...(options.tx === undefined ? {} : { db: fromPrisma(baseTransaction(options.tx)) }),
        ...(options.singletonKey === undefined ? {} : { singletonKey: options.singletonKey }),
      });
    },
  };
}
