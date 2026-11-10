// Cliente base de Prisma 7 con el driver adapter de pg. Solo para modelos globales y para
// servicios que lo necesitan a propósito: las rutas usan req.db (forTenant).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

export type { PrismaClient };

/** `max`: the pool's connections (DATABASE_POOL_MAX); pg's default, 10, is short for a whole plant. */
export function createPrismaClient(databaseUrl: string, max = 20): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max }) });
}
