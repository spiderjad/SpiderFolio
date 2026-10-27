// Reglas de ESLint del backend (CLAUDE.md, sección 7.4): SQL en crudo y cliente base en rutas.
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });
const RULES = ["no-restricted-syntax", "no-restricted-imports"];

async function messages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .map((m) => m.ruleId ?? m.message)
    .filter((rule) => RULES.includes(rule));
}

describe("SQL en crudo", () => {
  it.each([
    "$queryRaw`SELECT 1`",
    "$executeRaw`DELETE`",
    "$queryRawUnsafe('x')",
    "$executeRawUnsafe('x')",
    "$queryRawTyped(q)",
  ])("prohíbe prisma.%s fuera de db/raw", async (call) => {
    expect(await messages(`prisma.${call};`, "backend/src/modules/x/x.service.js")).toContain(
      "no-restricted-syntax",
    );
  });

  it("lo permite en backend/src/db/raw y en tests", async () => {
    expect(await messages("prisma.$queryRaw`SELECT 1`;", "backend/src/db/raw/x.js")).toEqual([]);
    expect(await messages("prisma.$queryRawUnsafe('x');", "backend/tests/x.js")).toEqual([]);
  });
});

describe("rutas", () => {
  it("no importan el cliente base ni el generado", async () => {
    for (const source of ["../../lib/prisma.ts", "../../generated/prisma/client.ts"]) {
      expect(
        await messages(`import { x } from "${source}";`, "backend/src/modules/x/x.routes.js"),
      ).toContain("no-restricted-imports");
    }
  });

  it("no usan deps.prisma", async () => {
    expect(
      await messages("deps.prisma.user.findMany();", "backend/src/modules/x/x.routes.js"),
    ).toContain("no-restricted-syntax");
  });

  it("los servicios sí pueden usar el cliente base", async () => {
    expect(
      await messages(
        'import { x } from "../../lib/prisma.ts"; deps.prisma.user.findMany();',
        "backend/src/modules/x/x.service.js",
      ),
    ).toEqual([]);
  });
});

describe("transactionClientOf", () => {
  const code = 'import { transactionClientOf } from "../../db/tenant.ts";';

  it("no se puede importar fuera de jobs/", async () => {
    for (const file of [
      "backend/src/modules/x/x.service.js",
      "backend/src/modules/x/x.routes.js",
    ]) {
      expect(await messages(code, file), file).toContain("no-restricted-syntax");
    }
  });

  it("jobs/ sí lo usa", async () => {
    expect(await messages(code, "backend/src/jobs/boss.js")).toEqual([]);
  });
});
