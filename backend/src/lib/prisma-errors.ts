import { Prisma } from "../generated/prisma/client.ts";

/**
 * Nombre del índice único violado (P2002), ej. "User_email_key"; null si es otro error.
 * Con el driver adapter de pg, Prisma 7 lo informa en meta.driverAdapterError.cause.
 */
export function violatedUniqueIndex(error: unknown): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return null;
  }
  const meta = error.meta as
    { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } } | undefined;
  const index = meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof index === "string" ? index : null;
}
