// SQL en crudo: solo en db/raw (regla de ESLint, CLAUDE.md sección 7.4).
import type { PrismaClient } from "../../lib/prisma.ts";

export async function databaseIsUp(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
