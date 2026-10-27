// Cliente base de Prisma 7 con el driver adapter de pg. Solo para modelos globales y para
// servicios que lo necesitan a propósito: las rutas usan req.db (forTenant).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

export type { PrismaClient };

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
