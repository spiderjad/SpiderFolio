// Las reglas de ESLint que protegen los límites que fija cada empresa (docs/spec/limites.md).
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });

const LIMIT_RULES = ["no-restricted-syntax", "no-restricted-imports"];

async function messages(code: string, filePath = "backend/src/ejemplo.js"): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .map((m) => m.ruleId ?? m.message)
    .filter((rule) => LIMIT_RULES.includes(rule));
}

describe("reglas de límites", () => {
  it.each([
    ["const limits = { maxFileMb: 100 };", "no-restricted-syntax"],
    ['const limits = { "storageGb": 5 };', "no-restricted-syntax"],
    ['import { x } from "../../packages/limits/src/schema.ts";', "no-restricted-imports"],
  ])("rechaza %s", async (code, rule) => {
    expect(await messages(code)).toContain(rule);
  });

  it.each([
    'if (status === "ACTIVE") {}',
    "const limits = { maxFileMb: storedLimit };",
    "const page = { size: 100 };",
    'import { checkLimit } from "@spiderfolio/limits";',
  ])("permite %s", async (code) => {
    expect(await messages(code)).toEqual([]);
  });

  it("dentro de packages/limits no aplica", async () => {
    expect(
      await messages("const limits = { maxFileMb: 100 };", "packages/limits/src/ejemplo.js"),
    ).toEqual([]);
  });
});
